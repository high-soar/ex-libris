import type {
  ArchiveSourceDescriptor,
  CoordinatorWorkerApi,
  DecodeWorkerApi,
  DecodedPageFrame,
  OpenArchiveResult,
  RandomAccessReader,
  ZipPageEntry,
} from "../types";

export type ArchiveReaderFactory = (
  source: ArchiveSourceDescriptor,
  accessToken: string | null,
) => RandomAccessReader;

export interface CoordinatorCoreDeps {
  readonly decodePool: DecodeWorkerApi;
  readonly createReader?: ArchiveReaderFactory;
}

export class CoordinatorCore implements CoordinatorWorkerApi {
  constructor(deps: CoordinatorCoreDeps) {
    void deps;
  }

  async openArchive(
    source: ArchiveSourceDescriptor,
    cachedEntries: readonly ZipPageEntry[] | null,
    epoch: number,
  ): Promise<OpenArchiveResult> {
    void source;
    void cachedEntries;
    void epoch;
    throw new Error("Not implemented");
  }

  async requestVisiblePages(
    pageIndices: readonly number[],
    prefetchIndices: readonly number[],
    epoch: number,
  ): Promise<DecodedPageFrame[]> {
    void pageIndices;
    void prefetchIndices;
    void epoch;
    throw new Error("Not implemented");
  }

  updateAccessToken(accessToken: string | null): void {
    void accessToken;
    throw new Error("Not implemented");
  }

  cancelEpochBelow(minActiveEpoch: number): void {
    void minActiveEpoch;
    throw new Error("Not implemented");
  }

  async closeArchive(): Promise<void> {
    throw new Error("Not implemented");
  }
}
