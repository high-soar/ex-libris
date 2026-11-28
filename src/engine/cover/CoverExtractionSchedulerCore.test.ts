import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleAuthSession } from "../../bridges/oauth/types";
import { createDiagnosticLogger } from "../../diagnostics/diagnosticLogger";
import { db, resetTestDb } from "../../storage/db";
import { DexieDriveSyncRootsRepository } from "../../storage/repositories/driveSyncRootsRepository";
import { DexieSeriesRepository } from "../../storage/repositories/seriesRepository";
import { DexieVolumesRepository } from "../../storage/repositories/volumesRepository";
import { DexieZipIndexCacheRepository } from "../../storage/repositories/zipIndexCacheRepository";
import type { SeriesRecord, VolumeRecord } from "../../storage/types";
import type { RandomAccessReader } from "../types";
import {
  buildSyntheticZip,
  createMemoryReader,
} from "../zip/__fixtures__/zipBuilder";
import { ZipArchiveError } from "../zip/errors";
import {
  CoverExtractionSchedulerCore,
  NoopCoverExtractionScheduler,
  defaultAbortableSleep,
  type CoverExtractionSchedulerDeps,
} from "./CoverExtractionSchedulerCore";
import type {
  CoverExtractionProgressSnapshot,
  CoverExtractionVolumeUpdateEvent,
  CoverWorkerClientHandle,
} from "./types";

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSeries(overrides: Partial<SeriesRecord> = {}): SeriesRecord {
  return {
    id: "s-1",
    title: "作品A",
    titleReading: "さくひんa",
    authors: [],
    publisher: "",
    label: "",
    tags: [],
    synopsis: "",
    publicationStatus: "unknown",
    knownTotalVolumes: null,
    externalIds: {},
    metadataLocked: false,
    representativeVolumeId: null,
    readerPresetJson: null,
    lastReadAt: null,
    addedAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    ...overrides,
  };
}

function makeVolume(
  zipSize: number,
  overrides: Partial<VolumeRecord> = {},
): VolumeRecord {
  return {
    id: "v-1",
    seriesId: "s-1",
    volumeNumber: 1,
    volumeLabel: "第01巻",
    rawFileName: "作品A 第01巻.cbz",
    driveFileId: "df-1",
    parentFolderId: "root-1",
    rootFolderId: "root-1",
    fileSize: zipSize,
    md5Checksum: "md5-1",
    driveModifiedTime: 1000,
    coverBlob: null,
    coverStatus: "pending",
    coverCropMode: "auto",
    coverPageIndex: 0,
    coverUpdatedAt: null,
    isTrashed: 0,
    addedAt: 1000,
    updatedAt: 1500,
    ...overrides,
  };
}

function makeZipBytes(payload = new Uint8Array([1, 2, 3, 4])): Uint8Array {
  return buildSyntheticZip({
    entries: [{ name: "001.jpg", data: payload, compressionMethod: 0 }],
  });
}

async function waitForIdle(
  scheduler: CoverExtractionSchedulerCore,
  predicate: (s: CoverExtractionProgressSnapshot) => boolean = (s) =>
    s.phase === "idle",
): Promise<CoverExtractionProgressSnapshot> {
  if (predicate(scheduler.getSnapshot())) {
    return scheduler.getSnapshot();
  }
  return new Promise((resolve) => {
    const unsub = scheduler.subscribeProgress((snap) => {
      if (predicate(snap)) {
        unsub();
        resolve(snap);
      }
    });
  });
}

function createMockWorkerClient(
  encodeImpl?: CoverWorkerClientHandle["api"]["encodeCoverWebp"],
) {
  let broken = false;
  const dispose = vi.fn();
  const encodeCoverWebp = vi.fn(
    encodeImpl ??
      (async () => ({
        blob: new Blob([new Uint8Array([7, 8, 9])], { type: "image/webp" }),
        width: 200,
        height: 300,
      })),
  );
  const handle: CoverWorkerClientHandle = {
    api: { encodeCoverWebp },
    isBroken: () => broken,
    dispose,
  };
  return {
    handle,
    encodeCoverWebp,
    dispose,
    setBroken: (next: boolean) => {
      broken = next;
    },
  };
}

