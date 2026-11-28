import type { GoogleAuthBridge } from "../../bridges/oauth/types";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import type { DiagnosticLogger } from "../../diagnostics/types";
import {
  resolveRepresentativeVolumeNonEmpty,
  sortSeriesItems,
  type SortableSeriesFields,
} from "../../shared/bookshelf/seriesOrdering";
import type { DriveSyncRootsRepository } from "../../storage/repositories/driveSyncRootsRepository";
import type { SeriesRepository } from "../../storage/repositories/seriesRepository";
import {
  compareVolumesForDisplay,
  type VolumesRepository,
} from "../../storage/repositories/volumesRepository";
import type { ZipIndexCacheRepository } from "../../storage/repositories/zipIndexCacheRepository";
import type { SeriesRecord, VolumeRecord } from "../../storage/types";
import { ENGINE_BUDGETS } from "../constants";
import type { RandomAccessReader, ZipPageEntry } from "../types";
import { ZipArchiveError, isAbortError } from "../zip/errors";
import { validateZipIndexEntries } from "../zip/zipIndexValidation";
import { parseZipDirectory, readCompressedPageSlice } from "../zip/zipParser";
import type {
  CoverExtractionPauseReason,
  CoverExtractionPhase,
  CoverExtractionProgressSnapshot,
  CoverExtractionScheduler,
  CoverExtractionVolumeUpdateEvent,
  CoverViewportScreenKey,
  CoverWorkerClientHandle,
  EncodeCoverWebpResult,
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

const BG_MIN_INTERVAL_MS = Math.ceil(
  1_000 / ENGINE_BUDGETS.COVER_BG_MAX_PER_SECOND,
);

export function defaultAbortableSleep(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (ms <= 0 || signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timerId);
      resolve();
    };
    const timerId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function buildZipIndexCacheKey(volume: VolumeRecord): string {
  return `gdrive:${volume.driveFileId}:${volume.md5Checksum ?? volume.fileSize}`;
}

function formatErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof ZipArchiveError) || error.code !== "READ_ERROR") {
    return false;
  }
  if (error.isRateLimited === true || error.isUnauthorized === true) {
    return false;
  }
  if (error.httpStatus === undefined) {
    return true;
  }
  return error.httpStatus >= 500 && error.httpStatus < 600;
}

function prependUnique(queue: string[], volumeId: string): void {
  if (!queue.includes(volumeId)) {
    queue.unshift(volumeId);
  }
}

interface OrderedSeriesCoverEntry extends SortableSeriesFields {
  readonly representativeVolume: VolumeRecord;
  readonly sortedVolumes: readonly VolumeRecord[];
}

function buildPriorityOrder(
  activeSeries: readonly SeriesRecord[],
  visibleVolumes: readonly VolumeRecord[],
): {
  readonly representativeIds: string[];
  readonly otherIds: string[];
} {
  const volumesBySeries = new Map<string, VolumeRecord[]>();
  for (const volume of visibleVolumes) {
    const bucket = volumesBySeries.get(volume.seriesId);
    if (bucket) {
      bucket.push(volume);
    } else {
      volumesBySeries.set(volume.seriesId, [volume]);
    }
  }

  const unorderedEntries: OrderedSeriesCoverEntry[] = [];
  for (const series of activeSeries) {
    const seriesVolumes = volumesBySeries.get(series.id);
    if (seriesVolumes === undefined) {
      continue;
    }
    const sortedVolumes = [...seriesVolumes].sort(compareVolumesForDisplay) as [
      VolumeRecord,
      ...VolumeRecord[],
    ];
    let latestVolumeAddedAt = sortedVolumes[0].addedAt;
    for (const volume of sortedVolumes) {
      if (volume.addedAt > latestVolumeAddedAt) {
        latestVolumeAddedAt = volume.addedAt;
      }
    }
    unorderedEntries.push({
      seriesId: series.id,
      title: series.title,
      titleReading: series.titleReading,
      volumeCount: sortedVolumes.length,
      lastReadAt: series.lastReadAt,
      latestVolumeAddedAt,
      seriesAddedAt: series.addedAt,
      representativeVolume: resolveRepresentativeVolumeNonEmpty(
        series,
        sortedVolumes,
      ),
      sortedVolumes,
    });
  }

  const seriesItems = sortSeriesItems(unorderedEntries, "lastReadDesc");

  const representativeIds: string[] = [];
  const otherIds: string[] = [];
  const placedIds = new Set<string>();

  for (const item of seriesItems) {
    const rep = item.representativeVolume;
    if (rep.coverStatus === "pending") {
      representativeIds.push(rep.id);
      placedIds.add(rep.id);
    }
  }

  for (const item of seriesItems) {
    for (const volume of item.sortedVolumes) {
      if (volume.coverStatus === "pending" && !placedIds.has(volume.id)) {
        otherIds.push(volume.id);
        placedIds.add(volume.id);
      }
    }
  }

  const orphanPending = visibleVolumes
    .filter(
      (volume) => volume.coverStatus === "pending" && !placedIds.has(volume.id),
    )
    .sort(compareVolumesForDisplay);
  for (const volume of orphanPending) {
    otherIds.push(volume.id);
    placedIds.add(volume.id);
  }

  return { representativeIds, otherIds };
}

