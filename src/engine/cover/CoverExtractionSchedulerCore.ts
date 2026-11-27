import type { CoverWorkerClientHandle } from "../../app/coverWorkerClient";
import type { GoogleAuthBridge } from "../../bridges/oauth/types";
import type { DiagnosticLogger } from "../../diagnostics/types";
import type { DriveSyncRootsRepository } from "../../storage/repositories/driveSyncRootsRepository";
import type { SeriesRepository } from "../../storage/repositories/seriesRepository";
import type { VolumesRepository } from "../../storage/repositories/volumesRepository";
import type { ZipIndexCacheRepository } from "../../storage/repositories/zipIndexCacheRepository";
import type { VolumeRecord } from "../../storage/types";
import type { RandomAccessReader } from "../types";
import type {
  CoverExtractionPauseReason,
  CoverExtractionProgressSnapshot,
  CoverExtractionScheduler,
  CoverExtractionVolumeUpdateEvent,
  CoverViewportScreenKey,
} from "./types";

export interface CoverExtractionSchedulerDeps {
  readonly driveSyncRootsRepo: Pick<DriveSyncRootsRepository, "listActive">;
  readonly seriesRepo: Pick<SeriesRepository, "listActive">;
  readonly volumesRepo: Pick<
    VolumesRepository,
    | "getById"
    | "listVisibleByEnabledRoots"
    | "saveCoverReady"
    | "saveCoverError"
    | "resetErrorCoversToPending"
  >;
  readonly zipIndexCacheRepo: ZipIndexCacheRepository;
  readonly googleAuthBridge: Pick<GoogleAuthBridge, "getCachedSession">;
  readonly createRangeReader: (volume: VolumeRecord) => RandomAccessReader;
  readonly createWorkerClient: () => CoverWorkerClientHandle;
  readonly logger?: DiagnosticLogger;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const EMPTY_SNAPSHOT: CoverExtractionProgressSnapshot = {
  phase: "idle",
  totalCount: 0,
  readyCount: 0,
  pendingCount: 0,
  errorCount: 0,
  activeVolumeId: null,
  pauseReasons: [],
};

export class CoverExtractionSchedulerCore implements CoverExtractionScheduler {
  constructor(_deps: CoverExtractionSchedulerDeps) {
    void _deps;
  }

  async syncQueue(): Promise<void> {
    throw new Error("Not implemented");
  }

  setViewportVolumeIds(
    _screen: CoverViewportScreenKey,
    _volumeIds: ReadonlySet<string>,
  ): void {
    void _screen;
    void _volumeIds;
  }

  pause(_reason: CoverExtractionPauseReason): void {
    void _reason;
  }

  resume(_reason: CoverExtractionPauseReason): void {
    void _reason;
  }

  async retryFailedCovers(_options?: {
    readonly seriesId?: string;
  }): Promise<number> {
    void _options;
    throw new Error("Not implemented");
  }

  getSnapshot(): CoverExtractionProgressSnapshot {
    return EMPTY_SNAPSHOT;
  }

  subscribeProgress(
    _listener: (snapshot: CoverExtractionProgressSnapshot) => void,
  ): () => void {
    void _listener;
    return () => undefined;
  }

  subscribeVolumeUpdated(
    _listener: (event: CoverExtractionVolumeUpdateEvent) => void,
  ): () => void {
    void _listener;
    return () => undefined;
  }

  async resetForTest(): Promise<void> {
    throw new Error("Not implemented");
  }

  dispose(): void {
    // stub
  }
}

export class NoopCoverExtractionScheduler implements CoverExtractionScheduler {
  async syncQueue(): Promise<void> {
    return undefined;
  }

  setViewportVolumeIds(
    _screen: CoverViewportScreenKey,
    _volumeIds: ReadonlySet<string>,
  ): void {
    void _screen;
    void _volumeIds;
  }

  pause(_reason: CoverExtractionPauseReason): void {
    void _reason;
  }

  resume(_reason: CoverExtractionPauseReason): void {
    void _reason;
  }

  async retryFailedCovers(_options?: {
    readonly seriesId?: string;
  }): Promise<number> {
    void _options;
    return 0;
  }

  getSnapshot(): CoverExtractionProgressSnapshot {
    return EMPTY_SNAPSHOT;
  }

  subscribeProgress(
    _listener: (snapshot: CoverExtractionProgressSnapshot) => void,
  ): () => void {
    void _listener;
    return () => undefined;
  }

  subscribeVolumeUpdated(
    _listener: (event: CoverExtractionVolumeUpdateEvent) => void,
  ): () => void {
    void _listener;
    return () => undefined;
  }

  async resetForTest(): Promise<void> {
    return undefined;
  }

  dispose(): void {
    // no-op
  }
}