describe("CoverExtractionSchedulerCore", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(async () => {
    await resetTestDb();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function seedEnabledRoot(folderId = "root-1") {
    await db.driveSyncRoots.put({
      folderId,
      folderName: "Comics",
      enabled: 1,
      addedAt: 1000,
      updatedAt: 1000,
      deletedAt: null,
    });
  }

  function createBaseDeps(
    zipBytes: Uint8Array,
    overrides: Partial<CoverExtractionSchedulerDeps> = {},
  ): CoverExtractionSchedulerDeps {
    const session: GoogleAuthSession = {
      email: "reader@example.com",
      accessToken: "ya29.token",
      expiresAt: Date.now() + 3_600_000,
    };
    return {
      driveSyncRootsRepo: new DexieDriveSyncRootsRepository(db),
      seriesRepo: new DexieSeriesRepository(db),
      volumesRepo: new DexieVolumesRepository(db),
      zipIndexCacheRepo: new DexieZipIndexCacheRepository(db),
      googleAuthBridge: {
        getCachedSession: () => session,
      },
      createRangeReader: (volume) =>
        createMemoryReader(zipBytes, `gdrive:${volume.driveFileId}`),
      createWorkerClient: () => createMockWorkerClient().handle,
      logger: createDiagnosticLogger(),
      now: () => 10_000,
      sleep: async () => undefined,
      ...overrides,
    };
  }

  it("background-lowは①代表表紙巻→②収録巻→孤立巻の順で500ms間隔処理し、viewport-highは0ms優先・画面外降格・待機即時起床すること (AC-COV-02, AC-COV-03)", async () => {
    await seedEnabledRoot();
    const zipBytes = makeZipBytes();

    await db.series.bulkPut([
      makeSeries({ id: "s-old", title: "旧作", lastReadAt: 1000 }),
      makeSeries({
        id: "s-recent",
        title: "最近",
        lastReadAt: 5000,
        representativeVolumeId: "v-rec-2",
      }),
    ]);

    await db.volumes.bulkPut([
      makeVolume(zipBytes.byteLength, {
        id: "v-rec-1",
        seriesId: "s-recent",
        volumeNumber: 1,
        driveFileId: "df-rec-1",
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-rec-2",
        seriesId: "s-recent",
        volumeNumber: 2,
        driveFileId: "df-rec-2",
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-old-1",
        seriesId: "s-old",
        volumeNumber: 1,
        driveFileId: "df-old-1",
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-orphan",
        seriesId: "s-missing",
        volumeNumber: 1,
        driveFileId: "df-orphan",
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-already-error",
        seriesId: "s-old",
        volumeNumber: 2,
        driveFileId: "df-err",
        coverStatus: "error",
      }),
    ]);

    let nowMs = 1_000;
    const sleepCalls: number[] = [];
    const processedOrder: string[] = [];
    const sleepGates: Array<{
      ms: number;
      signal: AbortSignal;
      resolve: () => void;
    }> = [];

    const scheduler = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        now: () => nowMs,
        sleep: (ms, signal) => {
          sleepCalls.push(ms);
          return new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            const onAbort = () => resolve();
            signal.addEventListener("abort", onAbort, { once: true });
            sleepGates.push({
              ms,
              signal,
              resolve: () => {
                signal.removeEventListener("abort", onAbort);
                nowMs += ms;
                resolve();
              },
            });
          });
        },
        createRangeReader: (volume) => {
          processedOrder.push(volume.id);
          return createMemoryReader(zipBytes, `gdrive:${volume.driveFileId}`);
        },
      }),
    );

    const volumeEvents: CoverExtractionVolumeUpdateEvent[] = [];
    const unsubVol = scheduler.subscribeVolumeUpdated((ev) =>
      volumeEvents.push(ev),
    );

    // 初期は v-orphan を viewport-high に設定 → その後すぐ v-old-1 へ変更（v-orphan は画面外降格）
    scheduler.setViewportVolumeIds("bookshelf", new Set(["v-orphan"]));
    scheduler.setViewportVolumeIds("bookshelf", new Set(["v-old-1"]));
    // 初期 syncQueue 起動（最初の 1 冊 v-old-1 は viewport-high 0ms で即処理、次に v-rec-2 の前の 500ms スリープで待機）
    await scheduler.syncQueue();

    // 1冊目 (v-old-1) 完了後、background-low (v-rec-2) の前に 500ms 待機に入るはず
    await vi.waitFor(() => {
      expect(processedOrder).toEqual(["v-old-1"]);
      expect(sleepGates).toHaveLength(1);
    });
    expect(sleepCalls).toEqual([500]);

    // 500ms 待機中に v-rec-1 を series-detail で viewport-high 昇格 → タイマー即時起床で v-rec-1 が 0ms 実行されること
    scheduler.setViewportVolumeIds("series-detail", new Set(["v-rec-1"]));
    await vi.waitFor(() => {
      expect(processedOrder).toEqual(["v-old-1", "v-rec-1"]);
      expect(sleepGates).toHaveLength(2);
    });

    // 以降の background-low スリープを順次消化（残りは代表表紙 v-rec-2 → 孤立巻 v-orphan の順、error 巻は自動投入されない）
    sleepGates[1]!.resolve();
    await vi.waitFor(() => {
      expect(processedOrder).toEqual(["v-old-1", "v-rec-1", "v-rec-2"]);
      expect(sleepGates).toHaveLength(3);
    });

    sleepGates[2]!.resolve();
    const finalSnap = await waitForIdle(scheduler);

    expect(processedOrder).toEqual([
      "v-old-1",
      "v-rec-1",
      "v-rec-2",
      "v-orphan",
    ]);
    expect(finalSnap).toMatchObject({
      phase: "idle",
      totalCount: 5,
      readyCount: 4,
      pendingCount: 0,
      errorCount: 1,
      activeVolumeId: null,
    });
    expect(volumeEvents).toHaveLength(4);
    expect(volumeEvents.every((e) => e.coverStatus === "ready")).toBe(true);

    // updatedAt が一切汚染されていないこと
    const updatedVol = await db.volumes.get("v-rec-2");
    expect(updatedVol?.updatedAt).toBe(1500);

    unsubVol();
    scheduler.dispose();
  });

  it("zipIndexCacheの0RTT再利用・還元保存・破損キャッシュ1回限り自己修復・非一致サイズリーダー時のスキップが動作すること (AC-COV-04)", async () => {
    await seedEnabledRoot();
    const zipBytes = makeZipBytes();
    const zipIndexCacheRepo = new DexieZipIndexCacheRepository(db);

    await db.series.put(makeSeries({ id: "s-1" }));
    await db.volumes.bulkPut([
      makeVolume(zipBytes.byteLength, {
        id: "v-miss",
        driveFileId: "df-miss",
        md5Checksum: "md5-miss",
        volumeNumber: 1,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-hit",
        driveFileId: "df-hit",
        md5Checksum: null,
        volumeNumber: 2,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-repair",
        driveFileId: "df-repair",
        md5Checksum: "md5-repair",
        volumeNumber: 3,
      }),
      makeVolume(zipBytes.byteLength + 999, {
        id: "v-mock-size",
        driveFileId: "df-mock-size",
        md5Checksum: "md5-mock",
        volumeNumber: 4,
      }),
    ]);

    const readsByVolume = new Map<string, number>();

    // v-hit 用に有効キャッシュを先行投入
    const validEntries = [
      {
        pageIndex: 0,
        entryName: "001.jpg",
        entryNameByteLength: 7,
        compressionMethod: 0 as const,
        compressedSize: 4,
        uncompressedSize: 4,
        localHeaderOffset: 0,
        physicalEnd: 37 + 4,
        crc32: 0,
      },
    ];
    await zipIndexCacheRepo.put(
      `gdrive:df-hit:${zipBytes.byteLength}`,
      validEntries,
    );

    // v-repair 用に壊れたオフセットのキャッシュを先行投入（LFH シグネチャ不一致で CORRUPT_ZIP → 1回自己修復）
    await zipIndexCacheRepo.put("gdrive:df-repair:md5-repair", [
      {
        ...validEntries[0]!,
        localHeaderOffset: 10,
        physicalEnd: 50,
      },
    ]);

    const scheduler = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        zipIndexCacheRepo,
        createRangeReader: (volume) => {
          const spy = createMemoryReader(
            zipBytes,
            `gdrive:${volume.driveFileId}`,
          );
          return {
            sourceId: spy.sourceId,
            totalSize: spy.totalSize,
            async readRange(offset, length, signal) {
              readsByVolume.set(
                volume.id,
                (readsByVolume.get(volume.id) ?? 0) + 1,
              );
              return spy.readRange(offset, length, signal);
            },
          };
        },
      }),
    );

    await scheduler.syncQueue();
    const snap = await waitForIdle(scheduler);
    expect(snap.readyCount).toBe(4);
    expect(snap.errorCount).toBe(0);

    // v-miss: 1回目 parseZipDirectory + 2回目 readCompressedPageSlice = 2 RTT、かつ zipIndexCache へ還元保存
    expect(readsByVolume.get("v-miss")).toBe(2);
    expect(
      await zipIndexCacheRepo.get("gdrive:df-miss:md5-miss"),
    ).not.toBeNull();

    // v-hit: zipIndexCache ヒットにより parseZipDirectory 省略 = 1 RTT (0 RTT 目次)
    expect(readsByVolume.get("v-hit")).toBe(1);

    // v-repair: キャッシュ由来LFH失敗(1) → delete → 再 parseZipDirectory(2) → 正常LFH取得(3)
    expect(readsByVolume.get("v-repair")).toBe(3);
    const repairedCache = await zipIndexCacheRepo.get(
      "gdrive:df-repair:md5-repair",
    );
    expect(repairedCache?.[0]?.localHeaderOffset).toBe(0);

    // v-mock-size: reader.totalSize !== volume.fileSize のため zipIndexCache を読み書きしない
    expect(
      await zipIndexCacheRepo.get("gdrive:df-mock-size:md5-mock"),
    ).toBeNull();

    scheduler.dispose();
  });

  it("429/403 Rate Limitで1s→2s→4sの指数バックオフを行い3回以内は回復し4回目失敗でerror化すること (AC-COV-06)", async () => {
    await seedEnabledRoot();
    const zipBytes = makeZipBytes();
    await db.series.put(makeSeries({ id: "s-1" }));
    await db.volumes.bulkPut([
      makeVolume(zipBytes.byteLength, {
        id: "v-recover",
        driveFileId: "df-recover",
        volumeNumber: 1,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-exhaust",
        driveFileId: "df-exhaust",
        volumeNumber: 2,
      }),
    ]);

    const attemptsByVol = new Map<string, number>();
    const backoffWaits: number[] = [];
    const phasesSeen: string[] = [];

    const scheduler = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        sleep: async (ms) => {
          if (ms >= 1000) {
            backoffWaits.push(ms);
          }
        },
        createRangeReader: (volume) => {
          const spy = createMemoryReader(
            zipBytes,
            `gdrive:${volume.driveFileId}`,
          );
          return {
            sourceId: spy.sourceId,
            totalSize: spy.totalSize,
            async readRange(offset, length, signal) {
              const count = (attemptsByVol.get(volume.id) ?? 0) + 1;
              attemptsByVol.set(volume.id, count);
              if (volume.id === "v-recover" && count <= 2) {
                throw new ZipArchiveError("READ_ERROR", "429", undefined, {
                  httpStatus: 429,
                  isRateLimited: true,
                });
              }
              if (volume.id === "v-exhaust") {
                throw new ZipArchiveError("READ_ERROR", "403 RL", undefined, {
                  httpStatus: 403,
                  isRateLimited: true,
                });
              }
              return spy.readRange(offset, length, signal);
            },
          };
        },
      }),
    );

    scheduler.subscribeProgress((s) => phasesSeen.push(s.phase));
    await scheduler.syncQueue();
    const snap = await waitForIdle(scheduler);

    expect(phasesSeen).toContain("backoff");
    // v-recover: 1000, 2000 で回復。v-exhaust: 1000, 2000, 4000 の計3回リトライ後に4回目失敗で error 確定
    expect(backoffWaits).toEqual([1000, 2000, 1000, 2000, 4000]);
    expect(snap).toMatchObject({
      phase: "idle",
      totalCount: 2,
      readyCount: 1,
      pendingCount: 0,
      errorCount: 1,
    });
    expect((await db.volumes.get("v-recover"))?.coverStatus).toBe("ready");
    expect((await db.volumes.get("v-exhaust"))?.coverStatus).toBe("error");

    scheduler.dispose();
  });

  it("未認証時はpending維持でpause('unauthenticated')し、有効セッション下401や恒久エラーは当該巻のみerror化すること (AC-COV-06)", async () => {
    await seedEnabledRoot();
    const zipBytes = makeZipBytes();
    await db.series.put(makeSeries({ id: "s-1" }));
    await db.volumes.bulkPut([
      makeVolume(zipBytes.byteLength, {
        id: "v-unauth",
        driveFileId: "df-unauth",
        volumeNumber: 1,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-401-active-session",
        driveFileId: "df-401",
        volumeNumber: 2,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-oob-page",
        driveFileId: "df-oob",
        volumeNumber: 3,
        coverPageIndex: 99,
      }),
    ]);

    let currentSession: GoogleAuthSession | null = null;
    const scheduler = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        googleAuthBridge: {
          getCachedSession: () => currentSession,
        },
        createRangeReader: (volume) => {
          if (volume.id === "v-unauth" && currentSession === null) {
            return {
              sourceId: `gdrive:${volume.driveFileId}`,
              totalSize: volume.fileSize,
              async readRange() {
                throw new ZipArchiveError("READ_ERROR", "auth req", undefined, {
                  isUnauthorized: true,
                });
              },
            };
          }
          if (volume.id === "v-401-active-session") {
            return {
              sourceId: `gdrive:${volume.driveFileId}`,
              totalSize: volume.fileSize,
              async readRange() {
                throw new ZipArchiveError("READ_ERROR", "401", undefined, {
                  httpStatus: 401,
                  isUnauthorized: true,
                });
              },
            };
          }
          return createMemoryReader(zipBytes, `gdrive:${volume.driveFileId}`);
        },
      }),
    );

    await scheduler.syncQueue();
    const pausedSnap = await waitForIdle(
      scheduler,
      (s) => s.phase === "paused",
    );
    expect(pausedSnap.pauseReasons).toEqual(["unauthenticated"]);
    expect((await db.volumes.get("v-unauth"))?.coverStatus).toBe("pending");

    // セッション回復後に syncQueue() を呼ぶと "unauthenticated" が自動解除されて続行されること
    currentSession = {
      email: "user@example.com",
      accessToken: "ya29.recovered",
      expiresAt: Date.now() + 3_600_000,
    };
    await scheduler.syncQueue();
    const doneSnap = await waitForIdle(scheduler);

    expect(doneSnap).toMatchObject({
      phase: "idle",
      totalCount: 3,
      readyCount: 1,
      pendingCount: 0,
      errorCount: 2,
      pauseReasons: [],
    });
    expect((await db.volumes.get("v-unauth"))?.coverStatus).toBe("ready");
    expect((await db.volumes.get("v-401-active-session"))?.coverStatus).toBe(
      "error",
    );
    expect((await db.volumes.get("v-oob-page"))?.coverStatus).toBe("error");

    scheduler.dispose();
  });

  it("pause/resumeによる同期abort()・複数理由管理・syncQueue並列直列化・ルート無効化時即時abort()・retryFailedCoversが動作すること (AC-COV-07)", async () => {
    await seedEnabledRoot("root-1");
    const zipBytes = makeZipBytes();
    await db.series.put(makeSeries({ id: "s-1" }));
    await db.volumes.bulkPut([
      makeVolume(zipBytes.byteLength, {
        id: "v-1",
        driveFileId: "df-1",
        volumeNumber: 1,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-2",
        driveFileId: "df-2",
        volumeNumber: 2,
        coverStatus: "error",
      }),
    ]);

    const readStarted = createDeferred<AbortSignal>();
    const readSignals: AbortSignal[] = [];
    let blockFirstRead = true;

    const scheduler = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        createRangeReader: (volume) => {
          const spy = createMemoryReader(
            zipBytes,
            `gdrive:${volume.driveFileId}`,
          );
          return {
            sourceId: spy.sourceId,
            totalSize: spy.totalSize,
            async readRange(offset, length, signal) {
              if (signal) {
                readSignals.push(signal);
              }
              if (blockFirstRead && volume.id === "v-1") {
                blockFirstRead = false;
                readStarted.resolve(signal!);
                return new Promise<Uint8Array>((_resolve, reject) => {
                  signal?.addEventListener(
                    "abort",
                    () => reject(new DOMException("Aborted", "AbortError")),
                    { once: true },
                  );
                });
              }
              return spy.readRange(offset, length, signal);
            },
          };
        },
      }),
    );

    // 並列 syncQueue() 呼び出し
    await Promise.all([scheduler.syncQueue(), scheduler.syncQueue()]);
    const firstSignal = await readStarted.promise;
    expect(firstSignal.aborted).toBe(false);

    // pause("reader") で進行中 fetch が同期 abort され pending 維持、さらに "drive-sync" 追加
    scheduler.pause("reader");
    scheduler.pause("reader"); // 重複呼び出しは冪等
    scheduler.pause("drive-sync");
    expect(firstSignal.aborted).toBe(true);
    expect(scheduler.getSnapshot().phase).toBe("paused");
    expect(scheduler.getSnapshot().pauseReasons).toEqual([
      "reader",
      "drive-sync",
    ]);

    // "reader" だけ解除しても "drive-sync" が残っているため一時停止維持
    scheduler.resume("reader");
    expect(scheduler.getSnapshot().phase).toBe("paused");

    // 存在しない reason の resume は無害
    scheduler.resume("test-harness");

    // ルートを無効化して syncQueue → 対象 0 件になる
    await db.driveSyncRoots.update("root-1", { enabled: 0 });
    await scheduler.syncQueue();
    expect(scheduler.getSnapshot().totalCount).toBe(0);
    expect(scheduler.getSnapshot().phase).toBe("idle");

    // ルート再有効化 & "drive-sync" 解除 → v-1 が完了する
    await db.driveSyncRoots.update("root-1", { enabled: 1 });
    await scheduler.syncQueue();
    scheduler.resume("drive-sync");
    await waitForIdle(scheduler);
    expect((await db.volumes.get("v-1"))?.coverStatus).toBe("ready");

    // retryFailedCovers: v-2 について "pending" イベントを即時配信し、再抽出で ready になること
    const updatedEvents: CoverExtractionVolumeUpdateEvent[] = [];
    scheduler.subscribeVolumeUpdated((ev) => updatedEvents.push(ev));

    const retriedCount = await scheduler.retryFailedCovers({ seriesId: "s-1" });
    expect(retriedCount).toBe(1);
    expect(updatedEvents[0]).toEqual({
      volumeId: "v-2",
      seriesId: "s-1",
      coverStatus: "pending",
      coverBlob: null,
      coverUpdatedAt: null,
    });

    await waitForIdle(scheduler);
    expect((await db.volumes.get("v-2"))?.coverStatus).toBe("ready");

    scheduler.dispose();
  });

  it("進行中activeVolumeIdのルート無効化時即時abort()・破損Worker自動再生成・resetForTest・デフォルトsleep・NoopSchedulerが動作すること (AC-COV-07, AC-COV-08)", async () => {
    await seedEnabledRoot("root-1");
    const zipBytes = makeZipBytes();
    await db.series.put(makeSeries({ id: "s-1" }));
    await db.volumes.bulkPut([
      makeVolume(zipBytes.byteLength, {
        id: "v-active",
        driveFileId: "df-active",
        volumeNumber: 1,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-worker-recover",
        driveFileId: "df-w",
        volumeNumber: 2,
      }),
    ]);

    const firstReadGate = createDeferred<AbortSignal>();
    let blockActive = true;
    let workerCreations = 0;
    const createdWorkers: Array<ReturnType<typeof createMockWorkerClient>> = [];

    const scheduler = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        sleep: undefined, // デフォルト sleep を使用
        now: undefined, // デフォルト Date.now を使用
        logger: undefined, // デフォルト diagnosticLogger を使用
        createWorkerClient: () => {
          workerCreations += 1;
          const idx = workerCreations;
          const mock = createMockWorkerClient(async () => {
            if (idx === 1) {
              mock.setBroken(true);
              throw new ZipArchiveError("DECODE_FAILED", "worker crashed");
            }
            return {
              blob: new Blob([new Uint8Array([1, 2])], { type: "image/webp" }),
              width: 100,
              height: 150,
            };
          });
          createdWorkers.push(mock);
          return mock.handle;
        },
        createRangeReader: (volume): RandomAccessReader => {
          const spy = createMemoryReader(
            zipBytes,
            `gdrive:${volume.driveFileId}`,
          );
          return {
            sourceId: spy.sourceId,
            totalSize: spy.totalSize,
            async readRange(offset, length, signal) {
              if (blockActive && volume.id === "v-active") {
                blockActive = false;
                firstReadGate.resolve(signal!);
                return new Promise<Uint8Array>((_resolve, reject) => {
                  signal?.addEventListener(
                    "abort",
                    () => reject(new DOMException("Aborted", "AbortError")),
                    { once: true },
                  );
                });
              }
              return spy.readRange(offset, length, signal);
            },
          };
        },
      }),
    );

    await scheduler.syncQueue();
    const activeSignal = await firstReadGate.promise;

    // 進行中の巻が有効なまま syncQueue() を再実行しても二重エンキュー・abort されないこと
    await scheduler.syncQueue();
    expect(activeSignal.aborted).toBe(false);

    // 所属ルートを無効化して syncQueue() → 即時 abort() されること
    await db.driveSyncRoots.update("root-1", { enabled: 0 });
    await scheduler.syncQueue();
    expect(activeSignal.aborted).toBe(true);

    // ルート再有効化 → v-active は worker1 クラッシュで error 化、v-worker-recover で worker2 が再生成されて成功すること
    await db.driveSyncRoots.update("root-1", { enabled: 1 });
    scheduler.setViewportVolumeIds(
      "bookshelf",
      new Set(["v-active", "v-worker-recover"]),
    );
    await scheduler.syncQueue();
    await waitForIdle(scheduler);

    expect(workerCreations).toBe(2);
    expect(createdWorkers[0]?.dispose).toHaveBeenCalledTimes(1);
    expect((await db.volumes.get("v-active"))?.coverStatus).toBe("error");
    expect((await db.volumes.get("v-worker-recover"))?.coverStatus).toBe(
      "ready",
    );

    // resetForTest() で全状態初期化
    await scheduler.resetForTest();
    expect(scheduler.getSnapshot()).toEqual({
      phase: "idle",
      totalCount: 0,
      readyCount: 0,
      pendingCount: 0,
      errorCount: 0,
      activeVolumeId: null,
      pauseReasons: [],
    });

    // dispose 後の操作は無害にスキップされること
    scheduler.dispose();
    scheduler.pause("reader");
    scheduler.resume("reader");
    scheduler.setViewportVolumeIds("bookshelf", new Set(["v-1"]));
    await scheduler.syncQueue();
    expect(await scheduler.retryFailedCovers()).toBe(0);

    // NoopCoverExtractionScheduler の全メソッド検証
    const noop = new NoopCoverExtractionScheduler();
    await noop.syncQueue();
    noop.setViewportVolumeIds("bookshelf", new Set(["v-1"]));
    noop.pause("reader");
    noop.resume("reader");
    expect(await noop.retryFailedCovers()).toBe(0);
    expect(noop.getSnapshot().phase).toBe("idle");
    const unsub1 = noop.subscribeProgress(() => undefined);
    const unsub2 = noop.subscribeVolumeUpdated(() => undefined);
    unsub1();
    unsub2();
    await noop.resetForTest();
    noop.dispose();
  });

  it("defaultAbortableSleep・スロットル待機中pause・事前スキップ・DECODE_FAILED自己修復・非Error例外・sync中dispose・実行中resetForTestを網羅すること (AC-COV-08)", async () => {
    // 1. defaultAbortableSleep: ms<=0 / 既abort / 通常タイマー完了 / 途中abort
    const preAborted = new AbortController();
    preAborted.abort();
    await defaultAbortableSleep(0, new AbortController().signal);
    await defaultAbortableSleep(50, preAborted.signal);

    vi.useFakeTimers();
    const normalSleep = defaultAbortableSleep(
      100,
      new AbortController().signal,
    );
    vi.advanceTimersByTime(100);
    await normalSleep;

    const midAbortCtrl = new AbortController();
    const midSleep = defaultAbortableSleep(1000, midAbortCtrl.signal);
    midAbortCtrl.abort();
    await midSleep;
    vi.useRealTimers();

    // 2. 事前スキップ（getById 時点で ready 変化）＋ DECODE_FAILED キャッシュ自己修復 ＋ 非 Error 例外 ＋ saveCoverReady/saveCoverError が null を返す整合ガード
    await seedEnabledRoot("root-1");
    const zipBytes = makeZipBytes();
    const zipIndexCacheRepo = new DexieZipIndexCacheRepository(db);
    await db.series.put(makeSeries({ id: "s-1" }));
    await db.volumes.bulkPut([
      makeVolume(zipBytes.byteLength, {
        id: "v-pre-ready",
        driveFileId: "df-pre-ready",
        volumeNumber: 1,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-decode-repair",
        driveFileId: "df-decode-repair",
        md5Checksum: "md5-dr",
        volumeNumber: 2,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-string-err",
        driveFileId: "df-str-err",
        volumeNumber: 3,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-stale-save",
        driveFileId: "df-stale",
        volumeNumber: 4,
      }),
    ]);

    await zipIndexCacheRepo.put("gdrive:df-decode-repair:md5-dr", [
      {
        pageIndex: 0,
        entryName: "001.jpg",
        entryNameByteLength: 7,
        compressionMethod: 0,
        compressedSize: 4,
        uncompressedSize: 4,
        localHeaderOffset: 0,
        physicalEnd: 41,
        crc32: 0,
      },
    ]);

    let decodeRepairCount = 0;
    const baseVolumesRepo = new DexieVolumesRepository(db);
    const wrappedVolumesRepo: CoverExtractionSchedulerDeps["volumesRepo"] = {
      getById: async (id) => {
        if (id === "v-pre-ready") {
          await db.volumes.update("v-pre-ready", { coverStatus: "ready" });
        }
        return baseVolumesRepo.getById(id);
      },
      listVisibleByEnabledRoots: (ids) =>
        baseVolumesRepo.listVisibleByEnabledRoots(ids),
      saveCoverReady: async (input) => {
        if (input.volumeId === "v-stale-save") {
          return null;
        }
        return baseVolumesRepo.saveCoverReady(input);
      },
      saveCoverError: async (input) => {
        if (input.volumeId === "v-string-err") {
          return null;
        }
        return baseVolumesRepo.saveCoverError(input);
      },
      resetErrorCoversToPending: (input) =>
        baseVolumesRepo.resetErrorCoversToPending(input),
    };

    const scheduler1 = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        volumesRepo: wrappedVolumesRepo,
        zipIndexCacheRepo,
        createWorkerClient: () =>
          createMockWorkerClient(async () => {
            decodeRepairCount += 1;
            if (decodeRepairCount === 1) {
              throw new ZipArchiveError("DECODE_FAILED", "stale decode");
            }
            return {
              blob: new Blob([new Uint8Array([1, 2])], { type: "image/webp" }),
              width: 100,
              height: 100,
            };
          }).handle,
        createRangeReader: (volume) => {
          if (volume.id === "v-string-err") {
            return {
              sourceId: `gdrive:${volume.driveFileId}`,
              totalSize: volume.fileSize,
              async readRange() {
                throw "non-error-string-failure";
              },
            };
          }
          return createMemoryReader(zipBytes, `gdrive:${volume.driveFileId}`);
        },
      }),
    );

    await scheduler1.syncQueue();
    await waitForIdle(scheduler1);
    expect((await db.volumes.get("v-decode-repair"))?.coverStatus).toBe(
      "ready",
    );
    scheduler1.dispose();
    scheduler1.dispose(); // 2回目 dispose は冪等

    // 3. スロットル待機中に pause() で throttleAbortController.abort() ＋ 実行中ループありで resetForTest()
    await resetTestDb();
    await seedEnabledRoot("root-1");
    await db.series.put(makeSeries({ id: "s-1" }));
    await db.volumes.bulkPut([
      makeVolume(zipBytes.byteLength, {
        id: "v-t1",
        driveFileId: "df-t1",
        volumeNumber: 1,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-t2",
        driveFileId: "df-t2",
        volumeNumber: 2,
      }),
    ]);

    const throttleStarted = createDeferred<AbortSignal>();
    const scheduler2 = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        now: () => 5_000,
        sleep: (_ms, signal) => {
          throttleStarted.resolve(signal);
          return new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
      }),
    );

    await scheduler2.syncQueue();
    const throttleSignal = await throttleStarted.promise;
    expect(throttleSignal.aborted).toBe(false);
    scheduler2.pause("reader");
    expect(throttleSignal.aborted).toBe(true);

    // 実行中ループ中に resetForTest() を呼んで安全に停止待機できること
    scheduler2.resume("reader");
    await scheduler2.resetForTest();
    expect(scheduler2.getSnapshot().phase).toBe("idle");

    // 4. syncQueue の DB 読込中に dispose() された場合は安全に中断すること
    const rootsGate = createDeferred<void>();
    const scheduler3 = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        driveSyncRootsRepo: {
          listActive: async () => {
            await rootsGate.promise;
            return [];
          },
        },
      }),
    );
    const pendingSync = scheduler3.syncQueue();
    scheduler3.dispose();
    rootsGate.resolve();
    await pendingSync;
    expect(scheduler3.getSnapshot().totalCount).toBe(0);

    // 5. 非代表巻が active 中の setViewportVolumeIds + viewport-high 巻の中断復帰 + await 解決直後の assertEpochActive 中断 + getById 例外
    await resetTestDb();
    await seedEnabledRoot("root-1");
    await db.series.put(makeSeries({ id: "s-1" }));
    await db.volumes.bulkPut([
      makeVolume(zipBytes.byteLength, {
        id: "v-rep",
        driveFileId: "df-rep",
        volumeNumber: 1,
        coverStatus: "ready",
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-other-1",
        driveFileId: "df-other-1",
        volumeNumber: 2,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-get-err",
        driveFileId: "df-get-err",
        volumeNumber: 3,
      }),
    ]);

    const encodeGate = createDeferred<void>();
    const encodeStarted = createDeferred<void>();
    let firstEncode = true;
    const baseRepo2 = new DexieVolumesRepository(db);
    const scheduler4 = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        volumesRepo: {
          getById: async (id) => {
            if (id === "v-get-err") {
              throw new Error("db read failure");
            }
            return baseRepo2.getById(id);
          },
          listVisibleByEnabledRoots: (ids) =>
            baseRepo2.listVisibleByEnabledRoots(ids),
          saveCoverReady: (input) => baseRepo2.saveCoverReady(input),
          saveCoverError: (input) => baseRepo2.saveCoverError(input),
          resetErrorCoversToPending: (input) =>
            baseRepo2.resetErrorCoversToPending(input),
        },
        createWorkerClient: () =>
          createMockWorkerClient(async () => {
            if (firstEncode) {
              firstEncode = false;
              encodeStarted.resolve();
              await encodeGate.promise;
            }
            return {
              blob: new Blob([new Uint8Array([1, 2])], { type: "image/webp" }),
              width: 100,
              height: 100,
            };
          }).handle,
      }),
    );

    scheduler4.setViewportVolumeIds("bookshelf", new Set(["v-other-1"]));
    await scheduler4.syncQueue();
    await encodeStarted.promise;

    // 非代表巻 v-other-1 が active 中に setViewportVolumeIds を再呼び出し（otherOrder の active スキップ分岐）
    scheduler4.setViewportVolumeIds("bookshelf", new Set(["v-other-1"]));
    // encodeCoverWebp が通常解決した直後に assertEpochActive で中断し、viewport-high へ先頭復帰すること
    scheduler4.pause("reader");
    encodeGate.resolve();
    await vi.waitFor(() => {
      expect(scheduler4.getSnapshot().activeVolumeId).toBeNull();
    });

    // 再開すると v-other-1 が完了し、続く v-get-err は getById 例外でも安全に処理完了して idle に戻ること
    scheduler4.resume("reader");
    await waitForIdle(scheduler4);
    expect((await db.volumes.get("v-other-1"))?.coverStatus).toBe("ready");
    scheduler4.dispose();
  });

  it("background-lowスロットル待機中にsyncQueue()で全ルート無効化・空キュー化してもundefined実行せず安全にidleへ遷移すること", async () => {
    await seedEnabledRoot("root-1");
    const zipBytes = makeZipBytes();
    await db.series.put(makeSeries({ id: "s-1" }));
    await db.volumes.bulkPut([
      makeVolume(zipBytes.byteLength, {
        id: "v-1",
        driveFileId: "df-1",
        volumeNumber: 1,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-2",
        driveFileId: "df-2",
        volumeNumber: 2,
      }),
    ]);

    const baseVolumesRepo = new DexieVolumesRepository(db);
    const getByIdArgs: Array<string | undefined> = [];
    const throttleStarted = createDeferred<AbortSignal>();
    const manualSleepRelease = createDeferred<void>();

    const scheduler = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        now: () => 5_000,
        volumesRepo: {
          getById: async (id) => {
            getByIdArgs.push(id);
            return baseVolumesRepo.getById(id);
          },
          listVisibleByEnabledRoots: (ids) =>
            baseVolumesRepo.listVisibleByEnabledRoots(ids),
          saveCoverReady: (input) => baseVolumesRepo.saveCoverReady(input),
          saveCoverError: (input) => baseVolumesRepo.saveCoverError(input),
          resetErrorCoversToPending: (input) =>
            baseVolumesRepo.resetErrorCoversToPending(input),
        },
        sleep: (_ms, signal) => {
          throttleStarted.resolve(signal);
          return new Promise<void>((resolve) => {
            const onAbort = () => resolve();
            signal.addEventListener("abort", onAbort, { once: true });
            void manualSleepRelease.promise.then(() => {
              signal.removeEventListener("abort", onAbort);
              resolve();
            });
          });
        },
      }),
    );

    await scheduler.syncQueue();
    const throttleSignal = await throttleStarted.promise;
    expect(throttleSignal.aborted).toBe(false);

    // スロットル待機中に全ルート無効化 → syncQueue() で空キュー化
    await db.driveSyncRoots.update("root-1", { enabled: 0 });
    await scheduler.syncQueue();

    // スロットル待機が即座に中断され、idle へ遷移して getById(undefined) が呼ばれないこと
    expect(throttleSignal.aborted).toBe(true);
    manualSleepRelease.resolve();
    const finalSnap = await waitForIdle(scheduler);
    expect(finalSnap).toMatchObject({
      phase: "idle",
      totalCount: 0,
      readyCount: 0,
      pendingCount: 0,
      errorCount: 0,
      activeVolumeId: null,
    });
    expect(getByIdArgs).toEqual(["v-1"]);
    expect(getByIdArgs).not.toContain(undefined);

    scheduler.dispose();
  });

  it("saveCoverReady/saveCoverError待機中にsyncQueue()やdispose()が並走しても二重計上・ゴースト計上・破棄後更新が起きないこと", async () => {
    const zipBytes = makeZipBytes();

    // ① saveCoverReady 待機中に syncQueue() が完了した場合（二重計上なし）
    await seedEnabledRoot("root-1");
    await db.series.put(makeSeries({ id: "s-1" }));
    await db.volumes.put(
      makeVolume(zipBytes.byteLength, {
        id: "v-ready-race",
        driveFileId: "df-ready-race",
        volumeNumber: 1,
      }),
    );

    const baseRepo1 = new DexieVolumesRepository(db);
    const readySaveStarted = createDeferred<void>();
    const readySaveGate = createDeferred<void>();
    const scheduler1 = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        volumesRepo: {
          getById: (id) => baseRepo1.getById(id),
          listVisibleByEnabledRoots: (ids) =>
            baseRepo1.listVisibleByEnabledRoots(ids),
          saveCoverReady: async (input) => {
            const saved = await baseRepo1.saveCoverReady(input);
            readySaveStarted.resolve();
            await readySaveGate.promise;
            return saved;
          },
          saveCoverError: (input) => baseRepo1.saveCoverError(input),
          resetErrorCoversToPending: (input) =>
            baseRepo1.resetErrorCoversToPending(input),
        },
      }),
    );

    await scheduler1.syncQueue();
    await readySaveStarted.promise;
    // DB は既に ready になっているため syncQueue() が readyCount: 1 を反映する
    await scheduler1.syncQueue();
    readySaveGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snap1 = await waitForIdle(scheduler1);
    expect(snap1).toMatchObject({
      phase: "idle",
      totalCount: 1,
      readyCount: 1,
      pendingCount: 0,
      errorCount: 0,
    });
    scheduler1.dispose();

    // ② saveCoverError 待機中に syncQueue() でルート無効化された場合（ゴースト計上なし）
    await resetTestDb();
    await seedEnabledRoot("root-1");
    await db.series.put(makeSeries({ id: "s-1" }));
    await db.volumes.put(
      makeVolume(zipBytes.byteLength, {
        id: "v-err-race",
        driveFileId: "df-err-race",
        volumeNumber: 1,
      }),
    );

    const baseRepo2 = new DexieVolumesRepository(db);
    const errorSaveStarted = createDeferred<void>();
    const errorSaveGate = createDeferred<void>();
    const scheduler2 = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        volumesRepo: {
          getById: (id) => baseRepo2.getById(id),
          listVisibleByEnabledRoots: (ids) =>
            baseRepo2.listVisibleByEnabledRoots(ids),
          saveCoverReady: (input) => baseRepo2.saveCoverReady(input),
          saveCoverError: async (input) => {
            const saved = await baseRepo2.saveCoverError(input);
            errorSaveStarted.resolve();
            await errorSaveGate.promise;
            return saved;
          },
          resetErrorCoversToPending: (input) =>
            baseRepo2.resetErrorCoversToPending(input),
        },
        createRangeReader: (volume) => ({
          sourceId: `gdrive:${volume.driveFileId}`,
          totalSize: volume.fileSize,
          async readRange() {
            throw new ZipArchiveError("CORRUPT_ZIP", "broken zip");
          },
        }),
      }),
    );

    await scheduler2.syncQueue();
    await errorSaveStarted.promise;
    await db.driveSyncRoots.update("root-1", { enabled: 0 });
    await scheduler2.syncQueue();
    errorSaveGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snap2 = await waitForIdle(scheduler2);
    expect(snap2).toMatchObject({
      phase: "idle",
      totalCount: 0,
      readyCount: 0,
      pendingCount: 0,
      errorCount: 0,
    });
    scheduler2.dispose();

    // ③-a saveCoverReady 待機中に dispose() された場合（破棄後のカウント加算なし）
    await resetTestDb();
    await seedEnabledRoot("root-1");
    await db.series.put(makeSeries({ id: "s-1" }));
    await db.volumes.put(
      makeVolume(zipBytes.byteLength, {
        id: "v-ready-dispose",
        driveFileId: "df-ready-dispose",
        volumeNumber: 1,
      }),
    );

    const baseRepo3 = new DexieVolumesRepository(db);
    const readyDisposeStarted = createDeferred<void>();
    const readyDisposeGate = createDeferred<void>();
    const scheduler3 = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        volumesRepo: {
          getById: (id) => baseRepo3.getById(id),
          listVisibleByEnabledRoots: (ids) =>
            baseRepo3.listVisibleByEnabledRoots(ids),
          saveCoverReady: async (input) => {
            const saved = await baseRepo3.saveCoverReady(input);
            readyDisposeStarted.resolve();
            await readyDisposeGate.promise;
            return saved;
          },
          saveCoverError: (input) => baseRepo3.saveCoverError(input),
          resetErrorCoversToPending: (input) =>
            baseRepo3.resetErrorCoversToPending(input),
        },
      }),
    );

    await scheduler3.syncQueue();
    await readyDisposeStarted.promise;
    scheduler3.dispose();
    readyDisposeGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scheduler3.getSnapshot().readyCount).toBe(0);

    // ③-b saveCoverError 待機中に dispose() された場合（破棄後のカウント加算なし）
    await resetTestDb();
    await seedEnabledRoot("root-1");
    await db.series.put(makeSeries({ id: "s-1" }));
    await db.volumes.put(
      makeVolume(zipBytes.byteLength, {
        id: "v-err-dispose",
        driveFileId: "df-err-dispose",
        volumeNumber: 1,
      }),
    );

    const baseRepo4 = new DexieVolumesRepository(db);
    const errorDisposeStarted = createDeferred<void>();
    const errorDisposeGate = createDeferred<void>();
    const scheduler4 = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        volumesRepo: {
          getById: (id) => baseRepo4.getById(id),
          listVisibleByEnabledRoots: (ids) =>
            baseRepo4.listVisibleByEnabledRoots(ids),
          saveCoverReady: (input) => baseRepo4.saveCoverReady(input),
          saveCoverError: async (input) => {
            const saved = await baseRepo4.saveCoverError(input);
            errorDisposeStarted.resolve();
            await errorDisposeGate.promise;
            return saved;
          },
          resetErrorCoversToPending: (input) =>
            baseRepo4.resetErrorCoversToPending(input),
        },
        createRangeReader: (volume) => ({
          sourceId: `gdrive:${volume.driveFileId}`,
          totalSize: volume.fileSize,
          async readRange() {
            throw new ZipArchiveError("CORRUPT_ZIP", "broken zip");
          },
        }),
      }),
    );

    await scheduler4.syncQueue();
    await errorDisposeStarted.promise;
    scheduler4.dispose();
    errorDisposeGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scheduler4.getSnapshot().errorCount).toBe(0);
  });

  it("saveCoverReady/saveCoverErrorがrejectしてもactiveVolumeIdが残留せず診断エラー記録の上で次巻へ継続すること (R1-02)", async () => {
    await seedEnabledRoot("root-1");
    await db.series.put(makeSeries({ id: "s-1" }));
    const zipBytes = makeZipBytes();
    await db.volumes.bulkPut([
      makeVolume(zipBytes.byteLength, {
        id: "v-ready-fail",
        driveFileId: "df-ready-fail",
        volumeNumber: 1,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-error-fail",
        driveFileId: "df-error-fail",
        volumeNumber: 2,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-ok",
        driveFileId: "df-ok",
        volumeNumber: 3,
      }),
    ]);

    const baseRepo = new DexieVolumesRepository(db);
    const logger = createDiagnosticLogger();
    const scheduler = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        logger,
        volumesRepo: {
          getById: (id) => baseRepo.getById(id),
          listVisibleByEnabledRoots: (ids) =>
            baseRepo.listVisibleByEnabledRoots(ids),
          saveCoverReady: async (input) => {
            if (input.volumeId === "v-ready-fail") {
              throw new Error("QuotaExceededError on saveCoverReady");
            }
            return baseRepo.saveCoverReady(input);
          },
          saveCoverError: async (input) => {
            if (input.volumeId === "v-error-fail") {
              throw new Error("QuotaExceededError on saveCoverError");
            }
            return baseRepo.saveCoverError(input);
          },
          resetErrorCoversToPending: (input) =>
            baseRepo.resetErrorCoversToPending(input),
        },
        createRangeReader: (volume) => ({
          sourceId: `gdrive:${volume.driveFileId}`,
          totalSize: volume.fileSize,
          async readRange(offset, length) {
            if (volume.id === "v-error-fail") {
              throw new ZipArchiveError("CORRUPT_ZIP", "broken zip");
            }
            const end = Math.min(offset + length, zipBytes.byteLength);
            return zipBytes.subarray(offset, end);
          },
        }),
      }),
    );

    await scheduler.syncQueue();
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot().phase).toBe("idle");
      expect(scheduler.getSnapshot().readyCount).toBe(1);
    });

    expect(scheduler.getSnapshot().activeVolumeId).toBeNull();
    expect(scheduler.getSnapshot().pendingCount).toBe(0);
    // DB 上は保存失敗した 2 巻が error 汚染されず pending 維持（v-ok のみ ready）
    expect((await db.volumes.get("v-ready-fail"))?.coverStatus).toBe("pending");
    expect((await db.volumes.get("v-error-fail"))?.coverStatus).toBe("pending");
    expect((await db.volumes.get("v-ok"))?.coverStatus).toBe("ready");

    const errorLogs = logger
      .getEntries()
      .filter((entry) => entry.level === "error" && entry.scope === "cover");
    expect(errorLogs.length).toBeGreaterThanOrEqual(2);
    expect(
      errorLogs.some((entry) =>
        entry.detail?.includes("QuotaExceededError on saveCoverReady"),
      ),
    ).toBe(true);
    expect(
      errorLogs.some((entry) =>
        entry.detail?.includes("QuotaExceededError on saveCoverError"),
      ),
    ).toBe(true);

    scheduler.dispose();
  });

  it("runLoop内で予期しない例外が発生しても未処理rejectionにならず診断エラーログを記録すること (R1-02)", async () => {
    await seedEnabledRoot("root-1");
    await db.series.put(makeSeries({ id: "s-1" }));
    const zipBytes = makeZipBytes();
    await db.volumes.bulkPut([
      makeVolume(zipBytes.byteLength, {
        id: "v-1",
        driveFileId: "df-1",
        volumeNumber: 1,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-2",
        driveFileId: "df-2",
        volumeNumber: 2,
      }),
    ]);

    const logger = createDiagnosticLogger();
    let sleepCount = 0;
    const scheduler = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        logger,
        now: () => 1000,
        sleep: async () => {
          sleepCount += 1;
          if (sleepCount === 1) {
            throw new Error("unexpected sleep failure");
          }
        },
      }),
    );

    await scheduler.syncQueue();
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot().readyCount).toBe(2);
      expect(scheduler.getSnapshot().phase).toBe("idle");
    });

    expect(
      logger
        .getEntries()
        .some(
          (entry) =>
            entry.level === "error" &&
            entry.scope === "cover" &&
            entry.detail?.includes("unexpected sleep failure"),
        ),
    ).toBe(true);

    scheduler.dispose();
  });

  it("オフライン通信断・AUTH_NETWORK_ERROR・5xxは指数バックオフ再試行し上限到達後も恒久errorにせずpending維持で待機停止すること (R1-03, AC-COV-06)", async () => {
    await seedEnabledRoot("root-1");
    await db.series.put(makeSeries({ id: "s-1" }));
    const zipBytes = makeZipBytes();
    await db.volumes.bulkPut([
      makeVolume(zipBytes.byteLength, {
        id: "v-net-1",
        driveFileId: "df-net-1",
        volumeNumber: 1,
      }),
      makeVolume(zipBytes.byteLength, {
        id: "v-net-2",
        driveFileId: "df-net-2",
        volumeNumber: 2,
      }),
    ]);

    const sleepCalls: number[] = [];
    const logger = createDiagnosticLogger();
    let mode: "offline" | "503" | "recover" = "offline";
    let readAttempts = 0;
    let currentTime = 1_000;

    const scheduler = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        logger,
        now: () => currentTime,
        sleep: async (ms) => {
          sleepCalls.push(ms);
          currentTime += ms;
        },
        createRangeReader: (volume) => ({
          sourceId: `gdrive:${volume.driveFileId}`,
          totalSize: volume.fileSize,
          async readRange(offset, length) {
            readAttempts += 1;
            if (mode === "offline") {
              throw new ZipArchiveError(
                "READ_ERROR",
                "Failed to fetch (offline / AUTH_NETWORK_ERROR)",
              );
            }
            if (mode === "503") {
              throw new ZipArchiveError(
                "READ_ERROR",
                "503 Service Unavailable",
                undefined,
                {
                  httpStatus: 503,
                  isRateLimited: false,
                },
              );
            }
            const end = Math.min(offset + length, zipBytes.byteLength);
            return zipBytes.subarray(offset, end);
          },
        }),
      }),
    );

    // 1. オフライン継続時: 1000 -> 2000 -> 4000ms バックオフ後、計4回失敗で pending 維持のまま待機停止 (idle)
    await scheduler.syncQueue();
    await vi.waitFor(() => {
      expect(readAttempts).toBe(4);
      expect(scheduler.getSnapshot().phase).toBe("idle");
    });

    expect(sleepCalls).toEqual([1000, 2000, 4000]);
    expect(scheduler.getSnapshot()).toMatchObject({
      phase: "idle",
      readyCount: 0,
      pendingCount: 2,
      errorCount: 0,
      activeVolumeId: null,
    });
    expect((await db.volumes.get("v-net-1"))?.coverStatus).toBe("pending");
    expect((await db.volumes.get("v-net-2"))?.coverStatus).toBe("pending");

    // 2. 5xx (503) で再試行しても同様に恒久 error 汚染しない
    mode = "503";
    sleepCalls.length = 0;
    readAttempts = 0;
    currentTime += 1_000;
    await scheduler.syncQueue();
    await vi.waitFor(() => {
      expect(readAttempts).toBe(4);
      expect(scheduler.getSnapshot().phase).toBe("idle");
    });
    expect(sleepCalls).toEqual([1000, 2000, 4000]);
    expect(scheduler.getSnapshot().errorCount).toBe(0);
    expect((await db.volumes.get("v-net-1"))?.coverStatus).toBe("pending");

    // 3. 通信回復後に syncQueue() すると全巻が正常に ready 完了すること
    mode = "recover";
    await scheduler.syncQueue();
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot().readyCount).toBe(2);
      expect(scheduler.getSnapshot().phase).toBe("idle");
    });
    expect((await db.volumes.get("v-net-1"))?.coverStatus).toBe("ready");
    expect((await db.volumes.get("v-net-2"))?.coverStatus).toBe("ready");

    scheduler.dispose();
  });

  it("syncQueueおよびretryFailedCovers内のDexie障害をCore内でcatchしlogger.errorへ記録してresolveすること (R1-08)", async () => {
    const zipBytes = makeZipBytes();
    const logger = createDiagnosticLogger();
    const baseRepo = new DexieVolumesRepository(db);

    const scheduler = new CoverExtractionSchedulerCore(
      createBaseDeps(zipBytes, {
        logger,
        driveSyncRootsRepo: {
          listActive: vi.fn(async () => {
            throw new Error("IndexedDB unavailable");
          }),
        },
        volumesRepo: {
          getById: (id) => baseRepo.getById(id),
          listVisibleByEnabledRoots: (ids) =>
            baseRepo.listVisibleByEnabledRoots(ids),
          saveCoverReady: (input) => baseRepo.saveCoverReady(input),
          saveCoverError: (input) => baseRepo.saveCoverError(input),
          resetErrorCoversToPending: (input) =>
            baseRepo.resetErrorCoversToPending(input),
        },
      }),
    );

    await expect(scheduler.syncQueue()).resolves.toBeUndefined();
    await expect(scheduler.retryFailedCovers()).resolves.toBe(0);

    const errorLogs = logger
      .getEntries()
      .filter((entry) => entry.level === "error" && entry.scope === "cover");
    expect(errorLogs).toHaveLength(2);
    expect(errorLogs[0]?.detail).toContain("IndexedDB unavailable");
    expect(errorLogs[1]?.detail).toContain("IndexedDB unavailable");

    scheduler.dispose();
  });
});
