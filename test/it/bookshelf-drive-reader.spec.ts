import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { MockAppBridge } from "../../src/bridges/app/mockAppBridge";
import {
  buildSyntheticThreePageArchive,
  createFileDataTransfer,
  readPngCenterPixel,
  readReadingProgressRecord,
  readZipIndexCacheRecord,
  resetTestDatabase,
  trackPageErrors,
  waitForServicesReady,
} from "./helpers";

interface RecordedDriveMediaRequest {
  readonly url: string;
  readonly fileId: string;
  readonly method: string;
  readonly rangeHeader: string | null;
  readonly start: number | null;
  readonly end: number | null;
  readonly authorization: string | null;
  readonly status: number;
}

interface DriveMediaRouteController {
  readonly requests: RecordedDriveMediaRequest[];
  readonly clearRequests: () => void;
  readonly setRejectTokenOnce: (token: string | null) => void;
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

async function installDriveMediaRangeRoute(
  context: BrowserContext,
  archivesByFileId: ReadonlyMap<string, Uint8Array>,
): Promise<DriveMediaRouteController> {
  const requests: RecordedDriveMediaRequest[] = [];
  let rejectTokenOnce: string | null = null;

  await context.route(
    "https://www.googleapis.com/drive/v3/files/**",
    async (route) => {
      const request = route.request();
      const method = request.method();
      const url = request.url();

      if (method === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: CORS_HEADERS,
        });
        return;
      }

      const parsedUrl = new URL(url);
      const segments = parsedUrl.pathname.split("/").filter(Boolean);
      const rawFileId = segments[segments.length - 1] ?? "";
      const fileId = decodeURIComponent(rawFileId);
      const headers = await request.allHeaders();
      const authorization = headers["authorization"] ?? null;
      const rangeHeader = headers["range"] ?? null;

      if (
        rejectTokenOnce !== null &&
        authorization === `Bearer ${rejectTokenOnce}`
      ) {
        rejectTokenOnce = null;
        requests.push({
          url,
          fileId,
          method,
          rangeHeader,
          start: null,
          end: null,
          authorization,
          status: 401,
        });
        await route.fulfill({
          status: 401,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            error: { code: 401, message: "Unauthorized" },
          }),
        });
        return;
      }

      const archive = archivesByFileId.get(fileId);
      if (!archive) {
        requests.push({
          url,
          fileId,
          method,
          rangeHeader,
          start: null,
          end: null,
          authorization,
          status: 404,
        });
        await route.fulfill({
          status: 404,
          headers: CORS_HEADERS,
          body: "Not Found",
        });
        return;
      }

      const parsedRange = parseRangeHeader(rangeHeader, archive.byteLength);
      if (!parsedRange) {
        requests.push({
          url,
          fileId,
          method,
          rangeHeader,
          start: null,
          end: null,
          authorization,
          status: 416,
        });
        await route.fulfill({
          status: 416,
          headers: {
            ...CORS_HEADERS,
            "Content-Range": `bytes */${archive.byteLength}`,
          },
        });
        return;
      }

      const slice = archive.subarray(parsedRange.start, parsedRange.end + 1);
      requests.push({
        url,
        fileId,
        method,
        rangeHeader,
        start: parsedRange.start,
        end: parsedRange.end,
        authorization,
        status: 206,
      });

      await route.fulfill({
        status: 206,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/octet-stream",
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${parsedRange.start}-${parsedRange.end}/${archive.byteLength}`,
          "Content-Length": String(slice.byteLength),
        },
        body: Buffer.from(slice),
      });
    },
  );

  return {
    requests,
    clearRequests: () => {
      requests.length = 0;
    },
    setRejectTokenOnce: (token: string | null) => {
      rejectTokenOnce = token;
    },
  };
}

async function signInAndRegisterRoots(
  page: Page,
  folderIds: readonly string[],
): Promise<void> {
  await page.getByTestId("header-settings-button").click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByTestId("google-signin-button").click();
  await expect(page.getByTestId("google-auth-status-badge")).toHaveText(
    "連携済み",
  );

  for (let i = 0; i < folderIds.length; i += 1) {
    const folderId = folderIds[i];
    await page.getByTestId("folder-input").fill(folderId);
    await page.getByTestId("add-folder-by-input-button").click();
    await expect(page.getByTestId("sync-root-item")).toHaveCount(i + 1);
  }
}

async function seedMockArchiveSizes(
  page: Page,
  archiveByteLength: number,
  extraItems: readonly {
    readonly id: string;
    readonly name: string;
    readonly parents: readonly string[];
    readonly md5Checksum: string;
    readonly modifiedTime: number;
  }[] = [],
): Promise<void> {
  await page.evaluate(
    ({ byteLength, extras }) => {
      const client = window.__exLibrisServices?.mockDriveSyncClient;
      if (!client) {
        throw new Error("mockDriveSyncClient is not available");
      }
      const baseTime = Date.parse("2026-11-25T09:00:00.000Z");
      const defaults = [
        {
          id: "mock-file-vol1",
          name: "[尾田栄一郎] ONE PIECE 第01巻 (一般コミック).cbz",
          mimeType: "application/octet-stream",
          parents: ["mock-folder-action"],
          size: byteLength,
          md5Checksum: "md5-op-01",
          modifiedTime: baseTime + 1_000,
          trashed: false,
        },
        {
          id: "mock-file-vol2",
          name: "[尾田栄一郎] ONE PIECE 第02巻.zip",
          mimeType: "application/zip",
          parents: ["mock-folder-action"],
          size: byteLength,
          md5Checksum: "md5-op-02",
          modifiedTime: baseTime + 2_000,
          trashed: false,
        },
        {
          id: "mock-file-omnibus",
          name: "[大友克洋] AKIRA 第01-03巻 合本.cbz",
          mimeType: "application/octet-stream",
          parents: ["mock-folder-scifi"],
          size: byteLength,
          md5Checksum: "md5-akira-0103",
          modifiedTime: baseTime + 3_000,
          trashed: false,
        },
        {
          id: "mock-file-parent-fallback",
          name: "01.cbz",
          mimeType: "application/octet-stream",
          parents: ["mock-folder-series-fallback"],
          size: byteLength,
          md5Checksum: "md5-maison-01",
          modifiedTime: baseTime + 4_000,
          trashed: false,
        },
        {
          id: "mock-file-manga-1",
          name: "[荒木飛呂彦] ジョジョの奇妙な冒険 第01巻.cbz",
          mimeType: "application/zip",
          parents: ["mock-folder-weekly"],
          size: byteLength,
          md5Checksum: "md5-jojo-01",
          modifiedTime: baseTime + 5_000,
          trashed: false,
        },
      ];
      for (const item of defaults) {
        client.upsertItem(item, false);
      }
      for (const extra of extras) {
        client.upsertItem(
          {
            id: extra.id,
            name: extra.name,
            mimeType: "application/octet-stream",
            parents: [...extra.parents],
            size: byteLength,
            md5Checksum: extra.md5Checksum,
            modifiedTime: extra.modifiedTime,
            trashed: false,
          },
          false,
        );
      }
    },
    { byteLength: archiveByteLength, extras: extraItems },
  );
}

async function getSeriesCardTitles(page: Page): Promise<string[]> {
  return page.getByTestId("series-card").locator("h3").allTextContents();
}

test.describe("SCN-05: 仮想本棚・シリーズ詳細・Drive巻リーダー統合（SCR-01〜SCR-04横断）結合検証", () => {
  test("(1) SCR-01/SCR-04手動同期(DriveSyncEmptyState・差分/強制フルスキャン・ヘッダー同期・自動通信ゼロ)と本棚グリッド・D&Dエラー共存", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await signInAndRegisterRoots(page, ["mock-folder-comics"]);

    // NFR-03: ルート登録直後は自動同期が走らず待機中のまま
    await expect(page.getByTestId("settings-sync-status-badge")).toHaveText(
      "待機中",
    );
    await expect(page.getByTestId("settings-last-synced-at")).toHaveText(
      "未実行",
    );

    // SCR-01 へ戻っても自動同期せず DriveSyncEmptyState が表示されること
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("drive-sync-empty-state")).toBeVisible();
    await expect(page.getByTestId("bookshelf-empty")).toHaveCount(0);
    await expect(page.getByTestId("series-grid-section")).toHaveCount(0);

    const lastSyncBeforeManual = await page.evaluate(async () => {
      const meta =
        await window.__exLibrisServices?.driveSyncMetaRepo?.getSyncState();
      return meta?.lastDriveSyncAt ?? null;
    });
    expect(lastSyncBeforeManual).toBeNull();

    // SCR-01 DriveSyncEmptyState の「今すぐ同期」から初回フルスキャンを実行
    await page.getByTestId("empty-state-sync-drive-button").click();
    await expect(page.getByTestId("series-grid-section")).toBeVisible();
    await expect(page.getByTestId("drive-sync-empty-state")).toHaveCount(0);
    await expect(page.getByTestId("bookshelf-empty")).toHaveCount(0);
    await expect(page.getByTestId("bookshelf-series-count")).toHaveText(
      "全 3 作品 / 4 冊",
    );
    await expect(page.getByTestId("series-card")).toHaveCount(3);
    await expect(page.getByTestId("bookshelf-last-synced")).not.toContainText(
      "未同期",
    );

    // 本棚グリッド表示中も <main> への非対応拡張子 D&D で role="alert" が表示されること
    const badDrop = await createFileDataTransfer(page, {
      name: "invalid-note.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("not a zip"),
    });
    await page.locator("main").dispatchEvent("drop", { dataTransfer: badDrop });
    const dropAlert = page.getByTestId("local-zip-error");
    await expect(dropAlert).toBeVisible();
    await expect(dropAlert).toHaveAttribute("role", "alert");

    // SCR-04 へ遷移して共有 driveSyncStateStore の結果サマリが反映されていることを確認
    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("settings-sync-status-badge")).toHaveText(
      "同期完了",
    );
    await expect(
      page.getByTestId("settings-sync-result-summary"),
    ).toContainText("フルスキャン");
    await expect(
      page.getByTestId("settings-sync-result-summary"),
    ).toContainText("追加・更新 4 冊");

    // 新規巻を追加し、SCR-04「今すぐ同期（差分）」を実行
    await page.evaluate(() => {
      window.__exLibrisServices?.mockDriveSyncClient?.upsertItem({
        id: "mock-file-vol3",
        name: "[尾田栄一郎] ONE PIECE 第03巻.cbz",
        mimeType: "application/octet-stream",
        parents: ["mock-folder-action"],
        size: 14_000_000,
        md5Checksum: "md5-op-03",
        modifiedTime: Date.parse("2026-11-25T10:00:00.000Z"),
        trashed: false,
      });
    });
    await page.getByTestId("settings-sync-incremental-button").click();
    await expect(
      page.getByTestId("settings-sync-result-summary"),
    ).toContainText("差分同期");
    await expect(
      page.getByTestId("settings-sync-result-summary"),
    ).toContainText("追加・更新 1 冊");

    // SCR-04「強制フルスキャン」を実行
    await page.getByTestId("settings-sync-full-button").click();
    await expect(
      page.getByTestId("settings-sync-result-summary"),
    ).toContainText("フルスキャン");
    await expect(
      page.getByTestId("settings-sync-result-summary"),
    ).toContainText("追加・更新 5 冊");

    // SCR-01 へ復帰し、ヘッダー「同期」ボタンから追加巻を増分取り込み
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-series-count")).toHaveText(
      "全 3 作品 / 5 冊",
    );

    await page.evaluate(() => {
      window.__exLibrisServices?.mockDriveSyncClient?.upsertItem({
        id: "mock-file-akira-vol1",
        name: "[大友克洋] AKIRA 第01巻.cbz",
        mimeType: "application/octet-stream",
        parents: ["mock-folder-scifi"],
        size: 13_000_000,
        md5Checksum: "md5-akira-01",
        modifiedTime: Date.parse("2026-11-25T10:05:00.000Z"),
        trashed: false,
      });
    });
    await page.getByTestId("header-sync-drive-button").click();
    await expect(page.getByTestId("bookshelf-series-count")).toHaveText(
      "全 3 作品 / 6 冊",
    );

    // R1-25 (AC-ST-08): 手動同期失敗時の role="alert" 表示（SCR-04 drive-sync-error および SCR-01 bookshelf-sync-error 双方）
    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);

    await page.evaluate(() => {
      window.__exLibrisServices?.mockDriveSyncClient?.setInjectedError(
        new Error("Mock Drive 503 Unavailable"),
      );
    });
    await page.getByTestId("settings-sync-incremental-button").click();
    await expect(page.getByTestId("settings-sync-status-badge")).toHaveText(
      "同期エラー",
    );
    const settingsSyncError = page.getByTestId("drive-sync-error");
    await expect(settingsSyncError).toBeVisible();
    await expect(settingsSyncError).toHaveAttribute("role", "alert");
    await expect(settingsSyncError).toContainText(
      "Google Drive 同期中に予期しないエラーが発生しました",
    );

    // TR-09 で SCR-01 へ戻ると共有 driveSyncStateStore のエラー通知 (bookshelf-sync-error) が role="alert" で表示されること
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    const bookshelfSyncError = page.getByTestId("bookshelf-sync-error");
    await expect(bookshelfSyncError).toBeVisible();
    await expect(bookshelfSyncError).toHaveAttribute("role", "alert");
    await expect(bookshelfSyncError).toContainText(
      "Google Drive 同期中に予期しないエラーが発生しました",
    );

    // SCR-01 ヘッダー「同期」ボタンからの手動同期失敗で新規同期リクエストが発火・失敗し role="alert" が維持されること
    await page.evaluate(() => {
      const client = window.__exLibrisServices?.mockDriveSyncClient;
      if (!client) {
        throw new Error("mockDriveSyncClient is not available");
      }
      const originalListChanges = client.listChanges.bind(client);
      let headerSyncAttempts = 0;
      (
        window as unknown as {
          __headerSyncErrorAttempts?: number;
          __restoreListChangesForHeaderRetry?: () => void;
        }
      ).__headerSyncErrorAttempts = 0;
      client.listChanges = async (options) => {
        headerSyncAttempts += 1;
        (
          window as unknown as { __headerSyncErrorAttempts?: number }
        ).__headerSyncErrorAttempts = headerSyncAttempts;
        return originalListChanges(options);
      };
      (
        window as unknown as {
          __restoreListChangesForHeaderRetry?: () => void;
        }
      ).__restoreListChangesForHeaderRetry = () => {
        client.listChanges = originalListChanges;
      };
    });
    await page.getByTestId("header-sync-drive-button").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __headerSyncErrorAttempts?: number })
              .__headerSyncErrorAttempts ?? 0,
        ),
      )
      .toBeGreaterThanOrEqual(1);
    await page.evaluate(() => {
      (
        window as unknown as {
          __restoreListChangesForHeaderRetry?: () => void;
        }
      ).__restoreListChangesForHeaderRetry?.();
    });
    await expect(bookshelfSyncError).toBeVisible();
    await expect(bookshelfSyncError).toHaveAttribute("role", "alert");

    // エラー注入を解除し、SCR-04 で同期実行中の排他 disabled（ログアウト・ルート変更抑止）＆ TR-09 帰還後の継続完了を検証
    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);

    await page.evaluate(() => {
      const client = window.__exLibrisServices?.mockDriveSyncClient;
      if (!client) {
        throw new Error("mockDriveSyncClient is not available");
      }
      client.setInjectedError(null);
      client.upsertItem({
        id: "mock-file-akira-vol2",
        name: "[大友克洋] AKIRA 第02巻.cbz",
        mimeType: "application/octet-stream",
        parents: ["mock-folder-scifi"],
        size: 13_500_000,
        md5Checksum: "md5-akira-02",
        modifiedTime: Date.parse("2026-11-25T10:10:00.000Z"),
        trashed: false,
      });

      const originalListChanges = client.listChanges.bind(client);
      let releaseGate: (() => void) | null = null;
      const gatePromise = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      (
        window as unknown as {
          __releaseMockSyncGate?: () => void;
        }
      ).__releaseMockSyncGate = () => {
        releaseGate?.();
      };
      client.listChanges = async (pageToken, options) => {
        await gatePromise;
        client.listChanges = originalListChanges;
        return originalListChanges(pageToken, options);
      };
    });

    await page.getByTestId("settings-sync-incremental-button").click();
    await expect(page.getByTestId("settings-sync-status-badge")).toHaveText(
      "同期中",
    );

    // 同期実行中の排他保護: ログアウトおよびルート変更操作がすべて disabled になること
    await expect(page.getByTestId("google-signout-button")).toBeDisabled();
    await expect(page.getByTestId("open-folder-picker-button")).toBeDisabled();
    await expect(page.getByTestId("folder-input")).toBeDisabled();
    await expect(page.getByTestId("add-folder-by-input-button")).toBeDisabled();
    await expect(
      page.getByTestId("toggle-sync-root-button").first(),
    ).toBeDisabled();
    await expect(
      page.getByTestId("remove-sync-root-button").first(),
    ).toBeDisabled();

    // 同期中も TR-09 はブロックされず SCR-01 へ戻れ、共有ストア経由で同期継続・完了すること
    await expect(page.getByTestId("settings-back-button")).toBeEnabled();
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("header-sync-drive-button")).toBeDisabled();

    await page.evaluate(() => {
      (
        window as unknown as {
          __releaseMockSyncGate?: () => void;
        }
      ).__releaseMockSyncGate?.();
    });

    await expect(page.getByTestId("bookshelf-series-count")).toHaveText(
      "全 3 作品 / 7 冊",
    );
    await expect(page.getByTestId("header-sync-drive-button")).toBeEnabled();
    await expect(page.getByTestId("bookshelf-sync-error")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("(2) SCR-01 4軸ソート・TR-02bクイック起動(206 Range + 401 Single-Flight + WebGL2 + HUD)・TR-08復帰時のlastReadAt先頭反映＆ソート/スクロール復元", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    const threePageZip = buildSyntheticThreePageArchive();
    const routeController = await installDriveMediaRangeRoute(
      context,
      new Map([
        ["mock-file-vol1", threePageZip],
        ["mock-file-vol2", threePageZip],
        ["mock-file-omnibus", threePageZip],
        ["mock-file-parent-fallback", threePageZip],
        ["mock-file-manga-1", threePageZip],
        ["mock-file-extra-1", threePageZip],
        ["mock-file-extra-2", threePageZip],
      ]),
    );

    // スマホ縦 viewport を明示指定（単ページ決定論描画 + スクロール余白確保）
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await signInAndRegisterRoots(page, [
      "mock-folder-comics",
      "mock-folder-manga",
    ]);

    const baseTime = Date.parse("2026-11-25T09:00:00.000Z");
    await seedMockArchiveSizes(page, threePageZip.byteLength, [
      {
        id: "mock-file-extra-1",
        name: "[浦沢直樹] MONSTER 第01巻.cbz",
        parents: ["mock-folder-action"],
        md5Checksum: "md5-monster-01",
        modifiedTime: baseTime + 6_000,
      },
      {
        id: "mock-file-extra-2",
        name: "[井上雄彦] SLAM DUNK 第01巻.cbz",
        parents: ["mock-folder-action"],
        md5Checksum: "md5-slamdunk-01",
        modifiedTime: baseTime + 7_000,
      },
    ]);

    await page.getByTestId("settings-sync-incremental-button").click();
    await expect(page.getByTestId("settings-sync-status-badge")).toHaveText(
      "同期完了",
    );

    // addedDesc ソート順を 100% 決定論化するため各シリーズの addedAt を明示的に階段設定
    await page.evaluate(async () => {
      const addedAtByDriveFileId: Record<string, number> = {
        "mock-file-vol1": 1_700_000_001_000,
        "mock-file-vol2": 1_700_000_001_500,
        "mock-file-omnibus": 1_700_000_002_000,
        "mock-file-extra-1": 1_700_000_003_000,
        "mock-file-extra-2": 1_700_000_004_000,
        "mock-file-manga-1": 1_700_000_005_000,
        "mock-file-parent-fallback": 1_700_000_006_000,
      };
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("ExLibrisDB");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const idb = request.result;
          const tx = idb.transaction("volumes", "readwrite");
          tx.oncomplete = () => {
            idb.close();
            resolve();
          };
          tx.onerror = () => {
            idb.close();
            reject(tx.error);
          };
          const store = tx.objectStore("volumes");
          const getAllReq = store.getAll();
          getAllReq.onerror = () => reject(getAllReq.error);
          getAllReq.onsuccess = () => {
            const rows = getAllReq.result as Record<string, unknown>[];
            for (const row of rows) {
              const driveFileId = String(row.driveFileId ?? "");
              const nextAddedAt = addedAtByDriveFileId[driveFileId];
              if (nextAddedAt !== undefined) {
                store.put({ ...row, addedAt: nextAddedAt });
              }
            }
          };
        };
      });
    });

    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("series-card")).toHaveCount(6);

    // 4軸ソート切替検証（全4軸で実カード並び順を検証）
    const sortSelect = page.getByTestId("bookshelf-sort-select");
    await expect(sortSelect).toHaveValue("lastReadDesc");

    const expectedAddedDescOrder = [
      "めぞん一刻",
      "ジョジョの奇妙な冒険",
      "SLAM DUNK",
      "MONSTER",
      "AKIRA",
      "ONE PIECE",
    ];
    await expect
      .poll(() => getSeriesCardTitles(page))
      .toEqual(expectedAddedDescOrder);

    await sortSelect.selectOption("volumeCountDesc");
    await expect
      .poll(() => getSeriesCardTitles(page))
      .toEqual([
        "ONE PIECE",
        "AKIRA",
        "MONSTER",
        "SLAM DUNK",
        "ジョジョの奇妙な冒険",
        "めぞん一刻",
      ]);

    await sortSelect.selectOption("titleAsc");
    await expect
      .poll(() => getSeriesCardTitles(page))
      .toEqual([
        "AKIRA",
        "MONSTER",
        "ONE PIECE",
        "SLAM DUNK",
        "ジョジョの奇妙な冒険",
        "めぞん一刻",
      ]);

    await sortSelect.selectOption("addedDesc");
    await expect(sortSelect).toHaveValue("addedDesc");
    await expect
      .poll(() => getSeriesCardTitles(page))
      .toEqual(expectedAddedDescOrder);

    // ソート順（titleAsc）とスクロール位置が SCR-04 往復（goBack / goForward）で復元されること
    await sortSelect.selectOption("titleAsc");
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight - window.innerHeight,
        ),
      )
      .toBeGreaterThan(150);
    await page.evaluate(() => window.scrollTo(0, 50));
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(50);

    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(sortSelect).toHaveValue("titleAsc");
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(50);
    await page.goForward();
    await expect(page).toHaveURL(/\/settings$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(sortSelect).toHaveValue("titleAsc");

    // ソート順（titleAsc）とスクロール位置が SCR-01 ↔ SCR-02 往復（TR-01 → TR-05 ＆ goForward / goBack）でも復元されること
    const slamDunkCard = page
      .getByTestId("series-card")
      .filter({ hasText: "SLAM DUNK" });
    await slamDunkCard
      .getByTestId("series-card-open-detail")
      .scrollIntoViewIfNeeded();
    const scrollBeforeDetail = await page.evaluate(() =>
      Math.round(window.scrollY),
    );
    expect(scrollBeforeDetail).toBeGreaterThan(100);

    await slamDunkCard.getByTestId("series-card-open-detail").click();
    await expect(page).toHaveURL(/\/series\/.+/);
    await expect(page.getByTestId("series-detail-title")).toHaveText(
      "SLAM DUNK",
    );
    // 非ゼロ位置からの順方向遷移 (TR-01) で SCR-02 が先頭初期化されること (R1-21)
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(0);

    await page.getByTestId("series-detail-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(sortSelect).toHaveValue("titleAsc");
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(scrollBeforeDetail);

    // 再度 TR-01 で遷移し、ブラウザ goBack() でもスクロール位置復元 ＆ goForward() / goBack() 追従を検証
    await slamDunkCard.getByTestId("series-card-open-detail").click();
    await expect(page).toHaveURL(/\/series\/.+/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(sortSelect).toHaveValue("titleAsc");
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(scrollBeforeDetail);

    await page.goForward();
    await expect(page).toHaveURL(/\/series\/.+/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(sortSelect).toHaveValue("titleAsc");

    // 最終読書順に戻して ONE PIECE カード位置までスクロールしてからクイック起動 (TR-02b)
    await sortSelect.selectOption("lastReadDesc");
    const onePieceCard = page
      .getByTestId("series-card")
      .filter({ hasText: "ONE PIECE" });
    await onePieceCard
      .getByTestId("series-card-quick-read")
      .scrollIntoViewIfNeeded();
    const scrollBeforeQuickRead = await page.evaluate(() =>
      Math.round(window.scrollY),
    );
    expect(scrollBeforeQuickRead).toBeGreaterThan(100);

    // 初回アクセストークンに対して 1 回だけ 401 を返し Single-Flight リフレッシュを強制検証
    const currentToken = await page.evaluate(
      () =>
        window.__exLibrisServices?.mockGoogleAuthAdapter?.getLinkedState()
          .currentAccessToken ?? null,
    );
    expect(currentToken).toBe("mock-drive-token-1");
    routeController.clearRequests();
    routeController.setRejectTokenOnce(currentToken);

    await onePieceCard.getByTestId("series-card-quick-read").click();
    await expect(page).toHaveURL(/\/read\/volume\/.+/);

    // 実 Worker + 206 Range + 401 リフレッシュ + SwiftShader WebGL2 描画を検証
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready", {
      timeout: 15_000,
    });
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    const page0Pixel = readPngCenterPixel(await canvas.screenshot());
    expect(page0Pixel.r).toBeGreaterThan(200);
    expect(page0Pixel.g).toBeLessThan(30);
    expect(page0Pixel.b).toBeLessThan(30);

    // 401 Single-Flight リフレッシュと 206 Partial Content のみで描画されたことを検証
    const mediaRequests = routeController.requests.filter(
      (req) => req.fileId === "mock-file-vol1",
    );
    expect(mediaRequests.some((req) => req.status === 401)).toBe(true);
    expect(mediaRequests.some((req) => req.status === 206)).toBe(true);
    expect(
      mediaRequests.every((req) => req.status === 401 || req.status === 206),
    ).toBe(true);
    expect(
      mediaRequests.some(
        (req) =>
          req.status === 206 &&
          req.authorization === "Bearer mock-drive-token-2",
      ),
    ).toBe(true);

    const refreshCount = await page.evaluate(
      () =>
        window.__exLibrisServices?.mockGoogleAuthAdapter?.getLinkedState()
          .refreshCount ?? 0,
    );
    expect(refreshCount).toBe(1);

    // 中央タップで HUD を開き「作品名 巻ラベル」を検証
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(page.getByTestId("reader-file-name")).toHaveText(
      "ONE PIECE 第01巻",
    );

    // 次ページ (p.2 / index 1: 緑) へめくり、HUD「戻る」で TR-08 (SCR-01) へ復帰
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");
    const page1Pixel = readPngCenterPixel(await canvas.screenshot());
    expect(page1Pixel.r).toBeLessThan(30);
    expect(page1Pixel.g).toBeGreaterThan(200);
    expect(page1Pixel.b).toBeLessThan(30);

    const { vol1Id, onePieceSeriesId } = await page.evaluate(async () => {
      const vol =
        await window.__exLibrisServices?.volumesRepo?.getByDriveFileId(
          "mock-file-vol1",
        );
      return {
        vol1Id: vol?.id ?? "",
        onePieceSeriesId: vol?.seriesId ?? "",
      };
    });
    expect(vol1Id).not.toBe("");
    expect(onePieceSeriesId).not.toBe("");

    // R1-24: /read/volume/:volumeId からのブラウザ page.goBack() (popstate) で vol:* 進捗・series.lastReadAt が保存され、
    // SCR-01 のソート順・先頭反映・進捗バッジ・スクロール位置が復元されること
    const volumeReaderUrl = page.url();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(sortSelect).toHaveValue("lastReadDesc");
    await expect
      .poll(async () => (await getSeriesCardTitles(page))[0])
      .toBe("ONE PIECE");
    await expect(
      page.getByTestId("series-card").first().getByTestId("series-read-status"),
    ).toHaveText("読書中 (0/2)");
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(scrollBeforeQuickRead);

    const progressAfterGoBack = await readReadingProgressRecord(
      page,
      `vol:${vol1Id}`,
    );
    expect(progressAfterGoBack?.currentPageIndex).toBe(1);
    expect(progressAfterGoBack?.totalPageCount).toBe(3);

    const lastReadAtAfterGoBack = await page.evaluate(async (seriesId) => {
      const series =
        await window.__exLibrisServices?.seriesRepo?.getById(seriesId);
      return series?.lastReadAt ?? null;
    }, onePieceSeriesId);
    expect(lastReadAtAfterGoBack).not.toBeNull();

    // page.goForward() でリーダーが保存位置 (index 1) から安全に再表示されること
    await page.goForward();
    await expect(page).toHaveURL(volumeReaderUrl);
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready", {
      timeout: 15_000,
    });
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");
    const forwardResumedPixel = readPngCenterPixel(await canvas.screenshot());
    expect(forwardResumedPixel.r).toBeLessThan(30);
    expect(forwardResumedPixel.g).toBeGreaterThan(200);
    expect(forwardResumedPixel.b).toBeLessThan(30);

    // HUD を開いて「戻る」ボタンで TR-08 (SCR-01) へ復帰
    const boxAfterForward = await canvas.boundingBox();
    expect(boxAfterForward).not.toBeNull();
    await page.mouse.click(
      boxAfterForward!.x + boxAfterForward!.width / 2,
      boxAfterForward!.y + boxAfterForward!.height / 2,
    );
    await page.getByTestId("reader-back-button").click();
    await expect(page).toHaveURL(/\/$/);

    // TR-08 復帰後も ONE PIECE 先頭・進捗・DB レコードが維持されていること
    await expect(sortSelect).toHaveValue("lastReadDesc");
    await expect
      .poll(async () => (await getSeriesCardTitles(page))[0])
      .toBe("ONE PIECE");
    await expect(
      page.getByTestId("series-card").first().getByTestId("series-read-status"),
    ).toHaveText("読書中 (0/2)");

    const savedProgress = await readReadingProgressRecord(
      page,
      `vol:${vol1Id}`,
    );
    expect(savedProgress?.currentPageIndex).toBe(1);
    expect(savedProgress?.totalPageCount).toBe(3);

    expect(pageErrors).toEqual([]);
  });

  test("(3) TR-01 SCR-02(単巻+合本バッジ・進捗バー)→TR-04 2回目zipIndexCache 0RTT＆自動レジューム→TR-07 SCR-02スクロール復元→TR-05 SCR-01復帰", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const threePageZip = buildSyntheticThreePageArchive();
    const extraAkiraIds = [
      "mock-file-akira-v1",
      "mock-file-akira-v2",
      "mock-file-akira-v3",
      "mock-file-akira-v4",
      "mock-file-akira-v5",
      "mock-file-akira-v6",
    ];
    const archiveMap = new Map<string, Uint8Array>([
      ["mock-file-omnibus", threePageZip],
    ]);
    for (const id of extraAkiraIds) {
      archiveMap.set(id, threePageZip);
    }
    const routeController = await installDriveMediaRangeRoute(
      context,
      archiveMap,
    );

    // 375x667 を明示指定（単ページ決定論 + SCR-02 巻一覧スクロール余白確保）
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await signInAndRegisterRoots(page, ["mock-folder-comics"]);
    const baseTime = Date.parse("2026-11-25T09:00:00.000Z");
    await seedMockArchiveSizes(
      page,
      threePageZip.byteLength,
      extraAkiraIds.map((id, idx) => ({
        id,
        name: `[大友克洋] AKIRA 第0${idx + 1}巻.cbz`,
        parents: ["mock-folder-scifi"],
        md5Checksum: `md5-akira-v${idx + 1}`,
        modifiedTime: baseTime + (10 + idx) * 1_000,
      })),
    );

    await page.getByTestId("settings-sync-incremental-button").click();
    await expect(page.getByTestId("settings-sync-status-badge")).toHaveText(
      "同期完了",
    );
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);

    // TR-01: AKIRA カード本体タップで SCR-02 へ遷移
    const akiraCard = page
      .getByTestId("series-card")
      .filter({ hasText: "AKIRA" });
    await akiraCard.getByTestId("series-card-open-detail").click();
    await expect(page).toHaveURL(/\/series\/.+/);
    await expect(page.getByTestId("series-detail-title")).toHaveText("AKIRA");
    await expect(page.getByTestId("series-detail-authors")).toHaveText(
      "大友克洋",
    );
    await expect(page.getByTestId("series-volume-item")).toHaveCount(7);
    await expect(page.getByTestId("volume-omnibus-badge")).toHaveCount(1);
    await expect(page.getByTestId("volume-omnibus-badge")).toHaveText("合本");

    // 1回目オープン (TR-04): 第01巻を開き初回 TTFP (fromIndexCache=false) を計測し、p.2 (index 1: 緑) へ進めて TR-07 で戻る
    const vol1Row = page
      .getByTestId("series-volume-item")
      .filter({ hasText: "第01巻" })
      .first();
    const firstOpenStartMs = performance.now();
    await vol1Row.getByTestId("open-volume-reader-button").click();
    await expect(page).toHaveURL(/\/read\/volume\/.+/);

    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready", {
      timeout: 15_000,
    });
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const firstTtfpMs = performance.now() - firstOpenStartMs;
    expect(firstTtfpMs).toBeGreaterThanOrEqual(0);
    expect(firstTtfpMs).toBeLessThan(5_000);

    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");

    // zipIndexCache が保存されていることを確認
    const cacheKey = "gdrive:mock-file-akira-v1:md5-akira-v1";
    await expect
      .poll(async () => readZipIndexCacheRecord(page, cacheKey))
      .not.toBeNull();

    // TR-07 復帰: SCR-02 に進捗バー (2 / 3 ページ・読書中) が反映されること
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/series\/.+/);
    await expect(vol1Row.getByTestId("volume-read-status")).toHaveText(
      "読書中",
    );
    await expect(vol1Row.getByTestId("volume-progress-text")).toHaveText(
      "2 / 3 ページ",
    );
    await expect(vol1Row.getByTestId("volume-progress-bar")).toBeVisible();

    // SCR-02 をスクロールしてから 2 回目の TR-04 巻選択を実行（0RTT + TTFP 計測 + 自動レジューム + スクロール復元）
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight - window.innerHeight,
        ),
      )
      .toBeGreaterThan(160);
    await page.evaluate(() => window.scrollTo(0, 140));
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(140);

    routeController.clearRequests();
    const secondOpenStartMs = performance.now();
    await vol1Row.getByTestId("open-volume-reader-button").click();
    await expect(page).toHaveURL(/\/read\/volume\/.+/);

    await expect(canvas).toHaveAttribute("data-webgl-status", "ready", {
      timeout: 15_000,
    });
    // 前回ページ (index 1: 緑) へ自動レジューム
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const secondTtfpMs = performance.now() - secondOpenStartMs;
    expect(secondTtfpMs).toBeGreaterThanOrEqual(0);
    expect(secondTtfpMs).toBeLessThan(5_000);
    test.info().annotations.push({
      type: "drive-ttfp-ms",
      description: `first=${firstTtfpMs.toFixed(1)}ms, second(0RTT)=${secondTtfpMs.toFixed(1)}ms`,
    });

    const resumedPixel = readPngCenterPixel(await canvas.screenshot());
    expect(resumedPixel.r).toBeLessThan(30);
    expect(resumedPixel.g).toBeGreaterThan(200);
    expect(resumedPixel.b).toBeLessThan(30);

    // 2回目オープンでは末尾 EOCD/Central Directory 読込が発生しない (0 RTT) ことを検証
    const secondOpenRequests = routeController.requests.filter(
      (req) => req.fileId === "mock-file-akira-v1" && req.status === 206,
    );
    expect(secondOpenRequests.length).toBeGreaterThan(0);
    expect(
      secondOpenRequests.some((req) => req.end === threePageZip.byteLength - 1),
    ).toBe(false);

    // TR-07 復帰で SCR-02 スクロール位置 140px が復元されること
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/series\/.+/);
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(140);

    // TR-05 で SCR-01 へ復帰: 遷移前に 0px 保存していたため 140px 引き継ぎせず 0px へ復元されること (R1-21)
    await page.getByTestId("series-detail-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(0);
    await page.getByTestId("copy-diagnostics-button").click();
    const diagText = await page.evaluate(() => navigator.clipboard.readText());
    expect(diagText).toMatch(
      new RegExp(
        `\\[\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z\\] \\[INFO\\] \\[reader\\] Central Directory解析でアーカイブを開きました \\| ${cacheKey} \\(pages=3, fromIndexCache=false\\)`,
      ),
    );
    expect(diagText).toMatch(
      new RegExp(
        `\\[\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z\\] \\[INFO\\] \\[reader\\] 目次キャッシュからアーカイブを開きました \\(0RTT\\) \\| ${cacheKey} \\(pages=3, fromIndexCache=true\\)`,
      ),
    );

    expect(pageErrors).toEqual([]);
  });

  test("(4) Androidハードウェア戻る優先度（優先度2 画質補正シート閉鎖→優先度3 TR-07/TR-08→優先度4 TR-05/TR-09）", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    const threePageZip = buildSyntheticThreePageArchive();
    await installDriveMediaRangeRoute(
      context,
      new Map([["mock-file-vol1", threePageZip]]),
    );

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await signInAndRegisterRoots(page, ["mock-folder-comics"]);
    await seedMockArchiveSizes(page, threePageZip.byteLength);
    await page.getByTestId("settings-sync-incremental-button").click();
    await expect(page.getByTestId("settings-sync-status-badge")).toHaveText(
      "同期完了",
    );

    // 優先度 4: SCR-04 -> TR-09 -> SCR-01
    await page.evaluate(async () => {
      const bridge = window.__exLibrisServices?.appBridge as
        MockAppBridge | undefined;
      await bridge?.triggerBackButton();
    });
    await expect(page).toHaveURL(/\/$/);

    // SCR-01 -> TR-01 -> SCR-02 -> TR-04 -> SCR-03
    const onePieceCard = page
      .getByTestId("series-card")
      .filter({ hasText: "ONE PIECE" });
    await onePieceCard.getByTestId("series-card-open-detail").click();
    await expect(page).toHaveURL(/\/series\/.+/);
    const seriesDetailUrl = page.url();

    await page
      .getByTestId("series-volume-item")
      .first()
      .getByTestId("open-volume-reader-button")
      .click();
    await expect(page).toHaveURL(/\/read\/volume\/.+/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready", {
      timeout: 15_000,
    });

    // HUD を開き画質補正シートを表示
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.getByTestId("reader-shader-button").click();
    await expect(page.getByTestId("reader-shader-sheet")).toBeVisible();

    // 優先度 2: ハードウェア戻るで画質補正シートのみ閉鎖しリーダーに留まる
    await page.evaluate(async () => {
      const bridge = window.__exLibrisServices?.appBridge as
        MockAppBridge | undefined;
      await bridge?.triggerBackButton();
    });
    await expect(page.getByTestId("reader-shader-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\/read\/volume\/.+/);

    // 優先度 3: 再度のハードウェア戻るで TR-07 (SCR-02) へ戻る
    await page.evaluate(async () => {
      const bridge = window.__exLibrisServices?.appBridge as
        MockAppBridge | undefined;
      await bridge?.triggerBackButton();
    });
    await expect(page).toHaveURL(seriesDetailUrl);

    // 優先度 4: SCR-02 からハードウェア戻るで TR-05 (SCR-01) へ戻る
    await page.evaluate(async () => {
      const bridge = window.__exLibrisServices?.appBridge as
        MockAppBridge | undefined;
      await bridge?.triggerBackButton();
    });
    await expect(page).toHaveURL(/\/$/);

    // TR-02b クイック起動 -> 優先度 3 で TR-08 (SCR-01) へ直接戻る
    await onePieceCard.getByTestId("series-card-quick-read").click();
    await expect(page).toHaveURL(/\/read\/volume\/.+/);
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready", {
      timeout: 15_000,
    });
    await page.evaluate(async () => {
      const bridge = window.__exLibrisServices?.appBridge as
        MockAppBridge | undefined;
      await bridge?.triggerBackButton();
    });
    await expect(page).toHaveURL(/\/$/);

    expect(pageErrors).toEqual([]);
  });

  test("(5) 異常系エラー導線(VOLUME_NOT_FOUND/VOLUME_UNAVAILABLE/AUTH_REQUIRED・直接URL/不正パスフォールバック・SCR-02 0件案内・SCR-04ルート一時無効化→再有効化の本棚反映)", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    const threePageZip = buildSyntheticThreePageArchive();
    const routeController = await installDriveMediaRangeRoute(
      context,
      new Map([["mock-file-vol1", threePageZip]]),
    );

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await signInAndRegisterRoots(page, [
      "mock-folder-comics",
      "mock-folder-manga",
    ]);
    await seedMockArchiveSizes(page, threePageZip.byteLength);
    await page.getByTestId("settings-sync-incremental-button").click();
    await expect(page.getByTestId("settings-sync-status-badge")).toHaveText(
      "同期完了",
    );
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("series-card")).toHaveCount(4);

    const ids = await page.evaluate(async () => {
      const vol1 =
        await window.__exLibrisServices?.volumesRepo?.getByDriveFileId(
          "mock-file-vol1",
        );
      return {
        vol1Id: vol1?.id ?? "",
        onePieceSeriesId: vol1?.seriesId ?? "",
      };
    });
    expect(ids.vol1Id).not.toBe("");
    expect(ids.onePieceSeriesId).not.toBe("");

    // 不正パス (/series/, /series/a/b, 不正パーセントエンコード /series/%E0%A4%A) は例外なしで / へフォールバック
    await page.goto("/series/");
    await waitForServicesReady(page);
    await expect(page.getByTestId("bookshelf-page")).toBeVisible();

    await page.goto("/series/a/b");
    await waitForServicesReady(page);
    await expect(page.getByTestId("bookshelf-page")).toBeVisible();

    await page.evaluate(() => {
      window.history.pushState(null, "", "/series/%E0%A4%A");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.getByTestId("bookshelf-page")).toBeVisible();

    // SCR-02 未存在 seriesId -> series-detail-empty 案内＆「本棚へ戻る」
    await page.goto("/series/non-existent-series-id");
    await waitForServicesReady(page);
    await expect(page.getByTestId("series-detail-empty")).toBeVisible();
    await page.getByTestId("series-detail-empty-back-button").click();
    await expect(page).toHaveURL(/\/$/);

    // /read/volume/non-existent -> VOLUME_NOT_FOUND + ホームへ戻る (Worker/Range未通信)
    routeController.clearRequests();
    await page.goto("/read/volume/non-existent-volume-id");
    await waitForServicesReady(page);
    await expect(page.getByTestId("reader-error-view")).toBeVisible();
    await expect(page.getByTestId("reader-error-code")).toContainText(
      "VOLUME_NOT_FOUND",
    );
    await expect(page.getByTestId("reader-error-back-button")).toHaveText(
      "ホームへ戻る",
    );
    expect(routeController.requests).toHaveLength(0);
    await page.getByTestId("reader-error-back-button").click();
    await expect(page).toHaveURL(/\/$/);

    // SCR-04 で Comics ルートを一時無効化 -> SCR-01 から ONE PIECE 等が消え、自炊マンガ配下のみ残る
    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);
    await page
      .getByRole("button", { name: "Comics の同期を無効にする" })
      .click();
    await expect(
      page.getByRole("button", { name: "Comics の同期を有効にする" }),
    ).toHaveAttribute("aria-pressed", "false");

    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("series-card")).toHaveCount(1);
    await expect(page.getByTestId("series-card").first()).toContainText(
      "ジョジョの奇妙な冒険",
    );

    // 無効ルート配下の SCR-02 へ直接アクセス -> 有効巻 0 件案内 (series-detail-empty)
    await page.goto(`/series/${ids.onePieceSeriesId}`);
    await waitForServicesReady(page);
    await expect(page.getByTestId("series-detail-empty")).toBeVisible();
    await page.getByTestId("series-detail-empty-back-button").click();
    await expect(page).toHaveURL(/\/$/);

    // 無効ルート配下の /read/volume/:volumeId 直接アクセス -> VOLUME_UNAVAILABLE + シリーズ詳細へ戻る (TR-07 直接URLフォールバック)
    routeController.clearRequests();
    await page.goto(`/read/volume/${ids.vol1Id}`);
    await waitForServicesReady(page);
    await expect(page.getByTestId("reader-error-view")).toBeVisible();
    await expect(page.getByTestId("reader-error-code")).toContainText(
      "VOLUME_UNAVAILABLE",
    );
    await expect(page.getByTestId("reader-error-back-button")).toHaveText(
      "シリーズ詳細へ戻る",
    );
    expect(routeController.requests).toHaveLength(0);
    await page.getByTestId("reader-error-back-button").click();
    await expect(page).toHaveURL(
      new RegExp(`/series/${ids.onePieceSeriesId}$`),
    );
    await page.getByTestId("series-detail-empty-back-button").click();
    await expect(page).toHaveURL(/\/$/);

    // SCR-04 で Comics ルートを再有効化 -> SCR-01 に全 4 シリーズが復帰
    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);
    await page
      .getByRole("button", { name: "Comics の同期を有効にする" })
      .click();
    await expect(
      page.getByRole("button", { name: "Comics の同期を無効にする" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("series-card")).toHaveCount(4);

    // SCR-04 でログアウト -> SCR-01 で unauthenticated バナー + ローカル蔵書閲覧維持
    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByTestId("google-signout-button").click();
    await expect(page.getByTestId("google-auth-status-badge")).toHaveText(
      "未連携",
    );
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("drive-setup-banner")).toHaveAttribute(
      "data-banner-kind",
      "unauthenticated",
    );
    await expect(page.getByTestId("series-card")).toHaveCount(4);

    // 未連携状態で SCR-01 クイック起動 (TR-02b) -> AUTH_REQUIRED + ホームへ戻る (TR-08)
    routeController.clearRequests();
    const onePieceCard = page
      .getByTestId("series-card")
      .filter({ hasText: "ONE PIECE" });
    await onePieceCard.getByTestId("series-card-quick-read").click();
    await expect(page).toHaveURL(new RegExp(`/read/volume/${ids.vol1Id}$`));
    await expect(page.getByTestId("reader-error-view")).toBeVisible();
    await expect(page.getByTestId("reader-error-code")).toContainText(
      "AUTH_REQUIRED",
    );
    await expect(page.getByTestId("reader-error-back-button")).toHaveText(
      "ホームへ戻る",
    );
    expect(routeController.requests).toHaveLength(0);
    await page.getByTestId("reader-error-back-button").click();
    await expect(page).toHaveURL(/\/$/);

    // 未連携状態で SCR-02 巻選択 (TR-04) -> AUTH_REQUIRED + シリーズ詳細へ戻る (TR-07)
    await onePieceCard.getByTestId("series-card-open-detail").click();
    await expect(page).toHaveURL(
      new RegExp(`/series/${ids.onePieceSeriesId}$`),
    );
    await page
      .getByTestId("series-volume-item")
      .first()
      .getByTestId("open-volume-reader-button")
      .click();
    await expect(page).toHaveURL(new RegExp(`/read/volume/${ids.vol1Id}$`));
    await expect(page.getByTestId("reader-error-view")).toBeVisible();
    await expect(page.getByTestId("reader-error-code")).toContainText(
      "AUTH_REQUIRED",
    );
    await expect(page.getByTestId("reader-error-back-button")).toHaveText(
      "シリーズ詳細へ戻る",
    );
    expect(routeController.requests).toHaveLength(0);
    await page.getByTestId("reader-error-back-button").click();
    await expect(page).toHaveURL(
      new RegExp(`/series/${ids.onePieceSeriesId}$`),
    );

    expect(pageErrors).toEqual([]);
  });
});
