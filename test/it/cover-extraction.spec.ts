import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { buildSyntheticZip } from "../../src/engine/zip/__fixtures__/zipBuilder";
import {
  buildCorruptZipBytes,
  buildSyntheticThreePageArchive,
  createFileDataTransfer,
  createSyntheticPng,
  readPngCenterPixel,
  readZipIndexCacheRecord,
  resetTestDatabase,
  trackPageErrors,
  waitForServicesReady,
} from "./helpers";

interface RecordedCoverMediaRequest {
  readonly url: string;
  readonly fileId: string;
  readonly start: number | null;
  readonly end: number | null;
  readonly status: number;
  readonly receivedAt: number;
  readonly completedAt: number;
}

interface QueuedRouteFault {
  readonly status: 429 | 403;
  readonly body: unknown;
}

interface HoldGate {
  readonly arrived: Promise<void>;
  readonly release: () => void;
}

interface NextFileHoldGate {
  readonly arrived: Promise<string>;
  readonly release: () => void;
}

interface CoverDriveMediaRouteController {
  readonly requests: RecordedCoverMediaRequest[];
  readonly clearRequests: () => void;
  readonly setArchive: (fileId: string, bytes: Uint8Array | null) => void;
  readonly queueFault: (fileId: string, fault: QueuedRouteFault) => void;
  readonly holdFile: (fileId: string) => HoldGate;
  readonly holdNextFile: (
    excludeFileIds?: ReadonlySet<string>,
  ) => NextFileHoldGate;
  readonly releaseAllHolds: () => void;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Range",
  "Access-Control-Expose-Headers":
    "Content-Range, Content-Length, Accept-Ranges",
};

function parseRangeHeader(
  rangeHeader: string | null,
  totalLength: number,
): { readonly start: number; readonly end: number } | null {
  if (!rangeHeader) {
    return null;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? totalLength - 1 : Number(match[2]);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    end >= totalLength
  ) {
    return null;
  }
  return { start, end };
}

function buildLargeCoverArchive(
  rgba: readonly [number, number, number, number],
): Uint8Array {
  const coverPng = createSyntheticPng(rgba, 500, 700);
  const page2Png = createSyntheticPng([0, 255, 0, 255], 64, 96);
  const page3Png = createSyntheticPng([0, 0, 255, 255], 64, 96);
  return buildSyntheticZip({
    entries: [
      { name: "001.png", data: coverPng, compressionMethod: 8 },
      { name: "002.png", data: page2Png, compressionMethod: 0 },
      { name: "003.png", data: page3Png, compressionMethod: 8 },
    ],
  });
}

function buildSmallCoverArchive(
  rgba: readonly [number, number, number, number],
): Uint8Array {
  const smallCoverPng = createSyntheticPng(rgba, 80, 120);
  const page2Png = createSyntheticPng([0, 255, 0, 255], 64, 96);
  return buildSyntheticZip({
    entries: [
      { name: "001.png", data: smallCoverPng, compressionMethod: 0 },
      { name: "002.png", data: page2Png, compressionMethod: 8 },
    ],
  });
}