export class CoverExtractionSchedulerCore implements CoverExtractionScheduler {
  private readonly deps: CoverExtractionSchedulerDeps;
  private readonly logger: DiagnosticLogger;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  private readonly pauseReasons = new Set<CoverExtractionPauseReason>();
  private readonly viewportByScreen = new Map<
    CoverViewportScreenKey,
    ReadonlySet<string>
  >();
  private readonly progressListeners = new Set<
    (snapshot: CoverExtractionProgressSnapshot) => void
  >();
  private readonly volumeListeners = new Set<
    (event: CoverExtractionVolumeUpdateEvent) => void
  >();

  private enabledRootIds = new Set<string>();
  private pendingVolumesById = new Map<string, VolumeRecord>();
  private representativeOrder: string[] = [];
  private otherOrder: string[] = [];
  private representativeSet = new Set<string>();

  private viewportHighQueue: string[] = [];
  private backgroundRepQueue: string[] = [];
  private backgroundOtherQueue: string[] = [];
  private rateLimitAttempts = new Map<string, number>();
  private transientErrorAttempts = 0;
  private transientSuspended = false;

  private readyCount = 0;
  private pendingCount = 0;
  private errorCount = 0;
  private activeVolumeId: string | null = null;
  private phase: CoverExtractionPhase = "idle";
  private lastNetworkCompletedAt: number | null = null;

  private schedulerEpoch = 0;
  private activeAbortController: AbortController | null = null;
  private throttleAbortController: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;
  private syncPromise: Promise<void> | null = null;
  private resyncRequested = false;
  private workerClient: CoverWorkerClientHandle | null = null;
  private disposed = false;

  constructor(deps: CoverExtractionSchedulerDeps) {
    this.deps = deps;
    this.logger = deps.logger ?? diagnosticLogger;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? defaultAbortableSleep;
  }

  private getActiveViewportIds(): Set<string> {
    const merged = new Set<string>();
    for (const ids of this.viewportByScreen.values()) {
      for (const id of ids) {
        merged.add(id);
      }
    }
    return merged;
  }

  private hasQueuedWork(): boolean {
    return (
      this.viewportHighQueue.length > 0 ||
      this.backgroundRepQueue.length > 0 ||
      this.backgroundOtherQueue.length > 0
    );
  }

  private abortThrottleSleep(): void {
    if (this.throttleAbortController !== null) {
      this.throttleAbortController.abort();
      this.throttleAbortController = null;
    }
  }

  private abortActiveOperation(): void {
    if (this.activeAbortController !== null) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    this.abortThrottleSleep();
  }

  private shouldIncrementCompletedCount(
    wasPending: boolean,
    rootFolderId: string,
  ): boolean {
    return this.enabledRootIds.has(rootFolderId) && wasPending;
  }

  private handlePersistenceFailure(
    volumeId: string,
    message: string,
    saveError: unknown,
  ): null {
    if (this.disposed) {
      return null;
    }
    this.logger.error("cover", message, formatErrorDetail(saveError));
    this.rateLimitAttempts.delete(volumeId);
    this.transientErrorAttempts = 0;
    this.pendingVolumesById.delete(volumeId);
    this.pendingCount = this.pendingVolumesById.size;
    this.emitProgress();
    return null;
  }

  private computePhase(): CoverExtractionPhase {
    if (this.pauseReasons.size > 0) {
      return this.pendingCount > 0 ? "paused" : "idle";
    }
    if (this.phase === "backoff") {
      return "backoff";
    }
    if (this.transientSuspended) {
      return "idle";
    }
    if (this.activeVolumeId !== null || this.hasQueuedWork()) {
      return "running";
    }
    return "idle";
  }

