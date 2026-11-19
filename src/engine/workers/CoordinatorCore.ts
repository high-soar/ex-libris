import { LocalFileReader } from "../io/LocalFileReader";
import type {
  ArchiveSourceDescriptor,
  CoordinatorWorkerApi,
  DecodeWorkerApi,
  DecodedPageFrame,
  OpenArchiveResult,
  RandomAccessReader,
  ZipPageEntry,
} from "../types";
import { ZipArchiveError, isAbortError } from "../zip/errors";
import { parseZipDirectory, readCompressedPageSlice } from "../zip/zipParser";

export type ArchiveReaderFactory = (
  source: ArchiveSourceDescriptor,
  accessToken: string | null,
) => RandomAccessReader;

export interface CoordinatorCoreDeps {
  readonly decodePool: DecodeWorkerApi;
  readonly createReader?: ArchiveReaderFactory;
}

function defaultCreateReader(
  source: ArchiveSourceDescriptor,
  _accessToken: string | null,
): RandomAccessReader {
  switch (source.kind) {
    case "local-session":
      return new LocalFileReader(source.file);
    case "gdrive":
      throw new ZipArchiveError(
        "READ_ERROR",
        "Google Driveソースは次期バージョン(v0.2)で対応予定です",
      );
    default: {
      const _exhaustiveCheck: never = source;
      throw new ZipArchiveError(
        "READ_ERROR",
        `未対応のアーカイブソース種別です: ${String((_exhaustiveCheck as { kind?: unknown }).kind)}`,
      );
    }
  }
}

export class CoordinatorCore implements CoordinatorWorkerApi {
  private readonly decodePool: DecodeWorkerApi;
  private readonly createReader: ArchiveReaderFactory;
  private activeReader: RandomAccessReader | null = null;
  private entries: ZipPageEntry[] = [];
  private minActiveEpoch = 0;
  private accessToken: string | null = null;
  private readonly inflightAbortControllers = new Map<
    number,
    Set<AbortController>
  >();

  constructor(deps: CoordinatorCoreDeps) {
    this.decodePool = deps.decodePool;
    this.createReader = deps.createReader ?? defaultCreateReader;
  }

  private registerAbortController(epoch: number): AbortController {
    const controller = new AbortController();
    let set = this.inflightAbortControllers.get(epoch);
    if (!set) {
      set = new Set();
      this.inflightAbortControllers.set(epoch, set);
    }
    set.add(controller);
    return controller;
  }

  private unregisterAbortController(
    epoch: number,
    controller: AbortController,
  ): void {
    const set = this.inflightAbortControllers.get(epoch);
    if (!set) {
      return;
    }
    set.delete(controller);
    if (set.size === 0) {
      this.inflightAbortControllers.delete(epoch);
    }
  }

  private resetActiveArchiveState(): void {
    for (const controllers of this.inflightAbortControllers.values()) {
      for (const controller of controllers) {
        controller.abort();
      }
    }
    this.inflightAbortControllers.clear();
    this.activeReader = null;
    this.entries = [];
  }

  async openArchive(
    source: ArchiveSourceDescriptor,
    cachedEntries: readonly ZipPageEntry[] | null,
    epoch: number,
  ): Promise<OpenArchiveResult> {
    if (epoch < this.minActiveEpoch) {
      throw new DOMException("Aborted", "AbortError");
    }

    this.resetActiveArchiveState();

    const reader = this.createReader(source, this.accessToken);
    const controller = this.registerAbortController(epoch);

    try {
      const parsedEntries =
        cachedEntries !== null
          ? [...cachedEntries]
          : await parseZipDirectory(reader, controller.signal);

      if (controller.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      this.activeReader = reader;
      this.entries = parsedEntries;

      return {
        pageCount: parsedEntries.length,
        entries: parsedEntries,
        fromIndexCache: cachedEntries !== null,
      };
    } finally {
      this.unregisterAbortController(epoch, controller);
    }
  }

  async requestVisiblePages(
    pageIndices: readonly number[],
    prefetchIndices: readonly number[],
    epoch: number,
  ): Promise<DecodedPageFrame[]> {
    void prefetchIndices;

    if (
      epoch < this.minActiveEpoch ||
      this.activeReader === null ||
      pageIndices.length === 0
    ) {
      return [];
    }

    const reader = this.activeReader;
    const entries = this.entries;
    const controller = this.registerAbortController(epoch);

    try {
      const results = await Promise.all(
        pageIndices.map(async (pageIndex): Promise<DecodedPageFrame | null> => {
          const entry = entries[pageIndex];
          if (!entry) {
            return {
              status: "error",
              pageIndex,
              epoch,
              errorCode: "READ_ERROR",
              message: `指定されたページ番号が範囲外です: ${pageIndex}`,
            };
          }

          try {
            const compressedSlice = await readCompressedPageSlice(
              reader,
              entry,
              controller.signal,
            );
            if (controller.signal.aborted) {
              return null;
            }

            const decoded = await this.decodePool.decodePageSlice(
              compressedSlice,
              entry.compressionMethod,
            );
            if (controller.signal.aborted) {
              decoded.bitmap.close();
              return null;
            }

            return {
              status: "ready",
              pageIndex,
              epoch,
              width: decoded.width,
              height: decoded.height,
              bitmap: decoded.bitmap,
            };
          } catch (error) {
            if (isAbortError(error) || controller.signal.aborted) {
              return null;
            }
            return {
              status: "error",
              pageIndex,
              epoch,
              errorCode:
                error instanceof ZipArchiveError ? error.code : "DECODE_FAILED",
              message: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );

      if (controller.signal.aborted) {
        for (const frame of results) {
          if (frame !== null && frame.status === "ready") {
            frame.bitmap.close();
          }
        }
        return [];
      }

      return results.filter(
        (frame): frame is DecodedPageFrame => frame !== null,
      );
    } finally {
      this.unregisterAbortController(epoch, controller);
    }
  }

  updateAccessToken(accessToken: string | null): void {
    this.accessToken = accessToken;
  }

  cancelEpochBelow(minActiveEpoch: number): void {
    if (minActiveEpoch > this.minActiveEpoch) {
      this.minActiveEpoch = minActiveEpoch;
    }

    for (const [
      epoch,
      controllers,
    ] of this.inflightAbortControllers.entries()) {
      if (epoch < this.minActiveEpoch) {
        for (const controller of controllers) {
          controller.abort();
        }
        this.inflightAbortControllers.delete(epoch);
      }
    }
  }

  async closeArchive(): Promise<void> {
    this.resetActiveArchiveState();
  }
}