async function installCoverDriveMediaRoute(
  context: BrowserContext,
  initialArchives: ReadonlyMap<string, Uint8Array>,
): Promise<CoverDriveMediaRouteController> {
  const archives = new Map<string, Uint8Array>(initialArchives);
  const faultsByFileId = new Map<string, QueuedRouteFault[]>();
  const holdsByFileId = new Map<
    string,
    {
      resolveArrived: () => void;
      gatePromise: Promise<void>;
      release: () => void;
    }
  >();
  let pendingNextHold: {
    readonly excludeFileIds: ReadonlySet<string>;
    capturedFileId: string | null;
    resolveArrived: (fileId: string) => void;
    gatePromise: Promise<void>;
    release: () => void;
  } | null = null;
  const requests: RecordedCoverMediaRequest[] = [];

  await context.route(
    "https://www.googleapis.com/drive/v3/files/**",
    async (route) => {
      const request = route.request();
      const method = request.method();
      const url = request.url();

      if (method === "OPTIONS") {
        await route
          .fulfill({ status: 204, headers: CORS_HEADERS })
          .catch(() => {
            // ブラウザ中断時は無視
          });
        return;
      }

      const receivedAt = Date.now();
      const parsedUrl = new URL(url);
      const segments = parsedUrl.pathname.split("/").filter(Boolean);
      const fileId = decodeURIComponent(segments[segments.length - 1] ?? "");
      const headers = await request.allHeaders();
      const rangeHeader = headers["range"] ?? null;

      if (
        pendingNextHold !== null &&
        pendingNextHold.capturedFileId === null &&
        !pendingNextHold.excludeFileIds.has(fileId)
      ) {
        const hold = pendingNextHold;
        hold.capturedFileId = fileId;
        hold.resolveArrived(fileId);
        await hold.gatePromise;
      }

      const activeHold = holdsByFileId.get(fileId);
      if (activeHold) {
        activeHold.resolveArrived();
        await activeHold.gatePromise;
      }

      const queuedFaults = faultsByFileId.get(fileId);
      if (queuedFaults && queuedFaults.length > 0) {
        const fault = queuedFaults.shift()!;
        requests.push({
          url,
          fileId,
          start: null,
          end: null,
          status: fault.status,
          receivedAt,
          completedAt: Date.now(),
        });
        await route
          .fulfill({
            status: fault.status,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(fault.body),
          })
          .catch(() => {
            // ブラウザ中断時は無視
          });
        return;
      }

      const archive = archives.get(fileId);
      if (!archive) {
        requests.push({
          url,
          fileId,
          start: null,
          end: null,
          status: 404,
          receivedAt,
          completedAt: Date.now(),
        });
        await route
          .fulfill({
            status: 404,
            headers: CORS_HEADERS,
            body: "Not Found",
          })
          .catch(() => {
            // ブラウザ中断時は無視
          });
        return;
      }

      const parsedRange = parseRangeHeader(rangeHeader, archive.byteLength);
      if (!parsedRange) {
        requests.push({
          url,
          fileId,
          start: null,
          end: null,
          status: 416,
          receivedAt,
          completedAt: Date.now(),
        });
        await route
          .fulfill({
            status: 416,
            headers: {
              ...CORS_HEADERS,
              "Content-Range": `bytes */${archive.byteLength}`,
            },
          })
          .catch(() => {
            // ブラウザ中断時は無視
          });
        return;
      }

      const slice = archive.subarray(parsedRange.start, parsedRange.end + 1);
      requests.push({
        url,
        fileId,
        start: parsedRange.start,
        end: parsedRange.end,
        status: 206,
        receivedAt,
        completedAt: Date.now(),
      });

      await route
        .fulfill({
          status: 206,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/octet-stream",
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes ${parsedRange.start}-${parsedRange.end}/${archive.byteLength}`,
            "Content-Length": String(slice.byteLength),
          },
          body: Buffer.from(slice),
        })
        .catch(() => {
          // ブラウザ中断時は無視
        });
    },
  );

  return {
    requests,
    clearRequests: () => {
      requests.length = 0;
    },
    setArchive: (fileId: string, bytes: Uint8Array | null) => {
      if (bytes === null) {
        archives.delete(fileId);
      } else {
        archives.set(fileId, bytes);
      }
    },
    queueFault: (fileId: string, fault: QueuedRouteFault) => {
      const existing = faultsByFileId.get(fileId) ?? [];
      existing.push(fault);
      faultsByFileId.set(fileId, existing);
    },
    holdFile: (fileId: string): HoldGate => {
      let resolveArrived!: () => void;
      const arrived = new Promise<void>((resolve) => {
        resolveArrived = resolve;
      });
      let resolveGate!: () => void;
      const gatePromise = new Promise<void>((resolve) => {
        resolveGate = resolve;
      });
      const release = () => {
        holdsByFileId.delete(fileId);
        resolveGate();
      };
      holdsByFileId.set(fileId, { resolveArrived, gatePromise, release });
      return { arrived, release };
    },
    holdNextFile: (
      excludeFileIds: ReadonlySet<string> = new Set(),
    ): NextFileHoldGate => {
      let resolveArrived!: (fileId: string) => void;
      const arrived = new Promise<string>((resolve) => {
        resolveArrived = resolve;
      });
      let resolveGate!: () => void;
      const gatePromise = new Promise<void>((resolve) => {
        resolveGate = resolve;
      });
      const holdObj = {
        excludeFileIds,
        capturedFileId: null as string | null,
        resolveArrived,
        gatePromise,
        release: () => {
          if (pendingNextHold === holdObj) {
            pendingNextHold = null;
          }
          resolveGate();
        },
      };
      pendingNextHold = holdObj;
      return { arrived, release: holdObj.release };
    },
    releaseAllHolds: () => {
      for (const [, hold] of holdsByFileId) {
        hold.release();
      }
      holdsByFileId.clear();
      pendingNextHold?.release();
    },
  };
}

async function signInAndRegisterRoot(
  page: Page,
  folderId: string,
): Promise<void> {
  await page.getByTestId("header-settings-button").click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByTestId("google-signin-button").click();
  await expect(page.getByTestId("google-auth-status-badge")).toHaveText(
    "連携済み",
  );
  await page.getByTestId("folder-input").fill(folderId);
  await page.getByTestId("add-folder-by-input-button").click();
  await expect(page.getByTestId("sync-root-item")).toHaveCount(1);
}

interface SeedDriveFileSpec {
  readonly id: string;
  readonly name: string;
  readonly parents: readonly string[];
  readonly size: number;
  readonly md5Checksum: string;
  readonly modifiedTime: number;
}

async function seedCleanMangaRootFiles(
  page: Page,
  files: readonly SeedDriveFileSpec[],
): Promise<void> {
  await page.evaluate((specs) => {
    const client = window.__exLibrisServices?.mockDriveSyncClient;
    if (!client) {
      throw new Error("mockDriveSyncClient is not available");
    }
    // デフォルトの mock-file-manga-1 をゴミ箱化してテスト専用ファイル群のみを同期対象とする
    client.upsertItem(
      {
        id: "mock-file-manga-1",
        name: "[荒木飛呂彦] ジョジョの奇妙な冒険 第01巻.cbz",
        mimeType: "application/zip",
        parents: ["mock-folder-weekly"],
        size: 1024,
        md5Checksum: "md5-jojo-01",
        modifiedTime: Date.parse("2026-11-25T09:00:00.000Z"),
        trashed: true,
      },
      false,
    );
    for (const file of specs) {
      client.upsertItem(
        {
          id: file.id,
          name: file.name,
          mimeType: "application/octet-stream",
          parents: [...file.parents],
          size: file.size,
          md5Checksum: file.md5Checksum,
          modifiedTime: file.modifiedTime,
          trashed: false,
        },
        false,
      );
    }
  }, files);
}

async function setCoverExtractionAutoRun(
  page: Page,
  enabled: boolean,
): Promise<void> {
  await page.evaluate((flag) => {
    const toggle = window.__exLibrisServices?.setTestCoverExtractionAutoRun;
    if (typeof toggle !== "function") {
      throw new Error(
        "window.__exLibrisServices.setTestCoverExtractionAutoRun is not available",
      );
    }
    toggle(flag);
  }, enabled);
}

test.describe("SCN-06: 2段優先度・表紙WebP自動抽出＆閲覧優先プリエンプション結合検証", () => {
  test("(1) viewport-high最優先・background-low(2冊/秒)・350px WebP生成・リロード自動再開・updatedAt非汚染", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    const largeZip = buildLargeCoverArchive([220, 40, 40, 255]);
    const smallZip = buildSmallCoverArchive([40, 180, 90, 255]);
    const baseTime = Date.parse("2026-11-26T09:00:00.000Z");

    // 10シリーズ（375x667 の 2列グリッドで titleAsc 時は A,B が画面内最上段、G〜J が rootMargin 200px 外の画面外）
    const seriesSpecs: readonly SeedDriveFileSpec[] = [
      {
        id: "cov-a-1",
        name: "[作者A] Aタイトル 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: largeZip.byteLength,
        md5Checksum: "md5-cov-a-1",
        modifiedTime: baseTime + 1_000,
      },
      {
        id: "cov-b-1",
        name: "[作者B] Bタイトル 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: smallZip.byteLength,
        md5Checksum: "md5-cov-b-1",
        modifiedTime: baseTime + 2_000,
      },
      {
        id: "cov-c-1",
        name: "[作者C] Cタイトル 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: largeZip.byteLength,
        md5Checksum: "md5-cov-c-1",
        modifiedTime: baseTime + 3_000,
      },
      {
        id: "cov-d-1",
        name: "[作者D] Dタイトル 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: largeZip.byteLength,
        md5Checksum: "md5-cov-d-1",
        modifiedTime: baseTime + 4_000,
      },
      {
        id: "cov-e-1",
        name: "[作者E] Eタイトル 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: largeZip.byteLength,
        md5Checksum: "md5-cov-e-1",
        modifiedTime: baseTime + 5_000,
      },
      {
        id: "cov-f-1",
        name: "[作者F] Fタイトル 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: largeZip.byteLength,
        md5Checksum: "md5-cov-f-1",
        modifiedTime: baseTime + 6_000,
      },
      {
        id: "cov-g-1",
        name: "[作者G] Gタイトル 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: largeZip.byteLength,
        md5Checksum: "md5-cov-g-1",
        modifiedTime: baseTime + 7_000,
      },
      {
        id: "cov-h-1",
        name: "[作者H] Hタイトル 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: largeZip.byteLength,
        md5Checksum: "md5-cov-h-1",
        modifiedTime: baseTime + 8_000,
      },
      {
        id: "cov-i-1",
        name: "[作者I] Iタイトル 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: largeZip.byteLength,
        md5Checksum: "md5-cov-i-1",
        modifiedTime: baseTime + 9_000,
      },
      {
        id: "cov-j-1",
        name: "[作者J] Jタイトル 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: largeZip.byteLength,
        md5Checksum: "md5-cov-j-1",
        modifiedTime: baseTime + 10_000,
      },
    ];

    const archiveMap = new Map<string, Uint8Array>();
    for (const spec of seriesSpecs) {
      archiveMap.set(spec.id, spec.id === "cov-b-1" ? smallZip : largeZip);
    }
    const routeController = await installCoverDriveMediaRoute(
      context,
      archiveMap,
    );

    // 375x667 を明示指定して画面内カード（上部）と画面外カード（下部）を明確に分離
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await signInAndRegisterRoot(page, "mock-folder-manga");
    await seedCleanMangaRootFiles(page, seriesSpecs);

    // SCR-01 へ戻り、まず同期を実行して全10巻を pending として登録（autoRun まだ OFF で updatedAt 基準値を確定）
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("drive-sync-empty-state")).toBeVisible();
    await page.getByTestId("empty-state-sync-drive-button").click();
    await expect(page.getByTestId("series-card")).toHaveCount(10);

    // 並び順をタイトル昇順（A, B が画面内最上段、G〜J が画面外最下段）へ変更
    await page.getByTestId("bookshelf-sort-select").selectOption("titleAsc");
    await expect(page.getByTestId("series-card").first()).toContainText(
      "Aタイトル",
    );

    // 抽出開始前の volumes.updatedAt / series.updatedAt をスナップショット記録
    const preTimestamps = await page.evaluate(async () => {
      const series =
        (await window.__exLibrisServices?.seriesRepo?.listActive()) ?? [];
      const volumes =
        (await window.__exLibrisServices?.volumesRepo?.listVisibleByEnabledRoots(
          new Set(["mock-folder-manga"]),
        )) ?? [];
      return {
        series: Object.fromEntries(series.map((s) => [s.id, s.updatedAt])),
        volumes: Object.fromEntries(volumes.map((v) => [v.id, v.updatedAt])),
      };
    });
    expect(Object.keys(preTimestamps.volumes)).toHaveLength(10);

    // リロード後の残 pending 自動再開を検証するため、画面外（background-low）の cov-g-1 をゲート保持
    const reloadGate = routeController.holdFile("cov-g-1");

    // 自動抽出を有効化（IntersectionObserver で可視の A, B が viewport-high 最優先になる）
    await setCoverExtractionAutoRun(page, true);

    // 画面内カード（Aタイトル・Bタイトル）に blob: URL の表紙画像が反映されることを確認
    const cardA = page
      .getByTestId("series-card")
      .filter({ hasText: "Aタイトル" });
    const cardB = page
      .getByTestId("series-card")
      .filter({ hasText: "Bタイトル" });
    await expect(cardA.getByTestId("cover-thumbnail-image")).toBeVisible({
      timeout: 15_000,
    });
    await expect(cardB.getByTestId("cover-thumbnail-image")).toBeVisible({
      timeout: 15_000,
    });
    await expect(cardA.getByTestId("cover-thumbnail-image")).toHaveAttribute(
      "src",
      /^blob:/,
    );
    await expect(cardB.getByTestId("cover-thumbnail-image")).toHaveAttribute(
      "src",
      /^blob:/,
    );

    // 画面外 background-low の cov-g-1 到達を待ってから page.reload() で途中中断→自動再開を検証
    await reloadGate.arrived;

    // リロード前に、画面内の cov-a-1 / cov-b-1 が画面外の cov-j-1 / cov-i-1 / cov-h-1 より先に開始されたことを検証
    const firstSeenOrder: string[] = [];
    for (const req of routeController.requests) {
      if (!firstSeenOrder.includes(req.fileId)) {
        firstSeenOrder.push(req.fileId);
      }
    }
    const indexA = firstSeenOrder.indexOf("cov-a-1");
    const indexB = firstSeenOrder.indexOf("cov-b-1");
    const indexI = firstSeenOrder.indexOf("cov-i-1");
    const indexJ = firstSeenOrder.indexOf("cov-j-1");
    expect(indexA).toBeGreaterThanOrEqual(0);
    expect(indexB).toBeGreaterThanOrEqual(0);
    expect(indexI).toBeGreaterThan(indexA);
    expect(indexI).toBeGreaterThan(indexB);
    expect(indexJ).toBeGreaterThan(indexA);
    expect(indexJ).toBeGreaterThan(indexB);

    // 残 pending がある状態でリロードし、sessionStorage 経由で自動再開されることを確認
    reloadGate.release();
    await page.reload();
    await waitForServicesReady(page);
    await expect(page.getByTestId("series-card")).toHaveCount(10);

    // 全10巻が自動で ready に到達し、ツールバーの表紙ステータス行が非表示になること
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__exLibrisServices?.coverExtractionScheduler?.getSnapshot()
                .readyCount ?? 0,
          ),
        { timeout: 20_000 },
      )
      .toBe(10);
    await expect(page.getByTestId("bookshelf-cover-status")).toHaveCount(0);

    // background-low 連続実行（画面外巻同士）が最大 2 冊/秒（最小間隔 500ms、タイマ誤差考慮 420ms 以上）に制御されていること
    const bgFileIds = ["cov-j-1", "cov-i-1", "cov-h-1", "cov-g-1"];
    const bgWindowByFile = new Map<
      string,
      { firstReceivedAt: number; lastCompletedAt: number }
    >();
    for (const req of routeController.requests) {
      if (!bgFileIds.includes(req.fileId) || req.status !== 206) {
        continue;
      }
      const prev = bgWindowByFile.get(req.fileId);
      if (!prev) {
        bgWindowByFile.set(req.fileId, {
          firstReceivedAt: req.receivedAt,
          lastCompletedAt: req.completedAt,
        });
      } else {
        bgWindowByFile.set(req.fileId, {
          firstReceivedAt: Math.min(prev.firstReceivedAt, req.receivedAt),
          lastCompletedAt: Math.max(prev.lastCompletedAt, req.completedAt),
        });
      }
    }
    const orderedBgWindows = [...bgWindowByFile.values()].sort(
      (a, b) => a.firstReceivedAt - b.firstReceivedAt,
    );
    expect(orderedBgWindows.length).toBeGreaterThanOrEqual(3);
    let throttledTransitions = 0;
    for (let i = 1; i < orderedBgWindows.length; i += 1) {
      const gapMs =
        orderedBgWindows[i].firstReceivedAt -
        orderedBgWindows[i - 1].lastCompletedAt;
      if (gapMs >= 420) {
        throttledTransitions += 1;
      }
    }
    expect(throttledTransitions).toBeGreaterThanOrEqual(2);

    // IndexedDB 上の WebP Blob 形式・サイズ・実デコード寸法（長辺<=350px・短小画像非拡大）と updatedAt 非汚染を厳密検証
    const postCheck = await page.evaluate(async () => {
      const series =
        (await window.__exLibrisServices?.seriesRepo?.listActive()) ?? [];
      const volumes =
        (await window.__exLibrisServices?.volumesRepo?.listVisibleByEnabledRoots(
          new Set(["mock-folder-manga"]),
        )) ?? [];
      const volumeReports = [];
      for (const vol of volumes) {
        let decodedWidth = 0;
        let decodedHeight = 0;
        if (vol.coverBlob) {
          const bitmap = await createImageBitmap(vol.coverBlob);
          try {
            decodedWidth = bitmap.width;
            decodedHeight = bitmap.height;
          } finally {
            bitmap.close();
          }
        }
        volumeReports.push({
          id: vol.id,
          driveFileId: vol.driveFileId,
          coverStatus: vol.coverStatus,
          blobType: vol.coverBlob?.type ?? null,
          blobSize: vol.coverBlob?.size ?? 0,
          decodedWidth,
          decodedHeight,
          updatedAt: vol.updatedAt,
        });
      }
      return {
        seriesUpdatedAt: Object.fromEntries(
          series.map((s) => [s.id, s.updatedAt]),
        ),
        volumeReports,
      };
    });

    expect(postCheck.seriesUpdatedAt).toEqual(preTimestamps.series);
    for (const report of postCheck.volumeReports) {
      expect(report.coverStatus).toBe("ready");
      expect(report.blobType).toBe("image/webp");
      expect(report.blobSize).toBeGreaterThan(0);
      expect(
        Math.max(report.decodedWidth, report.decodedHeight),
      ).toBeLessThanOrEqual(350);
      if (report.driveFileId === "cov-a-1") {
        expect(report.decodedWidth).toBe(250);
        expect(report.decodedHeight).toBe(350);
      }
      if (report.driveFileId === "cov-b-1") {
        // 80x120 の短小画像は拡大されず等倍維持されること
        expect(report.decodedWidth).toBe(80);
        expect(report.decodedHeight).toBe(120);
      }
      expect(report.updatedAt).toBe(preTimestamps.volumes[report.id]);
    }

    expect(pageErrors).toEqual([]);
  });

  test("(2) 表紙抽出完了済み巻の SCR-03 初回オープンが zipIndexCache により Central Directory Range 通信ゼロ (0RTT / fromIndexCache=true) になる", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const threePageZip = buildSyntheticThreePageArchive();
    const baseTime = Date.parse("2026-11-26T09:00:00.000Z");

    const routeController = await installCoverDriveMediaRoute(
      context,
      new Map([["cov-0rtt-vol1", threePageZip]]),
    );

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await signInAndRegisterRoot(page, "mock-folder-manga");
    await seedCleanMangaRootFiles(page, [
      {
        id: "cov-0rtt-vol1",
        name: "[尾田栄一郎] ONE PIECE 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: threePageZip.byteLength,
        md5Checksum: "md5-0rtt-vol1",
        modifiedTime: baseTime + 1_000,
      },
    ]);

    // 自動抽出 ON で手動同期を実行し、表紙抽出完了＋zipIndexCache 保存を待機
    await setCoverExtractionAutoRun(page, true);
    await page.getByTestId("settings-sync-incremental-button").click();
    await expect(page.getByTestId("settings-sync-status-badge")).toHaveText(
      "同期完了",
    );
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);

    await expect(page.getByTestId("cover-thumbnail-image")).toBeVisible({
      timeout: 15_000,
    });
    const cacheKey = "gdrive:cov-0rtt-vol1:md5-0rtt-vol1";
    await expect
      .poll(async () => readZipIndexCacheRecord(page, cacheKey))
      .not.toBeNull();

    // 初回リーダーオープン前に通信ログをクリア
    routeController.clearRequests();

    // SCR-01 から初回オープン (TR-02b)
    await page.getByTestId("series-card-quick-read").click();
    await expect(page).toHaveURL(/\/read\/volume\/.+/);

    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready", {
      timeout: 15_000,
    });
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    const centerPixel = readPngCenterPixel(await canvas.screenshot());
    expect(centerPixel.r).toBeGreaterThan(200);
    expect(centerPixel.g).toBeLessThan(30);
    expect(centerPixel.b).toBeLessThan(30);

    // 末尾 EOCD / Central Directory Range 通信が発生していないこと（0 RTT）
    const readerRequests = routeController.requests.filter(
      (req) => req.fileId === "cov-0rtt-vol1" && req.status === 206,
    );
    expect(readerRequests.length).toBeGreaterThan(0);
    expect(
      readerRequests.some((req) => req.end === threePageZip.byteLength - 1),
    ).toBe(false);

    // TR-08 復帰後に診断ログで fromIndexCache=true を確認
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await page.getByTestId("copy-diagnostics-button").click();
    const diagText = await page.evaluate(() => navigator.clipboard.readText());
    expect(diagText).toContain(
      `目次キャッシュからアーカイブを開きました (0RTT) | ${cacheKey} (pages=3, fromIndexCache=true)`,
    );

    expect(pageErrors).toEqual([]);
  });

  test("(3) 表紙抽出進行中の SCR-03 遷移（TR-02b / TR-04 / TR-02a）で進行中通信が即時プリエンプション停止し、TR-07 / TR-08 復帰後に自動再開する", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    const threePageZip = buildSyntheticThreePageArchive();
    const baseTime = Date.parse("2026-11-26T09:00:00.000Z");

    const files: readonly SeedDriveFileSpec[] = [
      {
        id: "preempt-op-1",
        name: "[尾田栄一郎] ONE PIECE 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: threePageZip.byteLength,
        md5Checksum: "md5-preempt-op-1",
        modifiedTime: baseTime + 5_000,
      },
      {
        id: "preempt-op-2",
        name: "[尾田栄一郎] ONE PIECE 第02巻.cbz",
        parents: ["mock-folder-weekly"],
        size: threePageZip.byteLength,
        md5Checksum: "md5-preempt-op-2",
        modifiedTime: baseTime + 4_000,
      },
      {
        id: "preempt-akira-1",
        name: "[大友克洋] AKIRA 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: threePageZip.byteLength,
        md5Checksum: "md5-preempt-akira-1",
        modifiedTime: baseTime + 3_000,
      },
      {
        id: "preempt-jojo-1",
        name: "[荒木飛呂彦] ジョジョ 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: threePageZip.byteLength,
        md5Checksum: "md5-preempt-jojo-1",
        modifiedTime: baseTime + 2_000,
      },
    ];

    const archiveMap = new Map<string, Uint8Array>(
      files.map((f) => [f.id, threePageZip]),
    );
    const routeController = await installCoverDriveMediaRoute(
      context,
      archiveMap,
    );

    const abortedFileIds: string[] = [];
    page.on("requestfailed", (req) => {
      if (
        req.url().includes("googleapis.com/drive/v3/files/") &&
        req.failure()?.errorText === "net::ERR_ABORTED"
      ) {
        const segments = new URL(req.url()).pathname.split("/").filter(Boolean);
        abortedFileIds.push(
          decodeURIComponent(segments[segments.length - 1] ?? ""),
        );
      }
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await signInAndRegisterRoot(page, "mock-folder-manga");
    await seedCleanMangaRootFiles(page, files);

    await page.getByTestId("settings-sync-incremental-button").click();
    await expect(page.getByTestId("settings-sync-status-badge")).toHaveText(
      "同期完了",
    );
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("series-card")).toHaveCount(3);

    // 進行中表紙通信を順不同で確実に捕捉するため、読込対象巻 (preempt-op-1) 以外の最初の通信をゲート保持
    const readerExclude = new Set(["preempt-op-1"]);
    const holdTr02b = routeController.holdNextFile(readerExclude);
    await setCoverExtractionAutoRun(page, true);
    const heldFileA = await holdTr02b.arrived;

    // A) SCR-01 -> SCR-03 (/read/volume/:volumeId) (TR-02b): 進行中表紙通信が即時 abort され pause("reader") になること
    const tr02bStartedAt = Date.now();
    routeController.clearRequests();
    const onePieceCard = page
      .getByTestId("series-card")
      .filter({ hasText: "ONE PIECE" });
    await onePieceCard.getByTestId("series-card-quick-read").click();
    await expect(page).toHaveURL(/\/read\/volume\/.+/);

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__exLibrisServices?.coverExtractionScheduler?.getSnapshot()
              .pauseReasons ?? [],
        ),
      )
      .toContain("reader");
    await expect.poll(() => abortedFileIds.includes(heldFileA)).toBe(true);
    holdTr02b.release();

    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready", {
      timeout: 15_000,
    });
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");

    // リーダー閲覧中に他巻の表紙 Range リクエストが新規発火していないこと
    const nonReaderRequestsDuringTr02b = routeController.requests.filter(
      (req) =>
        req.receivedAt >= tr02bStartedAt && req.fileId !== "preempt-op-1",
    );
    expect(nonReaderRequestsDuringTr02b).toEqual([]);

    // TR-08 で SCR-01 へ復帰する前に次の進行中表紙通信をゲート保持して再開を確認
    abortedFileIds.length = 0;
    const holdTr04 = routeController.holdNextFile(readerExclude);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__exLibrisServices?.coverExtractionScheduler?.getSnapshot()
              .pauseReasons ?? [],
        ),
      )
      .not.toContain("reader");
    const heldFileB = await holdTr04.arrived;

    // B) SCR-01 -> SCR-02 -> SCR-03 (/read/volume/:volumeId) (TR-04): シリーズ詳細からも即時プリエンプションされること
    await onePieceCard.getByTestId("series-card-open-detail").click();
    await expect(page).toHaveURL(/\/series\/.+/);
    const tr04StartedAt = Date.now();
    routeController.clearRequests();

    await page
      .getByTestId("series-volume-item")
      .filter({ hasText: "第01巻" })
      .getByTestId("open-volume-reader-button")
      .click();
    await expect(page).toHaveURL(/\/read\/volume\/.+/);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__exLibrisServices?.coverExtractionScheduler?.getSnapshot()
              .pauseReasons ?? [],
        ),
      )
      .toContain("reader");
    await expect.poll(() => abortedFileIds.includes(heldFileB)).toBe(true);
    holdTr04.release();

    await expect(canvas).toHaveAttribute("data-webgl-status", "ready", {
      timeout: 15_000,
    });
    expect(
      routeController.requests.filter(
        (req) =>
          req.receivedAt >= tr04StartedAt && req.fileId !== "preempt-op-1",
      ),
    ).toEqual([]);

    // TR-07 で SCR-02 へ復帰し、さらに SCR-01 へ戻ってローカル ZIP (TR-02a) のプリエンプションを検証
    abortedFileIds.length = 0;
    const holdTr02a = routeController.holdNextFile(readerExclude);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/series\/.+/);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__exLibrisServices?.coverExtractionScheduler?.getSnapshot()
              .pauseReasons ?? [],
        ),
      )
      .not.toContain("reader");

    await page.getByTestId("series-detail-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    const heldFileC = await holdTr02a.arrived;

    // C) SCR-01 -> SCR-03 (/read/local) (TR-02a): ローカル ZIP 閲覧でもプリエンプションされること
    const tr02aStartedAt = Date.now();
    routeController.clearRequests();
    const localZipTransfer = await createFileDataTransfer(page, {
      name: "local-preempt-check.cbz",
      mimeType: "application/octet-stream",
      bytes: threePageZip,
    });
    await page
      .locator("main")
      .dispatchEvent("drop", { dataTransfer: localZipTransfer });
    await expect(page).toHaveURL(/\/read\/local$/);

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__exLibrisServices?.coverExtractionScheduler?.getSnapshot()
              .pauseReasons ?? [],
        ),
      )
      .toContain("reader");
    await expect.poll(() => abortedFileIds.includes(heldFileC)).toBe(true);
    holdTr02a.release();

    await expect(canvas).toHaveAttribute("data-webgl-status", "ready", {
      timeout: 15_000,
    });
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    // ローカル閲覧中は Drive への新規 Range リクエストが一切発生しないこと
    expect(
      routeController.requests.filter(
        (req) => req.receivedAt >= tr02aStartedAt,
      ),
    ).toEqual([]);

    // TR-08 で SCR-01 へ復帰後、残りの全 pending 巻が自動再開して完了すること
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__exLibrisServices?.coverExtractionScheduler?.getSnapshot()
                .readyCount ?? 0,
          ),
        { timeout: 20_000 },
      )
      .toBe(4);
    await expect(page.getByTestId("bookshelf-cover-status")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("(4) 429/403 Rate Limit 指数バックオフ自動回復と、破損ZIP/404エラーからの SCR-02/SCR-01/SCR-04 再試行回復", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    const validZip = buildSmallCoverArchive([60, 140, 240, 255]);
    const corruptZip = buildCorruptZipBytes();
    const baseTime = Date.parse("2026-11-26T09:00:00.000Z");

    const files: readonly SeedDriveFileSpec[] = [
      {
        id: "rl-429-vol",
        name: "[作者1] レート制限429作品 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: validZip.byteLength,
        md5Checksum: "md5-rl-429",
        modifiedTime: baseTime + 5_000,
      },
      {
        id: "rl-403-vol",
        name: "[作者2] レート制限403作品 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: validZip.byteLength,
        md5Checksum: "md5-rl-403",
        modifiedTime: baseTime + 4_000,
      },
      {
        id: "err-series-vol",
        name: "[作者3] 詳細再試行作品 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: validZip.byteLength,
        md5Checksum: "md5-err-series",
        modifiedTime: baseTime + 3_000,
      },
      {
        id: "err-bookshelf-vol",
        name: "[作者4] 本棚再試行作品 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: validZip.byteLength,
        md5Checksum: "md5-err-bookshelf",
        modifiedTime: baseTime + 2_000,
      },
      {
        id: "err-settings-vol",
        name: "[作者5] 設定再試行作品 第01巻.cbz",
        parents: ["mock-folder-weekly"],
        size: validZip.byteLength,
        md5Checksum: "md5-err-settings",
        modifiedTime: baseTime + 1_000,
      },
    ];

    // 初期状態:
    // - rl-429-vol: 初回 429 -> 1s バックオフ後に正常 206 回復
    // - rl-403-vol: 初回 403 (userRateLimitExceeded) -> 1s バックオフ後に正常 206 回復
    // - err-series-vol: 破損 ZIP -> coverStatus = "error"
    // - err-bookshelf-vol: 404 (archiveMap 未登録) -> coverStatus = "error"
    // - err-settings-vol: 404 (archiveMap 未登録) -> coverStatus = "error"
    const routeController = await installCoverDriveMediaRoute(
      context,
      new Map<string, Uint8Array>([
        ["rl-429-vol", validZip],
        ["rl-403-vol", validZip],
        ["err-series-vol", corruptZip],
      ]),
    );
    routeController.queueFault("rl-429-vol", {
      status: 429,
      body: { error: { code: 429, message: "Too Many Requests" } },
    });
    routeController.queueFault("rl-403-vol", {
      status: 403,
      body: {
        error: {
          code: 403,
          message: "User rate limit exceeded",
          errors: [{ reason: "userRateLimitExceeded" }],
        },
      },
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await signInAndRegisterRoot(page, "mock-folder-manga");
    await seedCleanMangaRootFiles(page, files);

    await setCoverExtractionAutoRun(page, true);
    await page.getByTestId("settings-sync-incremental-button").click();
    await expect(page.getByTestId("settings-sync-status-badge")).toHaveText(
      "同期完了",
    );
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("series-card")).toHaveCount(5);

    // 初期パス完了を待機: Rate Limit 2件は自動回復(ready)、破損/404 3件は error で停止
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const snap =
              window.__exLibrisServices?.coverExtractionScheduler?.getSnapshot();
            return snap
              ? {
                  readyCount: snap.readyCount,
                  pendingCount: snap.pendingCount,
                  errorCount: snap.errorCount,
                }
              : null;
          }),
        { timeout: 20_000 },
      )
      .toEqual({ readyCount: 2, pendingCount: 0, errorCount: 3 });

    // 429 と 403 Rate Limit が実際に応答され、指数バックオフを経て自動回復したことを検証
    expect(
      routeController.requests.some(
        (req) => req.fileId === "rl-429-vol" && req.status === 429,
      ),
    ).toBe(true);
    expect(
      routeController.requests.some(
        (req) => req.fileId === "rl-403-vol" && req.status === 403,
      ),
    ).toBe(true);
    await expect(
      page
        .getByTestId("series-card")
        .filter({ hasText: "レート制限429作品" })
        .getByTestId("cover-thumbnail-image"),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("series-card")
        .filter({ hasText: "レート制限403作品" })
        .getByTestId("cover-thumbnail-image"),
    ).toBeVisible();

    // SCR-01: エラーカードに「取得失敗」バッジとツールバー再試行ボタンが表示されること
    await expect(page.getByTestId("cover-thumbnail-error-badge")).toHaveCount(
      3,
    );
    await expect(page.getByTestId("bookshelf-cover-status")).toContainText(
      "表紙未取得: 3 冊",
    );
    await expect(
      page.getByTestId("bookshelf-retry-failed-covers-button"),
    ).toBeEnabled();

    // 1) SCR-02 シリーズ限定「表紙を再試行」: 詳細再試行作品のみを正常化＆再試行
    const seriesRetryCard = page
      .getByTestId("series-card")
      .filter({ hasText: "詳細再試行作品" });
    await seriesRetryCard.getByTestId("series-card-open-detail").click();
    await expect(page).toHaveURL(/\/series\/.+/);
    await expect(page.getByTestId("series-cover-error-banner")).toBeVisible();
    await expect(
      page.getByTestId("cover-thumbnail-error-badge").first(),
    ).toHaveText("取得失敗");

    routeController.setArchive("err-series-vol", validZip);
    await page.getByTestId("series-retry-failed-covers-button").click();

    await expect(
      page
        .getByTestId("series-volume-item")
        .getByTestId("cover-thumbnail-image"),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("series-cover-error-banner")).toHaveCount(0);

    // 2) SCR-01 本棚ツールバー「再試行」: 本棚再試行作品のみ正常化し、設定再試行作品は 404 のまま残す
    await page.getByTestId("series-detail-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-cover-status")).toContainText(
      "表紙未取得: 2 冊",
    );

    routeController.setArchive("err-bookshelf-vol", validZip);
    await page.getByTestId("bookshelf-retry-failed-covers-button").click();

    await expect(
      page
        .getByTestId("series-card")
        .filter({ hasText: "本棚再試行作品" })
        .getByTestId("cover-thumbnail-image"),
    ).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const snap =
              window.__exLibrisServices?.coverExtractionScheduler?.getSnapshot();
            return snap
              ? {
                  readyCount: snap.readyCount,
                  pendingCount: snap.pendingCount,
                  errorCount: snap.errorCount,
                }
              : null;
          }),
        { timeout: 15_000 },
      )
      .toEqual({ readyCount: 4, pendingCount: 0, errorCount: 1 });

    // 3) SCR-04 CoverExtractionSection「エラー分を再試行」: 残り1件を正常化して完了へ
    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("settings-cover-status-badge")).toHaveText(
      "要再試行",
    );
    await expect(page.getByTestId("settings-cover-counts")).toContainText(
      "エラー 1 冊",
    );
    await expect(
      page.getByTestId("settings-retry-failed-covers-button"),
    ).toBeEnabled();

    routeController.setArchive("err-settings-vol", validZip);
    await page.getByTestId("settings-retry-failed-covers-button").click();

    await expect(page.getByTestId("settings-cover-status-badge")).toHaveText(
      "完了",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("settings-cover-counts")).toContainText(
      "抽出済み 5 / 5 冊",
    );
    await expect(page.getByTestId("settings-cover-counts")).toContainText(
      "エラー 0 冊",
    );
    await expect(
      page.getByTestId("settings-retry-failed-covers-button"),
    ).toBeDisabled();

    // SCR-01 復帰で全5作品に表紙が表示され、ツールバーステータス行が非表示であること
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("cover-thumbnail-image")).toHaveCount(5);
    await expect(page.getByTestId("bookshelf-cover-status")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });
});