  private buildSnapshot(): CoverExtractionProgressSnapshot {
    const phase = this.computePhase();
    return {
      phase,
      totalCount: this.readyCount + this.pendingCount + this.errorCount,
      readyCount: this.readyCount,
      pendingCount: this.pendingCount,
      errorCount: this.errorCount,
      activeVolumeId: this.activeVolumeId,
      pauseReasons: [...this.pauseReasons],
    };
  }

  private emitProgress(): void {
    const snapshot = this.buildSnapshot();
    for (const listener of [...this.progressListeners]) {
      listener(snapshot);
    }
  }

  private emitVolumeUpdated(event: CoverExtractionVolumeUpdateEvent): void {
    for (const listener of [...this.volumeListeners]) {
      listener(event);
    }
  }

  private rebuildQueuesFromOrders(): void {
    const activeViewportIds = this.getActiveViewportIds();
    const nextHigh: string[] = [];
    const nextBgRep: string[] = [];
    const nextBgOther: string[] = [];

    for (const id of this.representativeOrder) {
      if (id === this.activeVolumeId || !this.pendingVolumesById.has(id)) {
        continue;
      }
      if (activeViewportIds.has(id)) {
        nextHigh.push(id);
      } else {
        nextBgRep.push(id);
      }
    }

    for (const id of this.otherOrder) {
      if (id === this.activeVolumeId || !this.pendingVolumesById.has(id)) {
        continue;
      }
      if (activeViewportIds.has(id)) {
        nextHigh.push(id);
      } else {
        nextBgOther.push(id);
      }
    }

    this.viewportHighQueue = nextHigh;
    this.backgroundRepQueue = nextBgRep;
    this.backgroundOtherQueue = nextBgOther;
  }

  private requeueFront(volumeId: string): void {
    if (!this.pendingVolumesById.has(volumeId)) {
      return;
    }
    const activeViewportIds = this.getActiveViewportIds();
    if (activeViewportIds.has(volumeId)) {
      prependUnique(this.viewportHighQueue, volumeId);
      return;
    }
    if (this.representativeSet.has(volumeId)) {
      prependUnique(this.backgroundRepQueue, volumeId);
      return;
    }
    prependUnique(this.backgroundOtherQueue, volumeId);
  }

  private ensureWorkerClient(): CoverWorkerClientHandle {
    if (this.workerClient !== null && this.workerClient.isBroken()) {
      this.workerClient.dispose();
      this.workerClient = null;
    }
    if (this.workerClient === null) {
      this.workerClient = this.deps.createWorkerClient();
    }
    return this.workerClient;
  }

  private ensureLoopRunning(): void {
    if (
      this.disposed ||
      this.transientSuspended ||
      this.pauseReasons.size > 0 ||
      this.loopPromise !== null ||
      !this.hasQueuedWork()
    ) {
      return;
    }
    const epoch = this.schedulerEpoch;
    const promise = this.runLoop(epoch)
      .catch((error) => {
        this.logger.error(
          "cover",
          "表紙抽出スケジューラループで予期しないエラーが発生しました",
          formatErrorDetail(error),
        );
      })
      .finally(() => {
        if (this.loopPromise === promise) {
          this.loopPromise = null;
        }
        if (
          !this.disposed &&
          !this.transientSuspended &&
          this.pauseReasons.size === 0 &&
          this.hasQueuedWork()
        ) {
          this.ensureLoopRunning();
        } else {
          this.phase = "idle";
          this.emitProgress();
        }
      });
    this.loopPromise = promise;
  }

  private isEpochActive(epoch: number, signal?: AbortSignal): boolean {
    return (
      !this.disposed &&
      epoch === this.schedulerEpoch &&
      this.pauseReasons.size === 0 &&
      !(signal?.aborted ?? false)
    );
  }

  private assertEpochActive(epoch: number, signal: AbortSignal): void {
    if (!this.isEpochActive(epoch, signal)) {
      throw new DOMException("Aborted", "AbortError");
    }
  }

  private takeNextVolumeId(): string | undefined {
    return (
      this.viewportHighQueue.shift() ??
      this.backgroundRepQueue.shift() ??
      this.backgroundOtherQueue.shift()
    );
  }

