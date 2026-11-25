import { expect, test, type Page } from "@playwright/test";
import {
  readZipIndexCacheRecord,
  resetTestDatabase,
  trackPageErrors,
  waitForServicesReady,
} from "./helpers";

async function seedZipIndexCacheRecord(
  page: Page,
  cacheKey: string,
): Promise<void> {
  await page.evaluate(async (key) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("ExLibrisDB");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const idb = request.result;
        const tx = idb.transaction("zipIndexCache", "readwrite");
        tx.oncomplete = () => {
          idb.close();
          resolve();
        };
        tx.onerror = () => {
          idb.close();
          reject(tx.error);
        };
        tx.objectStore("zipIndexCache").put({
          cacheKey: key,
          entries: [
            {
              entryName: "001.png",
              localHeaderOffset: 0,
              compressedSize: 100,
              uncompressedSize: 100,
              compressionMethod: 0,
              crc32: 0,
            },
          ],
          pageCount: 1,
          cachedAt: 1_700_000_000_000,
        });
      };
    });
  }, cacheKey);
}

async function seedVolumeCoverReady(
  page: Page,
  volumeId: string,
  coverUpdatedAt: number,
): Promise<void> {
  await page.evaluate(
    async ({ id, updatedAt }) => {
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
          const getReq = store.get(id);
          getReq.onerror = () => reject(getReq.error);
          getReq.onsuccess = () => {
            const current = getReq.result as
              Record<string, unknown> | undefined;
            if (!current) {
              reject(new Error(`Volume not found: ${id}`));
              return;
            }
            store.put({
              ...current,
              coverBlob: new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], {
                type: "image/webp",
              }),
              coverStatus: "ready",
              coverUpdatedAt: updatedAt,
            });
          };
        };
      });
    },
    { id: volumeId, updatedAt: coverUpdatedAt },
  );
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

