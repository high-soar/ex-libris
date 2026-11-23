import { L2ByteCache } from "../cache/L2ByteCache";
import {
  type GetRangeAccessTokenOptions,
  GoogleDriveRangeReader,
} from "../io/GoogleDriveRangeReader";
import { LocalFileReader } from "../io/LocalFileReader";
import { runPrefetchBatches } from "../prefetch/AdaptivePrefetcher";
import type {
  ArchiveSourceDescriptor,
  CoordinatorHostCallbacks,
  CoordinatorWorkerApi,
  DecodeWorkerApi,
  DecodedPageFrame,
  OpenArchiveResult,
  RandomAccessReader,
  RequestVisiblePagesOptions,
  ZipErrorCode,
  ZipPageEntry,
} from "../types";
import { ZipArchiveError, isAbortError } from "../zip/errors";
import { validateZipIndexEntries } from "../zip/zipIndexValidation";
import { parseZipDirectory, readCompressedPageSlice } from "../zip/zipParser";
import { markSharedBuffer } from "./coordinatorTransfer";

export type ArchiveReaderFactory = (
  source: ArchiveSourceDescriptor,
  accessToken: string | null,
) => RandomAccessReader;

export interface CoordinatorCoreDeps {
  readonly decodePool: DecodeWorkerApi;
  readonly createReader?: ArchiveReaderFactory;
  readonly l2MaxBytes?: number;
}

interface InflightPageRead {
  readonly epoch: number;
  readonly signal: AbortSignal;
  readonly promise: Promise<Uint8Array | null>;
  readonly resolve: (slice: Uint8Array | null) => void;
  readonly cleanupAbortListener: () => void;
  settled: boolean;
  consumerCount: number;
}

export function canReuseAccessToken(
  currentToken: string | null,
  options: GetRangeAccessTokenOptions,
): currentToken is string {
  if (currentToken === null || currentToken.length === 0) {
    return false;
  }
  if (options.forceRefresh !== true) {
    return true;
  }
  return (
    options.failedToken !== undefined && currentToken !== options.failedToken
  );
}

function abortControllers(controllers: Iterable<AbortController>): void {
  for (const controller of controllers) {
    controller.abort();
  }
}

function createPageErrorFrame(
  pageIndex: number,
  epoch: number,
  errorCode: ZipErrorCode,
  message: string,
): DecodedPageFrame {
  return {
    status: "error",
    pageIndex,
    epoch,
    errorCode,
    message,
  };
}

function closeReadyFrames(frames: readonly (DecodedPageFrame | null)[]): void {
  for (const frame of frames) {
    if (frame !== null && frame.status === "ready") {
      frame.bitmap.close();
    }
  }
}

export class CoordinatorCore implements CoordinatorWorkerApi {
  private readonly decodePool: DecodeWorkerApi;
  private readonly createReader: ArchiveReaderFactory;
  private readonly l2Cache: L2ByteCache;
  private activeReader: RandomAccessReader | null = null;
  private entries: ZipPageEntry[] = [];
  private minActiveEpoch = 0;
  private accessToken: string | null = null;
  private tokenVersion = 0;
  private hostCallbacks: CoordinatorHostCallbacks | null = null;
  private readonly inflightAbortControllers = new Map<
    number,
    Set<AbortController>
  >();
  private readonly inflightPageReads = new Map<number, InflightPageRead>();
  private activePrefetch: {
    readonly epoch: number;
    readonly controller: AbortController;
  } | null = null;
  private lastWarmPrefetchEpoch: number | null = null;

  constructor(deps: CoordinatorCoreDeps) {
    this.decodePool = deps.decodePool;
    this.createReader =
      deps.createReader ?? ((source) => this.createDefaultReader(source));
    this.l2Cache = new L2ByteCache({ maxBytes: deps.l2MaxBytes });
  }

  private async resolveDriveAccessToken(
    options: GetRangeAccessTokenOptions = {},
  ): Promise<string> {
    const currentToken = this.accessToken;
    if (canReuseAccessToken(currentToken, options)) {
      return currentToken;
    }

    const callbacks = this.hostCallbacks;
    if (callbacks === null) {
      throw new ZipArchiveError(
        "READ_ERROR",
        "Google Driveアクセストークン取得用のホストコールバックが未設定です",
      );
    }

    const versionAtCall = this.tokenVersion;
    const nextToken = await callbacks.refreshAccessToken({
      forceRefresh: options.forceRefresh === true,
      failedToken: options.failedToken,
    });

    if (this.tokenVersion === versionAtCall) {
      this.accessToken = nextToken;
    }
    return nextToken;
  }