  private async runLoop(epoch: number): Promise<void> {
    while (this.isEpochActive(epoch) && !this.transientSuspended) {
      if (this.viewportHighQueue.length === 0 && this.hasQueuedWork()) {
        const waitMs =
          this.lastNetworkCompletedAt === null
            ? 0
            : Math.max(
                0,
                this.lastNetworkCompletedAt + BG_MIN_INTERVAL_MS - this.now(),
              );
        if (waitMs > 0) {
          const throttleCtrl = new AbortController();
          this.throttleAbortController = throttleCtrl;
          await this.sleep(waitMs, throttleCtrl.signal);
          if (this.throttleAbortController === throttleCtrl) {
            this.throttleAbortController = null;
          }
          if (!this.isEpochActive(epoch) || !this.hasQueuedWork()) {
            break;
          }
          if (this.viewportHighQueue.length > 0) {
            continue;
          }
        }
      }

      const nextVolumeId = this.takeNextVolumeId();
      if (nextVolumeId === undefined) {
        break;
      }
      this.activeVolumeId = nextVolumeId;
      this.phase = "running";
      this.emitProgress();

      let backoffMs: number | null;
      try {
        backoffMs = await this.processVolume(nextVolumeId, epoch);
      } finally {
        if (this.activeVolumeId === nextVolumeId) {
          this.activeVolumeId = null;
        }
      }

      if (this.transientSuspended) {
        break;
      }

      if (backoffMs !== null && this.isEpochActive(epoch)) {
        this.phase = "backoff";
        this.emitProgress();
        const backoffCtrl = new AbortController();
        this.activeAbortController = backoffCtrl;
        await this.sleep(backoffMs, backoffCtrl.signal);
        if (this.activeAbortController === backoffCtrl) {
          this.activeAbortController = null;
        }
        this.phase = "idle";
      }
    }
  }

  private async extractAndEncode(
    volume: VolumeRecord,
    reader: RandomAccessReader,
    entries: readonly ZipPageEntry[],
    signal: AbortSignal,
    epoch: number,
  ): Promise<EncodeCoverWebpResult> {
    const targetEntry = entries[volume.coverPageIndex];
    if (targetEntry === undefined) {
      throw new ZipArchiveError(
        "CORRUPT_ZIP",
        `coverPageIndex(${volume.coverPageIndex})がアーカイブのページ数(${entries.length})を超過しています`,
      );
    }

    const compressedSlice = await readCompressedPageSlice(
      reader,
      targetEntry,
      signal,
    );
    this.assertEpochActive(epoch, signal);

    const workerClient = this.ensureWorkerClient();
    const encoded = await workerClient.api.encodeCoverWebp(
      compressedSlice,
      targetEntry.compressionMethod,
      { expectedUncompressedSize: targetEntry.uncompressedSize },
    );
    this.assertEpochActive(epoch, signal);

    return encoded;
  }