test.describe("SCN-04: 指定フォルダDriveスキャン・changes.list差分同期・ファイル名パーサー・IndexedDB永続化結合検証", () => {
  test("(1) SCR-04ルート登録→フルスキャン(mode: full)で多段サブフォルダ取込・対象外除外・単巻+合本/親フォルダ補完の同一series束ね", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await signInAndRegisterRoots(page, ["mock-folder-comics"]);

    // 単巻+合本（AKIRA）および親フォルダ補完+明示タイトル（めぞん一刻）の同一 series 束ねを検証するため初期ツリーへ追加
    await page.evaluate(() => {
      const client = window.__exLibrisServices?.mockDriveSyncClient;
      if (!client) {
        throw new Error("mockDriveSyncClient is not available");
      }
      client.upsertItem(
        {
          id: "mock-file-akira-vol1",
          name: "[大友克洋] AKIRA 第01巻.cbz",
          mimeType: "application/octet-stream",
          parents: ["mock-folder-scifi"],
          size: 14_000_000,
          md5Checksum: "md5-akira-01",
          modifiedTime: Date.parse("2026-11-25T09:05:00.000Z"),
          trashed: false,
        },
        false,
      );
      client.upsertItem(
        {
          id: "mock-file-maison-vol2",
          name: "[高橋留美子] めぞん一刻 第02巻.cbz",
          mimeType: "application/zip",
          parents: ["mock-folder-action"],
          size: 10_500_000,
          md5Checksum: "md5-maison-02",
          modifiedTime: Date.parse("2026-11-25T09:06:00.000Z"),
          trashed: false,
        },
        false,
      );
    });

    const snapshot = await page.evaluate(async () => {
      const services = window.__exLibrisServices;
      if (
        !services?.driveSyncEngine ||
        !services.seriesRepo ||
        !services.volumesRepo ||
        !services.driveSyncMetaRepo
      ) {
        throw new Error("Drive sync services are not available");
      }

      const result = await services.driveSyncEngine.sync();
      const seriesList = await services.seriesRepo.listActive();
      const volumesBySeries = await Promise.all(
        seriesList.map(async (series) => ({
          title: series.title,
          authors: series.authors,
          volumes: (await services.volumesRepo!.listBySeriesId(series.id)).map(
            (vol) => ({
              driveFileId: vol.driveFileId,
              volumeNumber: vol.volumeNumber,
              volumeLabel: vol.volumeLabel,
              rootFolderId: vol.rootFolderId,
              isTrashed: vol.isTrashed,
            }),
          ),
        })),
      );

      const excludedReadme =
        await services.volumesRepo.getByDriveFileId("mock-file-readme");
      const excludedOutside =
        await services.volumesRepo.getByDriveFileId("mock-file-outside");
      const excludedUnregisteredRoot =
        await services.volumesRepo.getByDriveFileId("mock-file-manga-1");
      const syncMeta = await services.driveSyncMetaRepo.getSyncState();

      return {
        result,
        volumesBySeries,
        excludedReadme,
        excludedOutside,
        excludedUnregisteredRoot,
        syncMeta,
      };
    });

    expect(snapshot.result.mode).toBe("full");
    expect(snapshot.result.scannedRoots).toBe(1);
    expect(snapshot.result.upsertedVolumes).toBe(6);
    expect(snapshot.result.trashedVolumes).toBe(0);
    expect(snapshot.result.invalidatedZipCaches).toBe(0);

    // 非アーカイブ(.txt)・対象外フォルダ(.cbz)・未登録ルート配下(.cbz)が除外されること
    expect(snapshot.excludedReadme).toBeNull();
    expect(snapshot.excludedOutside).toBeNull();
    expect(snapshot.excludedUnregisteredRoot).toBeNull();

    // 3シリーズへ正規化名寄せ・ソートされること
    expect(snapshot.volumesBySeries).toHaveLength(3);

    const akira = snapshot.volumesBySeries.find((s) => s.title === "AKIRA");
    expect(akira).toBeDefined();
    expect(akira?.authors).toEqual(["大友克洋"]);
    expect(akira?.volumes).toEqual([
      {
        driveFileId: "mock-file-akira-vol1",
        volumeNumber: 1,
        volumeLabel: "第01巻",
        rootFolderId: "mock-folder-comics",
        isTrashed: 0,
      },
      {
        driveFileId: "mock-file-omnibus",
        volumeNumber: 1,
        volumeLabel: "第01-03巻 合本",
        rootFolderId: "mock-folder-comics",
        isTrashed: 0,
      },
    ]);

    const onePiece = snapshot.volumesBySeries.find(
      (s) => s.title === "ONE PIECE",
    );
    expect(onePiece).toBeDefined();
    expect(onePiece?.authors).toEqual(["尾田栄一郎"]);
    expect(onePiece?.volumes.map((v) => v.volumeLabel)).toEqual([
      "第01巻",
      "第02巻",
    ]);

    const maison = snapshot.volumesBySeries.find(
      (s) => s.title === "めぞん一刻",
    );
    expect(maison).toBeDefined();
    expect(maison?.authors).toEqual(["高橋留美子"]);
    expect(maison?.volumes.map((v) => v.driveFileId)).toEqual([
      "mock-file-parent-fallback",
      "mock-file-maison-vol2",
    ]);
    expect(maison?.volumes.map((v) => v.volumeLabel)).toEqual([
      "第01巻",
      "第02巻",
    ]);

    expect(snapshot.syncMeta.startPageToken).not.toBeNull();
    expect(snapshot.syncMeta.lastDriveSyncAt).toBeGreaterThan(0);
    expect(snapshot.syncMeta.syncedRootFolderIds).toEqual([
      "mock-folder-comics",
    ]);

    expect(pageErrors).toEqual([]);
  });

  test("(2) 2回目同期のchanges.list増分差分(新規追加・リネーム追従・ゴミ箱/ルート外移動・MD5変化キャッシュ破棄・updatedAt非汚染)および410 TOKEN_EXPIRED自動フルスキャン復帰", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await signInAndRegisterRoots(page, ["mock-folder-comics"]);

    // 1回目: フルスキャン実行 + 事前スナップショット取得
    const beforeIncremental = await page.evaluate(async () => {
      const services = window.__exLibrisServices!;
      const initialResult = await services.driveSyncEngine!.sync();
      const vol1 =
        await services.volumesRepo!.getByDriveFileId("mock-file-vol1");
      const vol2 =
        await services.volumesRepo!.getByDriveFileId("mock-file-vol2");
      const series = vol1
        ? await services.seriesRepo!.getById(vol1.seriesId)
        : null;
      return {
        initialResult,
        vol1Id: vol1?.id ?? "",
        vol1UpdatedAt: vol1?.updatedAt ?? -1,
        vol2UpdatedAt: vol2?.updatedAt ?? -1,
        seriesId: series?.id ?? "",
        seriesUpdatedAt: series?.updatedAt ?? -1,
      };
    });

    expect(beforeIncremental.initialResult.mode).toBe("full");
    expect(beforeIncremental.vol1Id).not.toBe("");

    // MD5 変化検証用: 旧 zipIndexCache および既存表紙(ready)を実 IndexedDB へ仕込む
    const oldCacheKey = "gdrive:mock-file-vol1:md5-op-01";
    await seedZipIndexCacheRecord(page, oldCacheKey);
    await seedVolumeCoverReady(
      page,
      beforeIncremental.vol1Id,
      1_700_000_000_123,
    );
    expect(await readZipIndexCacheRecord(page, oldCacheKey)).not.toBeNull();

    // 変更イベントを投入し、2回目同期(changes.list 増分同期)を実行
    const incrementalSnapshot = await page.evaluate(async () => {
      const services = window.__exLibrisServices!;
      const client = services.mockDriveSyncClient!;

      // 1) 新規巻追加
      client.upsertItem({
        id: "mock-file-vol3",
        name: "[尾田栄一郎] ONE PIECE 第03巻.cbz",
        mimeType: "application/octet-stream",
        parents: ["mock-folder-action"],
        size: 14_111_222,
        md5Checksum: "md5-op-03",
        modifiedTime: Date.parse("2026-11-25T10:00:00.000Z"),
        trashed: false,
      });

      // 2) 未手動編集時のリネーム追従
      client.upsertItem({
        id: "mock-file-vol2",
        name: "[尾田栄一郎] ONE PIECE 第02巻 特装版.zip",
        mimeType: "application/zip",
        parents: ["mock-folder-action"],
        size: 13_456_789,
        md5Checksum: "md5-op-02",
        modifiedTime: Date.parse("2026-11-25T10:01:00.000Z"),
        trashed: false,
      });

      // 3) ゴミ箱移動
      client.trashItem("mock-file-parent-fallback");

      // 4) ルート外フォルダへ移動
      client.upsertItem({
        id: "mock-file-omnibus",
        name: "[大友克洋] AKIRA 第01-03巻 合本.cbz",
        mimeType: "application/octet-stream",
        parents: ["mock-folder-other"],
        size: 45_000_000,
        md5Checksum: "md5-akira-0103",
        modifiedTime: Date.parse("2026-11-25T10:02:00.000Z"),
        trashed: false,
      });

      // 5) MD5 変化（ファイル上書き）
      client.upsertItem({
        id: "mock-file-vol1",
        name: "[尾田栄一郎] ONE PIECE 第01巻 (一般コミック).cbz",
        mimeType: "application/octet-stream",
        parents: ["mock-folder-action"],
        size: 12_999_999,
        md5Checksum: "md5-op-01-v2",
        modifiedTime: Date.parse("2026-11-25T10:03:00.000Z"),
        trashed: false,
      });

      const result = await services.driveSyncEngine!.sync();
      const vol1 =
        await services.volumesRepo!.getByDriveFileId("mock-file-vol1");
      const vol2 =
        await services.volumesRepo!.getByDriveFileId("mock-file-vol2");
      const vol3 =
        await services.volumesRepo!.getByDriveFileId("mock-file-vol3");
      const trashedFallback = await services.volumesRepo!.getByDriveFileId(
        "mock-file-parent-fallback",
      );
      const movedOutside =
        await services.volumesRepo!.getByDriveFileId("mock-file-omnibus");
      const series = vol1
        ? await services.seriesRepo!.getById(vol1.seriesId)
        : null;
      const syncMeta = await services.driveSyncMetaRepo!.getSyncState();

      return {
        result,
        vol1,
        vol2,
        vol3,
        trashedFallback,
        movedOutside,
        series,
        syncMeta,
      };
    });

    expect(incrementalSnapshot.result.mode).toBe("incremental");
    expect(incrementalSnapshot.result.upsertedVolumes).toBe(3);
    expect(incrementalSnapshot.result.trashedVolumes).toBe(2);
    expect(incrementalSnapshot.result.invalidatedZipCaches).toBe(1);

    // 新規巻追加
    expect(incrementalSnapshot.vol3).not.toBeNull();
    expect(incrementalSnapshot.vol3?.seriesId).toBe(beforeIncremental.seriesId);
    expect(incrementalSnapshot.vol3?.volumeNumber).toBe(3);
    expect(incrementalSnapshot.vol3?.volumeLabel).toBe("第03巻");

    // 未手動編集時のリネーム追従 & updatedAt 非汚染
    expect(incrementalSnapshot.vol2?.rawFileName).toBe(
      "[尾田栄一郎] ONE PIECE 第02巻 特装版.zip",
    );
    expect(incrementalSnapshot.vol2?.volumeLabel).toBe("第02巻 特装版");
    expect(incrementalSnapshot.vol2?.updatedAt).toBe(
      beforeIncremental.vol2UpdatedAt,
    );

    // ゴミ箱移動 / ルート外移動 -> isTrashed = 1
    expect(incrementalSnapshot.trashedFallback?.isTrashed).toBe(1);
    expect(incrementalSnapshot.movedOutside?.isTrashed).toBe(1);

    // MD5 変化 -> 旧 zipIndexCache 削除 & coverStatus = "pending" リセット & updatedAt 非汚染
    expect(await readZipIndexCacheRecord(page, oldCacheKey)).toBeNull();
    expect(incrementalSnapshot.vol1?.md5Checksum).toBe("md5-op-01-v2");
    expect(incrementalSnapshot.vol1?.coverStatus).toBe("pending");
    expect(incrementalSnapshot.vol1?.coverBlob).toBeNull();
    expect(incrementalSnapshot.vol1?.coverUpdatedAt).toBeNull();
    expect(incrementalSnapshot.vol1?.updatedAt).toBe(
      beforeIncremental.vol1UpdatedAt,
    );
    expect(incrementalSnapshot.series?.updatedAt).toBe(
      beforeIncremental.seriesUpdatedAt,
    );

    // 410 TOKEN_EXPIRED 発生時の自動フルスキャン復帰 + 次回増分同期再開
    const recoverySnapshot = await page.evaluate(async () => {
      const services = window.__exLibrisServices!;
      const client = services.mockDriveSyncClient!;
      const tokenBefore = (await services.driveSyncMetaRepo!.getSyncState())
        .startPageToken;

      client.expireAllIssuedTokens();
      // changeLog には載せずツリーへ追加し、フルスキャン復帰でのみ取り込まれることを証明
      client.upsertItem(
        {
          id: "mock-file-vol4",
          name: "[尾田栄一郎] ONE PIECE 第04巻.cbz",
          mimeType: "application/octet-stream",
          parents: ["mock-folder-action"],
          size: 15_000_000,
          md5Checksum: "md5-op-04",
          modifiedTime: Date.parse("2026-11-25T10:10:00.000Z"),
          trashed: false,
        },
        false,
      );

      const fallbackResult = await services.driveSyncEngine!.sync();
      const vol4 =
        await services.volumesRepo!.getByDriveFileId("mock-file-vol4");
      const tokenAfter = (await services.driveSyncMetaRepo!.getSyncState())
        .startPageToken;
      const followUpResult = await services.driveSyncEngine!.sync();

      return {
        tokenBefore,
        tokenAfter,
        fallbackResult,
        vol4,
        followUpResult,
      };
    });

    expect(recoverySnapshot.fallbackResult.mode).toBe("full");
    expect(recoverySnapshot.vol4).not.toBeNull();
    expect(recoverySnapshot.vol4?.volumeNumber).toBe(4);
    expect(recoverySnapshot.tokenAfter).not.toBeNull();
    expect(recoverySnapshot.tokenAfter).not.toBe(recoverySnapshot.tokenBefore);
    expect(recoverySnapshot.followUpResult.mode).toBe("incremental");

    expect(pageErrors).toEqual([]);
  });

  test("(3) SCR-04ルート一時無効化→再有効化で既存volumes/coverBlob非破壊＆listVisibleByEnabledRoots表示切替・リロード後IndexedDB永続化", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await signInAndRegisterRoots(page, [
      "mock-folder-comics",
      "mock-folder-manga",
    ]);

    const initialSync = await page.evaluate(async () => {
      const services = window.__exLibrisServices!;
      const result = await services.driveSyncEngine!.sync();
      const vol1 =
        await services.volumesRepo!.getByDriveFileId("mock-file-vol1");
      return {
        result,
        vol1Id: vol1?.id ?? "",
      };
    });
    expect(initialSync.result.mode).toBe("full");
    expect(initialSync.result.scannedRoots).toBe(2);
    expect(initialSync.vol1Id).not.toBe("");

    // Comics 配下巻へ表紙 Blob(ready) を設定
    const coverTimestamp = 1_700_000_123_456;
    await seedVolumeCoverReady(page, initialSync.vol1Id, coverTimestamp);

    // SCR-04 UI で Comics ルートを一時無効化 (enabled = 0)
    await page
      .getByRole("button", { name: "Comics の同期を無効にする" })
      .click();
    await expect(
      page.getByRole("button", { name: "Comics の同期を有効にする" }),
    ).toHaveAttribute("aria-pressed", "false");

    // 無効化中に増分同期を実行しても Comics 配下の volumes / coverBlob が破壊されず、有効ルートクエリから除外されること
    const whileDisabled = await page.evaluate(async () => {
      const services = window.__exLibrisServices!;
      const syncResult = await services.driveSyncEngine!.sync();
      const vol1 =
        await services.volumesRepo!.getByDriveFileId("mock-file-vol1");
      const visibleEnabledOnly =
        await services.volumesRepo!.listVisibleByEnabledRoots(
          new Set(["mock-folder-manga"]),
        );
      return {
        syncResult,
        vol1IsTrashed: vol1?.isTrashed ?? -1,
        vol1CoverStatus: vol1?.coverStatus ?? null,
        vol1CoverUpdatedAt: vol1?.coverUpdatedAt ?? null,
        vol1CoverSize: vol1?.coverBlob ? vol1.coverBlob.size : -1,
        visibleDriveFileIds: visibleEnabledOnly.map((v) => v.driveFileId),
      };
    });

    expect(whileDisabled.syncResult.mode).toBe("incremental");
    expect(whileDisabled.vol1IsTrashed).toBe(0);
    expect(whileDisabled.vol1CoverStatus).toBe("ready");
    expect(whileDisabled.vol1CoverUpdatedAt).toBe(coverTimestamp);
    expect(whileDisabled.vol1CoverSize).toBe(4);
    expect(whileDisabled.visibleDriveFileIds).toEqual(["mock-file-manga-1"]);

    // SCR-04 UI で Comics ルートを再有効化 (enabled = 1)
    await page
      .getByRole("button", { name: "Comics の同期を有効にする" })
      .click();
    await expect(
      page.getByRole("button", { name: "Comics の同期を無効にする" }),
    ).toHaveAttribute("aria-pressed", "true");

    const afterReEnable = await page.evaluate(async () => {
      const services = window.__exLibrisServices!;
      const visibleBoth = await services.volumesRepo!.listVisibleByEnabledRoots(
        new Set(["mock-folder-comics", "mock-folder-manga"]),
      );
      const syncResult = await services.driveSyncEngine!.sync();
      const vol1 =
        await services.volumesRepo!.getByDriveFileId("mock-file-vol1");
      return {
        visibleDriveFileIds: visibleBoth.map((v) => v.driveFileId),
        syncResult,
        vol1CoverStatus: vol1?.coverStatus ?? null,
        vol1CoverSize: vol1?.coverBlob ? vol1.coverBlob.size : -1,
      };
    });

    expect(afterReEnable.visibleDriveFileIds).toContain("mock-file-vol1");
    expect(afterReEnable.visibleDriveFileIds).toContain("mock-file-manga-1");
    // 再有効化ルートは syncedRootFolderIds から外れていたためフルスキャンで安全に再同期されつつ既存表紙が維持される
    expect(afterReEnable.syncResult.mode).toBe("full");
    expect(afterReEnable.vol1CoverStatus).toBe("ready");
    expect(afterReEnable.vol1CoverSize).toBe(4);

    // ページリロード後も IndexedDB の series / volumes / syncMeta が永続化されていること
    await page.reload();
    await waitForServicesReady(page);
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("sync-root-item")).toHaveCount(2);

    const afterReload = await page.evaluate(async () => {
      const services = window.__exLibrisServices!;
      const seriesList = await services.seriesRepo!.listActive();
      const visible = await services.volumesRepo!.listVisibleByEnabledRoots(
        new Set(["mock-folder-comics", "mock-folder-manga"]),
      );
      const vol1 =
        await services.volumesRepo!.getByDriveFileId("mock-file-vol1");
      const syncMeta = await services.driveSyncMetaRepo!.getSyncState();
      return {
        seriesTitles: seriesList.map((s) => s.title),
        visibleDriveFileIds: visible.map((v) => v.driveFileId),
        vol1CoverStatus: vol1?.coverStatus ?? null,
        vol1CoverUpdatedAt: vol1?.coverUpdatedAt ?? null,
        vol1CoverSize: vol1?.coverBlob ? vol1.coverBlob.size : -1,
        syncMeta,
      };
    });

    expect(afterReload.seriesTitles).toEqual(
      expect.arrayContaining([
        "AKIRA",
        "ONE PIECE",
        "めぞん一刻",
        "ジョジョの奇妙な冒険",
      ]),
    );
    expect(afterReload.visibleDriveFileIds).toEqual(
      expect.arrayContaining([
        "mock-file-vol1",
        "mock-file-vol2",
        "mock-file-omnibus",
        "mock-file-parent-fallback",
        "mock-file-manga-1",
      ]),
    );
    expect(afterReload.vol1CoverStatus).toBe("ready");
    expect(afterReload.vol1CoverUpdatedAt).toBe(coverTimestamp);
    expect(afterReload.vol1CoverSize).toBe(4);
    expect(afterReload.syncMeta.startPageToken).not.toBeNull();
    expect(afterReload.syncMeta.lastDriveSyncAt).toBeGreaterThan(0);
    expect(afterReload.syncMeta.syncedRootFolderIds).toEqual([
      "mock-folder-comics",
      "mock-folder-manga",
    ]);

    expect(pageErrors).toEqual([]);
  });
});