  private createDefaultReader(
    source: ArchiveSourceDescriptor,
  ): RandomAccessReader {
    switch (source.kind) {
      case "local-session":
        return new LocalFileReader(source.file);
      case "gdrive":
        return new GoogleDriveRangeReader({
          driveFileId: source.driveFileId,
          totalSize: source.fileSize,
          getAccessToken: (options) => this.resolveDriveAccessToken(options),
          onDiagnostic: (level, message, detail) => {
            this.hostCallbacks?.reportDiagnostic(
              level,
              "gdrive-range",
              message,
              detail,
            );
          },
        });
      default: {
        const _exhaustiveCheck: never = source;
        throw new ZipArchiveError(
          "READ_ERROR",
          `未対応のアーカイブソース種別です: ${String((_exhaustiveCheck as { kind?: unknown }).kind)}`,
        );
      }
    }
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

  private registerInflightPageRead(
    pageIndex: number,
    epoch: number,
    signal: AbortSignal,
    initialConsumerCount: number,
  ): InflightPageRead {
    let resolveFn!: (slice: Uint8Array | null) => void;
    const promise = new Promise<Uint8Array | null>((resolve) => {
      resolveFn = resolve;
    });
    const onAbort = () => {
      this.settleInflightPageRead(pageIndex, entry, null);
    };
    const entry: InflightPageRead = {
      epoch,
      signal,
      promise,
      resolve: resolveFn,
      cleanupAbortListener: () => {
        signal.removeEventListener("abort", onAbort);
      },
      settled: false,
      consumerCount: initialConsumerCount,
    };
    this.inflightPageReads.set(pageIndex, entry);
    signal.addEventListener("abort", onAbort, { once: true });
    return entry;
  }

  private settleInflightPageRead(
    pageIndex: number,
    entry: InflightPageRead,
    slice: Uint8Array | null,
  ): void {
    if (this.inflightPageReads.get(pageIndex) === entry) {
      this.inflightPageReads.delete(pageIndex);
    }
    entry.cleanupAbortListener();
    if (entry.settled) {
      return;
    }
    entry.settled = true;
    if (slice !== null && entry.consumerCount > 1) {
      markSharedBuffer(slice.buffer);
    }
    entry.resolve(slice);
  }

  private resetActiveArchiveState(): void {
    for (const [pageIndex, entry] of [...this.inflightPageReads.entries()]) {
      this.settleInflightPageRead(pageIndex, entry, null);
    }
    for (const controllers of this.inflightAbortControllers.values()) {
      abortControllers(controllers);
    }
    this.inflightAbortControllers.clear();
    this.activePrefetch = null;
    this.lastWarmPrefetchEpoch = null;
    this.l2Cache.clear();
    this.activeReader = null;
    this.entries = [];
  }

  private async fetchPageSlice(
    reader: RandomAccessReader,
    entry: ZipPageEntry,
    pageIndex: number,
    epoch: number,
    signal: AbortSignal,
    isVisiblePage: boolean,
  ): Promise<Uint8Array | null> {
    const cachedSlice = this.l2Cache.get(pageIndex);
    if (cachedSlice !== undefined) {
      return cachedSlice;
    }

    const inflight = this.inflightPageReads.get(pageIndex);
    // abort リスナーが同期的（abort() 完了前）に inflightPageReads から削除するため、マップ残存エントリは常に未中断
    if (inflight !== undefined && inflight.epoch === epoch) {
      inflight.consumerCount += 1;
      const sharedSlice = await inflight.promise;
      if (signal.aborted) {
        return null;
      }
      if (sharedSlice !== null) {
        markSharedBuffer(sharedSlice.buffer);
        return sharedSlice;
      }
    }

    const shouldTrackInflight = entry.compressedSize <= this.l2Cache.maxBytes;
    const ownInflight = shouldTrackInflight
      ? this.registerInflightPageRead(pageIndex, epoch, signal, 1)
      : null;

    try {
      const slice = await readCompressedPageSlice(reader, entry, signal);
      if (signal.aborted) {
        return null;
      }

      const stored = this.l2Cache.put(pageIndex, slice, {
        allowOversized: isVisiblePage,
      });
      const resultSlice = stored
        ? (this.l2Cache.peek(pageIndex) as Uint8Array)
        : slice;

      if (ownInflight !== null) {
        this.settleInflightPageRead(pageIndex, ownInflight, resultSlice);
      }
      return resultSlice;
    } finally {
      if (ownInflight !== null) {
        this.settleInflightPageRead(pageIndex, ownInflight, null);
      }
    }
  }

  private maybeStartWarmPrefetch(
    reader: RandomAccessReader,
    entries: readonly ZipPageEntry[],
    prefetchIndices: readonly number[],
    epoch: number,
    effectiveVisible: readonly number[],
  ): void {
    if (
      prefetchIndices.length === 0 ||
      (this.lastWarmPrefetchEpoch !== null &&
        epoch <= this.lastWarmPrefetchEpoch)
    ) {
      return;
    }

    this.lastWarmPrefetchEpoch = epoch;
    const prefetchController = this.registerAbortController(epoch);
    this.activePrefetch = { epoch, controller: prefetchController };

    const excludedPageIndices = new Set<number>(effectiveVisible);
    for (const [pageIndex, inflight] of this.inflightPageReads.entries()) {
      if (inflight.epoch === epoch) {
        excludedPageIndices.add(pageIndex);
      }
    }

    const plannedInflight = new Map<number, InflightPageRead>();

    void runPrefetchBatches({
      reader,
      entries,
      prefetchIndices,
      l2Cache: this.l2Cache,
      excludedPageIndices,
      signal: prefetchController.signal,
      callbacks: {
        onPlanPages: (plannedEntries) => {
          for (const plannedEntry of plannedEntries) {
            const inflight = this.registerInflightPageRead(
              plannedEntry.pageIndex,
              epoch,
              prefetchController.signal,
              0,
            );
            plannedInflight.set(plannedEntry.pageIndex, inflight);
          }
        },
        onPageReady: (pageIndex, slice) => {
          const inflight = plannedInflight.get(pageIndex) as InflightPageRead;
          this.settleInflightPageRead(pageIndex, inflight, slice);
        },
        onPageSettledEmpty: (pageIndex) => {
          const inflight = plannedInflight.get(pageIndex) as InflightPageRead;
          this.settleInflightPageRead(pageIndex, inflight, null);
        },
      },
    }).finally(() => {
      if (this.activePrefetch?.controller === prefetchController) {
        this.activePrefetch = null;
      }
      this.unregisterAbortController(epoch, prefetchController);
    });
  }

  private async fetchAndDecodePage(
    reader: RandomAccessReader,
    entry: ZipPageEntry | undefined,
    pageIndex: number,
    epoch: number,
    signal: AbortSignal,
    isVisiblePage: boolean,
  ): Promise<DecodedPageFrame | null> {
    if (!entry) {
      return createPageErrorFrame(
        pageIndex,
        epoch,
        "READ_ERROR",
        `指定されたページ番号が範囲外です: ${pageIndex}`,
      );
    }

    try {
      const compressedSlice = await this.fetchPageSlice(
        reader,
        entry,
        pageIndex,
        epoch,
        signal,
        isVisiblePage,
      );
      if (compressedSlice === null) {
        return null;
      }

      const decoded = await this.decodePool.decodePageSlice(
        compressedSlice,
        entry.compressionMethod,
      );
      if (signal.aborted) {
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
      if (isAbortError(error) || signal.aborted) {
        return null;
      }
      return createPageErrorFrame(
        pageIndex,
        epoch,
        error instanceof ZipArchiveError ? error.code : "DECODE_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
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
      const hasValidCache =
        cachedEntries !== null && validateZipIndexEntries(cachedEntries);
      const parsedEntries = hasValidCache
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
        fromIndexCache: hasValidCache,
      };
    } finally {
      this.unregisterAbortController(epoch, controller);
    }
  }

  private abortStaleWarmPrefetch(minEpoch: number): void {
    if (this.activePrefetch !== null && this.activePrefetch.epoch < minEpoch) {
      this.activePrefetch.controller.abort();
      this.unregisterAbortController(
        this.activePrefetch.epoch,
        this.activePrefetch.controller,
      );
      this.activePrefetch = null;
    }
  }

  async requestVisiblePages(
    pageIndices: readonly number[],
    prefetchIndices: readonly number[],
    epoch: number,
    options?: RequestVisiblePagesOptions,
  ): Promise<DecodedPageFrame[]> {
    if (epoch < this.minActiveEpoch || this.activeReader === null) {
      return [];
    }

    this.abortStaleWarmPrefetch(epoch);

    const reader = this.activeReader;
    const entries = this.entries;
    const effectiveVisible = options?.visiblePageIndices ?? pageIndices;
    this.l2Cache.setPinnedPages(effectiveVisible);

    if (pageIndices.length === 0) {
      this.maybeStartWarmPrefetch(
        reader,
        entries,
        prefetchIndices,
        epoch,
        effectiveVisible,
      );
      return [];
    }

    const visibleSet = new Set<number>(effectiveVisible);
    const controller = this.registerAbortController(epoch);

    try {
      const results = await Promise.all(
        pageIndices.map((pageIndex) =>
          this.fetchAndDecodePage(
            reader,
            entries[pageIndex],
            pageIndex,
            epoch,
            controller.signal,
            visibleSet.has(pageIndex),
          ),
        ),
      );

      if (controller.signal.aborted) {
        closeReadyFrames(results);
        return [];
      }

      this.maybeStartWarmPrefetch(
        reader,
        entries,
        prefetchIndices,
        epoch,
        effectiveVisible,
      );

      return results.filter(
        (frame): frame is DecodedPageFrame => frame !== null,
      );
    } finally {
      this.unregisterAbortController(epoch, controller);
    }
  }

  updateAccessToken(accessToken: string | null): void {
    this.tokenVersion += 1;
    this.accessToken = accessToken;
  }

  setHostCallbacks(callbacks: CoordinatorHostCallbacks | null): void {
    this.hostCallbacks = callbacks;
  }

  cancelEpochBelow(minActiveEpoch: number): void {
    if (minActiveEpoch > this.minActiveEpoch) {
      this.minActiveEpoch = minActiveEpoch;
    }

    this.abortStaleWarmPrefetch(this.minActiveEpoch);

    for (const [
      epoch,
      controllers,
    ] of this.inflightAbortControllers.entries()) {
      if (epoch < this.minActiveEpoch) {
        abortControllers(controllers);
        this.inflightAbortControllers.delete(epoch);
      }
    }
  }

  async closeArchive(): Promise<void> {
    this.resetActiveArchiveState();
  }
}