  private async processVolume(
    volumeId: string,
    epoch: number,
  ): Promise<number | null> {
    const controller = new AbortController();
    this.activeAbortController = controller;
    const networkState = { didRead: false };

    try {
      return await this.executeVolumeExtraction(
        volumeId,
        epoch,
        controller.signal,
        networkState,
      );
    } finally {
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
      }
      if (networkState.didRead) {
        this.lastNetworkCompletedAt = this.now();
      }
    }
  }

  private async executeVolumeExtraction(
    volumeId: string,
    epoch: number,
    signal: AbortSignal,
    networkState: { didRead: boolean },
  ): Promise<number | null> {
    let latest: VolumeRecord | null = null;

    try {
      latest = await this.deps.volumesRepo.getById(volumeId);
      this.assertEpochActive(epoch, signal);

      if (
        latest === null ||
        latest.coverStatus !== "pending" ||
        latest.isTrashed !== 0 ||
        !this.enabledRootIds.has(latest.rootFolderId)
      ) {
        this.pendingVolumesById.delete(volumeId);
        this.rateLimitAttempts.delete(volumeId);
        this.pendingCount = this.pendingVolumesById.size;
        this.emitProgress();
        return null;
      }

      const baseReader = this.deps.createRangeReader(latest);
      const trackedReader: RandomAccessReader = {
        sourceId: baseReader.sourceId,
        totalSize: baseReader.totalSize,
        readRange: async (offset, length, readSignal) => {
          networkState.didRead = true;
          return baseReader.readRange(offset, length, readSignal);
        },
      };

      const isExactSizeReader = trackedReader.totalSize === latest.fileSize;
      const cacheKey = buildZipIndexCacheKey(latest);
      let fromIndexCache = false;
      let entries: readonly ZipPageEntry[];

      const cachedEntries = isExactSizeReader
        ? await this.deps.zipIndexCacheRepo.get(cacheKey)
        : null;
      this.assertEpochActive(epoch, signal);

      if (cachedEntries !== null && validateZipIndexEntries(cachedEntries)) {
        entries = cachedEntries;
        fromIndexCache = true;
      } else {
        entries = await parseZipDirectory(trackedReader, signal);
        this.assertEpochActive(epoch, signal);
        if (isExactSizeReader) {
          void this.deps.zipIndexCacheRepo
            .put(cacheKey, entries)
            .catch(() => undefined);
        }
      }

      let encoded: EncodeCoverWebpResult;
      try {
        encoded = await this.extractAndEncode(
          latest,
          trackedReader,
          entries,
          signal,
          epoch,
        );
      } catch (extractError) {
        if (
          fromIndexCache &&
          extractError instanceof ZipArchiveError &&
          (extractError.code === "CORRUPT_ZIP" ||
            extractError.code === "DECODE_FAILED")
        ) {
          await this.deps.zipIndexCacheRepo.delete(cacheKey);
          this.assertEpochActive(epoch, signal);
          const freshEntries = await parseZipDirectory(trackedReader, signal);
          this.assertEpochActive(epoch, signal);
          void this.deps.zipIndexCacheRepo
            .put(cacheKey, freshEntries)
            .catch(() => undefined);
          encoded = await this.extractAndEncode(
            latest,
            trackedReader,
            freshEntries,
            signal,
            epoch,
          );
        } else {
          throw extractError;
        }
      }

      let saved: VolumeRecord | null;
      try {
        saved = await this.deps.volumesRepo.saveCoverReady({
          volumeId: latest.id,
          expectedMd5Checksum: latest.md5Checksum,
          expectedFileSize: latest.fileSize,
          coverBlob: encoded.blob,
        });
      } catch (saveError) {
        return this.handlePersistenceFailure(
          volumeId,
          `表紙WebPの保存に失敗したため当該セッションではスキップします: volumeId=${volumeId}`,
          saveError,
        );
      }
      if (this.disposed) {
        return null;
      }
      this.rateLimitAttempts.delete(volumeId);
      this.transientErrorAttempts = 0;
      const wasPending = this.pendingVolumesById.delete(volumeId);
      this.pendingCount = this.pendingVolumesById.size;

      if (saved !== null) {
        if (
          this.shouldIncrementCompletedCount(wasPending, saved.rootFolderId)
        ) {
          this.readyCount += 1;
        }
        this.emitVolumeUpdated({
          volumeId: saved.id,
          seriesId: saved.seriesId,
          coverStatus: "ready",
          coverBlob: saved.coverBlob,
          coverUpdatedAt: saved.coverUpdatedAt,
        });
      }
      this.emitProgress();
      return null;
    } catch (error) {
      if (!this.isEpochActive(epoch, signal) || isAbortError(error)) {
        this.requeueFront(volumeId);
        return null;
      }

      if (error instanceof ZipArchiveError && error.isRateLimited === true) {
        const attempts = this.rateLimitAttempts.get(volumeId) ?? 0;
        if (attempts < ENGINE_BUDGETS.COVER_RATE_LIMIT_MAX_RETRIES) {
          this.rateLimitAttempts.set(volumeId, attempts + 1);
          this.requeueFront(volumeId);
          return (
            ENGINE_BUDGETS.COVER_RATE_LIMIT_BASE_BACKOFF_MS * 2 ** attempts
          );
        }
      }

      if (
        error instanceof ZipArchiveError &&
        error.isUnauthorized === true &&
        (this.deps.googleAuthBridge.getCachedSession() === null ||
          error.httpStatus !== 401)
      ) {
        this.requeueFront(volumeId);
        this.pause("unauthenticated");
        return null;
      }

      if (isTransientNetworkError(error)) {
        this.requeueFront(volumeId);
        if (
          this.transientErrorAttempts <
          ENGINE_BUDGETS.COVER_RATE_LIMIT_MAX_RETRIES
        ) {
          const backoffMs =
            ENGINE_BUDGETS.COVER_RATE_LIMIT_BASE_BACKOFF_MS *
            2 ** this.transientErrorAttempts;
          this.transientErrorAttempts += 1;
          return backoffMs;
        }
        this.logger.warn(
          "cover",
          `一時的な通信障害が継続しているため表紙抽出を待機停止します（pending維持）: volumeId=${volumeId}`,
          formatErrorDetail(error),
        );
        this.transientErrorAttempts = 0;
        this.transientSuspended = true;
        return null;
      }

      this.logger.warn(
        "cover",
        `表紙抽出に失敗したためエラーとして確定します: volumeId=${volumeId}`,
        formatErrorDetail(error),
      );
      this.rateLimitAttempts.delete(volumeId);
      this.transientErrorAttempts = 0;

      if (latest !== null) {
        let saved: VolumeRecord | null;
        try {
          saved = await this.deps.volumesRepo.saveCoverError({
            volumeId: latest.id,
            expectedMd5Checksum: latest.md5Checksum,
            expectedFileSize: latest.fileSize,
          });
        } catch (saveError) {
          return this.handlePersistenceFailure(
            volumeId,
            `表紙抽出エラー状態の保存に失敗しました: volumeId=${volumeId}`,
            saveError,
          );
        }
        if (this.disposed) {
          return null;
        }
        const wasPending = this.pendingVolumesById.delete(volumeId);
        this.pendingCount = this.pendingVolumesById.size;
        if (saved !== null) {
          if (
            this.shouldIncrementCompletedCount(wasPending, saved.rootFolderId)
          ) {
            this.errorCount += 1;
          }
          this.emitVolumeUpdated({
            volumeId: saved.id,
            seriesId: saved.seriesId,
            coverStatus: "error",
            coverBlob: null,
            coverUpdatedAt: saved.coverUpdatedAt,
          });
        }
      } else {
        this.pendingVolumesById.delete(volumeId);
        this.pendingCount = this.pendingVolumesById.size;
      }
      this.emitProgress();
      return null;
    }
  }

  private async runSyncPass(): Promise<void> {
    if (this.deps.googleAuthBridge.getCachedSession() !== null) {
      this.pauseReasons.delete("unauthenticated");
    }

    let enabledRootIds: Set<string>;
    let visibleVolumes: readonly VolumeRecord[];
    let activeSeries: readonly SeriesRecord[];
    try {
      const activeRoots = await this.deps.driveSyncRootsRepo.listActive();
      enabledRootIds = new Set(
        activeRoots
          .filter((root) => root.enabled === 1)
          .map((root) => root.folderId),
      );
      [visibleVolumes, activeSeries] = await Promise.all([
        this.deps.volumesRepo.listVisibleByEnabledRoots(enabledRootIds),
        this.deps.seriesRepo.listActive(),
      ]);
    } catch (error) {
      this.logger.error(
        "cover",
        "表紙抽出キューの同期に失敗しました",
        formatErrorDetail(error),
      );
      return;
    }

    if (this.disposed) {
      return;
    }

    this.enabledRootIds = enabledRootIds;
    this.transientSuspended = false;
    this.transientErrorAttempts = 0;

    let ready = 0;
    let error = 0;
    const nextPendingMap = new Map<string, VolumeRecord>();
    for (const volume of visibleVolumes) {
      if (volume.coverStatus === "ready") {
        ready += 1;
      } else if (volume.coverStatus === "error") {
        error += 1;
      } else {
        nextPendingMap.set(volume.id, volume);
      }
    }

    if (
      this.activeVolumeId !== null &&
      !nextPendingMap.has(this.activeVolumeId)
    ) {
      this.schedulerEpoch += 1;
      this.abortActiveOperation();
      this.activeVolumeId = null;
    }

    const { representativeIds, otherIds } = buildPriorityOrder(
      activeSeries,
      visibleVolumes,
    );

    this.pendingVolumesById = nextPendingMap;
    this.representativeOrder = representativeIds;
    this.otherOrder = otherIds;
    this.representativeSet = new Set(representativeIds);
    this.readyCount = ready;
    this.pendingCount = nextPendingMap.size;
    this.errorCount = error;

    this.rebuildQueuesFromOrders();
    if (!this.hasQueuedWork()) {
      this.abortThrottleSleep();
    }
    this.emitProgress();
    this.ensureLoopRunning();
  }

  syncQueue(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    if (this.syncPromise !== null) {
      this.resyncRequested = true;
      return this.syncPromise;
    }

    const promise = (async () => {
      do {
        this.resyncRequested = false;
        await this.runSyncPass();
      } while (this.resyncRequested && !this.disposed);
    })().finally(() => {
      if (this.syncPromise === promise) {
        this.syncPromise = null;
      }
    });

    this.syncPromise = promise;
    return promise;
  }

  setViewportVolumeIds(
    screen: CoverViewportScreenKey,
    volumeIds: ReadonlySet<string>,
  ): void {
    if (this.disposed) {
      return;
    }
    this.viewportByScreen.set(screen, new Set(volumeIds));
    this.rebuildQueuesFromOrders();

    if (this.viewportHighQueue.length > 0) {
      this.abortThrottleSleep();
    }
  }

  pause(reason: CoverExtractionPauseReason): void {
    if (this.disposed) {
      return;
    }
    const added = !this.pauseReasons.has(reason);
    this.pauseReasons.add(reason);
    if (added) {
      this.schedulerEpoch += 1;
      this.abortActiveOperation();
      this.phase = "idle";
      this.emitProgress();
    }
  }

  resume(reason: CoverExtractionPauseReason): void {
    if (this.disposed) {
      return;
    }
    const removed = this.pauseReasons.delete(reason);
    if (!removed) {
      return;
    }
    this.transientSuspended = false;
    this.transientErrorAttempts = 0;
    this.emitProgress();
    this.ensureLoopRunning();
  }

  async retryFailedCovers(options?: {
    readonly seriesId?: string;
  }): Promise<number> {
    if (this.disposed) {
      return 0;
    }
    let resetVolumes: readonly VolumeRecord[];
    try {
      const activeRoots = await this.deps.driveSyncRootsRepo.listActive();
      const enabledRootIds = new Set(
        activeRoots
          .filter((root) => root.enabled === 1)
          .map((root) => root.folderId),
      );
      resetVolumes = await this.deps.volumesRepo.resetErrorCoversToPending({
        enabledRootIds,
        seriesId: options?.seriesId,
      });
    } catch (error) {
      this.logger.error(
        "cover",
        "エラー表紙の再試行リセットに失敗しました",
        formatErrorDetail(error),
      );
      return 0;
    }

    for (const volume of resetVolumes) {
      this.rateLimitAttempts.delete(volume.id);
      this.emitVolumeUpdated({
        volumeId: volume.id,
        seriesId: volume.seriesId,
        coverStatus: "pending",
        coverBlob: null,
        coverUpdatedAt: null,
      });
    }

    await this.syncQueue();
    return resetVolumes.length;
  }

  getSnapshot(): CoverExtractionProgressSnapshot {
    return this.buildSnapshot();
  }

  subscribeProgress(
    listener: (snapshot: CoverExtractionProgressSnapshot) => void,
  ): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  subscribeVolumeUpdated(
    listener: (event: CoverExtractionVolumeUpdateEvent) => void,
  ): () => void {
    this.volumeListeners.add(listener);
    return () => {
      this.volumeListeners.delete(listener);
    };
  }

  async resetForTest(): Promise<void> {
    this.schedulerEpoch += 1;
    this.resyncRequested = false;
    this.abortActiveOperation();

    if (this.loopPromise !== null) {
      await this.loopPromise;
    }

    this.pauseReasons.clear();
    this.viewportByScreen.clear();
    this.enabledRootIds.clear();
    this.pendingVolumesById.clear();
    this.representativeOrder = [];
    this.otherOrder = [];
    this.representativeSet.clear();
    this.viewportHighQueue = [];
    this.backgroundRepQueue = [];
    this.backgroundOtherQueue = [];
    this.rateLimitAttempts.clear();
    this.transientErrorAttempts = 0;
    this.transientSuspended = false;
    this.readyCount = 0;
    this.pendingCount = 0;
    this.errorCount = 0;
    this.activeVolumeId = null;
    this.phase = "idle";
    this.lastNetworkCompletedAt = null;
    this.emitProgress();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.schedulerEpoch += 1;
    this.resyncRequested = false;
    this.abortActiveOperation();
    if (this.workerClient !== null) {
      this.workerClient.dispose();
      this.workerClient = null;
    }
    this.progressListeners.clear();
    this.volumeListeners.clear();
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
