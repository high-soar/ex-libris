import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverWorkerClientHandle } from "../../app/coverWorkerClient";
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
  type CoverExtractionSchedulerDeps,
} from "./CoverExtractionSchedulerCore";
import type {
  CoverExtractionProgressSnapshot,
  CoverExtractionVolumeUpdateEvent,
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

    // v-repair: キャッシュ由来失敗 → delete → 再 parseZipDirectory → 成功、かつ正常キャッシュへ更新
    expect(readsByVolume.get("v-repair")).toBe(4);
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
});
