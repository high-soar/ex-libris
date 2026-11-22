import { expect, test } from "@playwright/test";
import type { MockAppBridge } from "../../src/bridges/app/mockAppBridge";
import {
  buildCorruptZipBytes,
  buildPartialCorruptArchive,
  buildSpreadCorruptArchive,
  buildSyntheticCp932Archive,
  buildSyntheticMixedSpreadArchive,
  buildSyntheticOversizedTextureArchive,
  buildSyntheticPortraitSpreadArchive,
  buildSyntheticSevenPageArchive,
  buildSyntheticThreePageArchive,
  buildSyntheticZip64Archive,
  readPngCenterPixel,
  readPngPixelAtRatio,
  readZipIndexCacheRecord,
  resetTestDatabase,
  trackPageErrors,
  waitForServicesReady,
} from "./helpers";

test.describe("SCN-02: ローカルZIP/CBZストリーミングリーダー結合シナリオ", () => {
  test("合成CBZ選択から実WebWorker解凍・WebGL2単ページ描画・右開き操作(タップ/スワイプ/キー/HUD)・Escape終了(TR-08)まで一貫して動作すること", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const archiveBytes = buildSyntheticThreePageArchive();
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "comic-vol01.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(archiveBytes),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(page.getByTestId("reader-hud-top")).toBeHidden();
    await expect(page.getByTestId("reader-hud-bottom")).toBeHidden();

    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    // ページ0は「第1話/001.png」(赤)が自然順ソート先頭かつ不要エントリ除外済みであることを描画色でも検証
    const page0Pixel = readPngCenterPixel(await canvas.screenshot());
    expect(page0Pixel.r).toBeGreaterThan(200);
    expect(page0Pixel.g).toBeLessThan(30);
    expect(page0Pixel.b).toBeLessThan(30);

    const surface = page.getByTestId("reader-interaction-surface");
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const surfaceBox = box!;

    // 中央40%タップでHUDを開く
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-top")).toBeVisible();
    await expect(page.getByTestId("reader-hud-bottom")).toBeVisible();
    await expect(page.getByTestId("reader-file-name")).toHaveText(
      "comic-vol01.cbz",
    );
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("1 / 3");
    await expect(page.getByTestId("reader-prev-button")).toBeDisabled();
    await expect(page.getByTestId("reader-next-button")).toBeEnabled();

    // 中央40%再タップでHUDを閉じる
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-top")).toBeHidden();
    await expect(page.getByTestId("reader-hud-bottom")).toBeHidden();

    // 右開き: 左30%タップで次ページ (0 -> 1: Store圧縮「第2話/002.png」緑)
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.15,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const page1Pixel = readPngCenterPixel(await canvas.screenshot());
    expect(page1Pixel.g).toBeGreaterThan(200);
    expect(page1Pixel.r).toBeLessThan(30);
    expect(page1Pixel.b).toBeLessThan(30);

    // ArrowLeftキーで次ページ (1 -> 2: Deflate圧縮「第10話/010.png」青)
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-rendered-page", "2");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const page2Pixel = readPngCenterPixel(await canvas.screenshot());
    expect(page2Pixel.b).toBeGreaterThan(200);
    expect(page2Pixel.r).toBeLessThan(30);
    expect(page2Pixel.g).toBeLessThan(30);

    // HUDを開いて最終ページ状態 ("3 / 3", ← 次へ disabled) を確認
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("3 / 3");
    await expect(page.getByTestId("reader-next-button")).toBeDisabled();
    await expect(page.getByTestId("reader-prev-button")).toBeEnabled();

    // HUD「前へ →」ボタンで戻る (2 -> 1)
    await page.getByTestId("reader-prev-button").click();
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("2 / 3");

    // HUDを閉じて左→右スワイプ (dx >= 40) で次ページ (1 -> 2)
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-top")).toBeHidden();

    const swipeY = surfaceBox.y + surfaceBox.height * 0.5;
    await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.35, swipeY);
    await page.mouse.down();
    await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.65, swipeY, {
      steps: 10,
    });
    await page.mouse.up();
    await expect(canvas).toHaveAttribute("data-rendered-page", "2");

    // 右→左スワイプ (dx <= -40 && |dx| > |dy|) で前ページ (2 -> 1)
    await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.65, swipeY);
    await page.mouse.down();
    await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.35, swipeY, {
      steps: 10,
    });
    await page.mouse.up();
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");

    // 右30%タップで前ページ (1 -> 0)、ArrowLeftで次ページ (0 -> 1)、ArrowRightで前ページ (1 -> 0)
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.85,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");

    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");

    await page.keyboard.press("ArrowRight");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");

    // HUDを開いて「← 次へ」ボタンで次ページ (0 -> 1)
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await page.getByTestId("reader-next-button").click();
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("2 / 3");

    // EscapeキーでTR-08終了し'/'へ復帰
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("合成.zipの選択とHUD「戻る」ボタンでTR-08終了し'/'へ復帰すること", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "comic-vol02.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(buildSyntheticThreePageArchive()),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    const box = await page
      .getByTestId("reader-interaction-surface")
      .boundingBox();
    expect(box).not.toBeNull();
    const surfaceBox = box!;
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-top")).toBeVisible();
    await expect(page.getByTestId("reader-file-name")).toHaveText(
      "comic-vol02.zip",
    );

    await page.getByTestId("reader-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("セッション不在で/read/localへ直接遷移・リロードした際はTR-10で即時'/'へフォールバックすること", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/read/local");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();
    await expect(page.getByTestId("reader-error-view")).toHaveCount(0);

    // 閲覧中にブラウザリロードした場合もオンメモリセッション喪失によりTR-10で'/'へ復帰する
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "reload-test.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticThreePageArchive()),
    });
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(page.getByTestId("reader-canvas")).toHaveAttribute(
      "data-rendered-page",
      "0",
    );

    await page.reload();
    await waitForServicesReady(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();
    await expect(page.getByTestId("reader-error-view")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("破損ZIP(broken.zip)でComlink境界越しにCORRUPT_ZIPエラー表示されホームへ戻れること (AC-RD-06)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "broken.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(buildCorruptZipBytes()),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const errorView = page.getByTestId("reader-error-view");
    await expect(errorView).toBeVisible();
    await expect(errorView).toContainText(
      "ZIP ファイルが破損しているため開けませんでした",
    );
    await expect(page.getByTestId("reader-error-code")).toContainText(
      "CORRUPT_ZIP",
    );

    await page.getByTestId("reader-error-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("Page 0のみ破損しPage 1が正常なZIPでページエラー表示後もArrowLeftで次ページ描画を継続できること (AC-RD-07)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "partial-corrupt.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(buildPartialCorruptArchive()),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const pageError = page.getByTestId("reader-page-error");
    await expect(pageError).toBeVisible();
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    await expect(pageError).toContainText("ページの画像デコードに失敗しました");
    await expect(page.getByTestId("reader-error-code")).toContainText(
      "DECODE_FAILED",
    );

    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("reader-canvas")).toHaveAttribute(
      "data-rendered-page",
      "1",
    );
    await expect(pageError).toHaveCount(0);
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    expect(pageErrors).toEqual([]);
  });

  test("Androidハードウェア戻るボタン(AppBridge)で'/'上ではminimizeApp、'/read/local'上ではTR-08終了が実行されること", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const minimizeCountOnHome = await page.evaluate(async () => {
      const bridge = window.__exLibrisServices?.appBridge as
        MockAppBridge | undefined;
      if (!bridge) {
        throw new Error("MockAppBridge is not available on window");
      }
      await bridge.triggerBackButton();
      return bridge.getMinimizeAppCallCount();
    });
    expect(minimizeCountOnHome).toBeGreaterThanOrEqual(1);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "back-button-test.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticThreePageArchive()),
    });
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(page.getByTestId("reader-canvas")).toHaveAttribute(
      "data-rendered-page",
      "0",
    );

    const minimizeCountAfterReaderBack = await page.evaluate(async () => {
      const bridge = window.__exLibrisServices?.appBridge as
        MockAppBridge | undefined;
      if (!bridge) {
        throw new Error("MockAppBridge is not available on window");
      }
      await bridge.triggerBackButton();
      return bridge.getMinimizeAppCallCount();
    });
    expect(minimizeCountAfterReaderBack).toBe(minimizeCountOnHome);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("閲覧中のブラウザ戻る(popstate)で'/'へ復帰し直後のgoForward()でもセッションクリア済みのためTR-10により'/'に留まること (R1-15)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "popstate-session.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticThreePageArchive()),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();
    await expect(page.getByTestId("reader-error-view")).toHaveCount(0);

    await page.goForward();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();
    await expect(page.getByTestId("reader-error-view")).toHaveCount(0);
    await expect(page.getByTestId("reader-page")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("EscapeおよびHUD戻るボタンによるTR-08終了後にwindow.history上へ'/'が重複蓄積されず戻れること (R1-15)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const initialHistoryLength = await page.evaluate(
      () => window.history.length,
    );

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "history-cycle-1.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticThreePageArchive()),
    });
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(page.getByTestId("reader-canvas")).toHaveAttribute(
      "data-rendered-page",
      "0",
    );

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();
    expect(await page.evaluate(() => window.history.length)).toBe(
      initialHistoryLength + 1,
    );

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "history-cycle-2.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(buildSyntheticThreePageArchive()),
    });
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(page.getByTestId("reader-canvas")).toHaveAttribute(
      "data-rendered-page",
      "0",
    );

    const box = await page
      .getByTestId("reader-interaction-surface")
      .boundingBox();
    expect(box).not.toBeNull();
    const surfaceBox = box!;
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-top")).toBeVisible();
    await page.getByTestId("reader-back-button").click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();
    expect(await page.evaluate(() => window.history.length)).toBe(
      initialHistoryLength + 1,
    );
    expect(await page.evaluate(() => window.history.state)).toBeNull();

    await page.goBack();
    await expect(page).toHaveURL("about:blank");

    expect(pageErrors).toEqual([]);
  });

  test("ZIP64構造(Locator+EOCD64+0x0001)合成アーカイブを実WebWorkerで解析しWebGL2単ページ描画できること (AC-ENG-09)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const zip64Bytes = buildSyntheticZip64Archive();
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "zip64-vol01.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(zip64Bytes),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    // Page 0: "001.png" (赤)
    const page0Pixel = readPngCenterPixel(await canvas.screenshot());
    expect(page0Pixel.r).toBeGreaterThan(200);
    expect(page0Pixel.g).toBeLessThan(30);
    expect(page0Pixel.b).toBeLessThan(30);

    // Page 1: Deflate "002.png" (緑)
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const page1Pixel = readPngCenterPixel(await canvas.screenshot());
    expect(page1Pixel.g).toBeGreaterThan(200);
    expect(page1Pixel.r).toBeLessThan(30);
    expect(page1Pixel.b).toBeLessThan(30);

    // Page 2: Store "010.png" (青)
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-rendered-page", "2");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const page2Pixel = readPngCenterPixel(await canvas.screenshot());
    expect(page2Pixel.b).toBeGreaterThan(200);
    expect(page2Pixel.r).toBeLessThan(30);
    expect(page2Pixel.g).toBeLessThan(30);

    expect(pageErrors).toEqual([]);
  });

  test("CP932(Shift_JIS・Bit11未設定)日本語ファイル名アーカイブを文字化けなくセグメント自然順で描画できること (AC-ENG-03, AC-ENG-10)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const cp932Bytes = buildSyntheticCp932Archive();
    const expectedCacheKey = `local:cp932-comic.zip:${cp932Bytes.byteLength}`;
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "cp932-comic.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(cp932Bytes),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    // IndexedDB上の目次キャッシュに復元済みのCP932エントリ名が自然順で保存されていることも確認
    await expect
      .poll(async () => {
        const record = await readZipIndexCacheRecord(page, expectedCacheKey);
        return record?.entryNames ?? null;
      })
      .toEqual([
        "第1話/001.png",
        "第1話/①特典.png",
        "第2話/002.png",
        "第10話/010.png",
      ]);

    // Page 0: "第1話/001.png" (赤)
    const p0 = readPngCenterPixel(await canvas.screenshot());
    expect(p0.r).toBeGreaterThan(200);
    expect(p0.g).toBeLessThan(30);
    expect(p0.b).toBeLessThan(30);

    // Page 1: "第1話/①特典.png" (黄)
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const p1 = readPngCenterPixel(await canvas.screenshot());
    expect(p1.r).toBeGreaterThan(200);
    expect(p1.g).toBeGreaterThan(200);
    expect(p1.b).toBeLessThan(30);

    // Page 2: "第2話/002.png" (緑)
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-rendered-page", "2");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const p2 = readPngCenterPixel(await canvas.screenshot());
    expect(p2.g).toBeGreaterThan(200);
    expect(p2.r).toBeLessThan(30);
    expect(p2.b).toBeLessThan(30);

    // Page 3: "第10話/010.png" (青)
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-rendered-page", "3");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const p3 = readPngCenterPixel(await canvas.screenshot());
    expect(p3.b).toBeGreaterThan(200);
    expect(p3.r).toBeLessThan(30);
    expect(p3.g).toBeLessThan(30);

    expect(pageErrors).toEqual([]);
  });

  test("同一ローカルアーカイブ再オープン時にIndexedDB zipIndexCache経由で0RTTオープンされリロード後も永続化されること (AC-ENG-11)", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const archiveBytes = buildSyntheticThreePageArchive();
    const cacheKey = `local:cache-0rtt.cbz:${archiveBytes.byteLength}`;

    // 1回目: キャッシュミス -> Central Directory 解析 & IndexedDB 永続化
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "cache-0rtt.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(archiveBytes),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    let firstCachedAt = 0;
    await expect
      .poll(async () => {
        const record = await readZipIndexCacheRecord(page, cacheKey);
        if (record) {
          firstCachedAt = record.cachedAt;
        }
        return record?.pageCount ?? 0;
      })
      .toBe(3);
    expect(firstCachedAt).toBeGreaterThan(0);

    // ホームに戻り、初回オープンログ(fromIndexCache=false)を確認
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();

    await page.getByTestId("copy-diagnostics-button").click();
    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("fromIndexCache=false");

    // ブラウザリロード後も IndexedDB に zipIndexCache が永続化されていることを確認
    await page.reload();
    await waitForServicesReady(page);
    const persistedAfterReload = await readZipIndexCacheRecord(page, cacheKey);
    expect(persistedAfterReload).not.toBeNull();
    expect(persistedAfterReload?.pageCount).toBe(3);

    // cachedAt の単調増加を保証するため少なくとも1ms経過させてから再オープン
    await expect
      .poll(() => Date.now(), { timeout: 2_000 })
      .toBeGreaterThan(firstCachedAt);

    // 2回目: 同一アーカイブを再オープン -> 0RTT (fromIndexCache=true) & LRU cachedAt 更新
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "cache-0rtt.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(archiveBytes),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const reopenedPixel = readPngCenterPixel(await canvas.screenshot());
    expect(reopenedPixel.r).toBeGreaterThan(200);
    expect(reopenedPixel.g).toBeLessThan(30);
    expect(reopenedPixel.b).toBeLessThan(30);

    await expect
      .poll(async () => {
        const record = await readZipIndexCacheRecord(page, cacheKey);
        return record?.cachedAt ?? 0;
      })
      .toBeGreaterThan(firstCachedAt);

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await page.getByTestId("copy-diagnostics-button").click();
    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("目次キャッシュからアーカイブを開きました (0RTT)");
    const secondReport = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(secondReport).toContain(
      `${cacheKey} (pages=3, fromIndexCache=true)`,
    );

    expect(pageErrors).toEqual([]);
  });

  test("7ページ超アーカイブでL1(5P)退避後の往復表示が実WorkerのL2ByteCacheからHO-03非破壊で再デコード描画されること (AC-ENG-12, AC-ENG-13, AC-ENG-14)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const sevenPageBytes = buildSyntheticSevenPageArchive();
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "seven-pages-l2-roundtrip.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(sevenPageBytes),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    // 初回 Page 0 (赤) を確認
    const initialP0 = readPngCenterPixel(await canvas.screenshot());
    expect(initialP0.r).toBeGreaterThan(200);
    expect(initialP0.g).toBeLessThan(30);
    expect(initialP0.b).toBeLessThan(30);

    // 0 -> 6 まで順送りし、L1_MAX_PAGES=5 から Page 0・Page 1 を確実に退避させる
    for (let nextPage = 1; nextPage <= 6; nextPage += 1) {
      await page.keyboard.press("ArrowLeft");
      await expect(canvas).toHaveAttribute(
        "data-rendered-page",
        String(nextPage),
      );
      await expect(page.getByTestId("reader-loading")).toBeHidden();
    }

    // Page 6 (白) を確認
    const p6 = readPngCenterPixel(await canvas.screenshot());
    expect(p6.r).toBeGreaterThan(200);
    expect(p6.g).toBeGreaterThan(200);
    expect(p6.b).toBeGreaterThan(200);

    // 6 -> 0 まで逆戻りし、L1退避済み Page 1 (緑) / Page 0 (赤) が実WorkerのL2ByteCacheからデタッチ破壊なく再デコードされることを確認
    for (let prevPage = 5; prevPage >= 0; prevPage -= 1) {
      await page.keyboard.press("ArrowRight");
      await expect(canvas).toHaveAttribute(
        "data-rendered-page",
        String(prevPage),
      );
      await expect(page.getByTestId("reader-loading")).toBeHidden();

      if (prevPage === 1) {
        const returnedP1 = readPngCenterPixel(await canvas.screenshot());
        expect(returnedP1.g).toBeGreaterThan(200);
        expect(returnedP1.r).toBeLessThan(30);
        expect(returnedP1.b).toBeLessThan(30);
      }
      if (prevPage === 0) {
        const returnedP0 = readPngCenterPixel(await canvas.screenshot());
        expect(returnedP0.r).toBeGreaterThan(200);
        expect(returnedP0.g).toBeLessThan(30);
        expect(returnedP0.b).toBeLessThan(30);
      }
    }

    // 再往路でもう一度 Page 6 まで送り、2回目デコード後も L2 バッファが健全であることを追加検証
    for (let nextPage = 1; nextPage <= 6; nextPage += 1) {
      await page.keyboard.press("ArrowLeft");
      await expect(canvas).toHaveAttribute(
        "data-rendered-page",
        String(nextPage),
      );
    }
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const secondP6 = readPngCenterPixel(await canvas.screenshot());
    expect(secondP6.r).toBeGreaterThan(200);
    expect(secondP6.g).toBeGreaterThan(200);
    expect(secondP6.b).toBeGreaterThan(200);

    expect(pageErrors).toEqual([]);
  });

  test("高速連続めくり時にrequestEpoch世代キャンセルが追従し最終ページの描画と診断健全性を保つこと (AC-ENG-07, AC-RD-05)", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const sevenPageBytes = buildSyntheticSevenPageArchive();
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "rapid-epoch-cancel.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(sevenPageBytes),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    // 待機なしで4連続順送り (0 -> 4: シアン)
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");

    await expect(canvas).toHaveAttribute("data-rendered-page", "4");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const p4 = readPngCenterPixel(await canvas.screenshot());
    expect(p4.r).toBeLessThan(30);
    expect(p4.g).toBeGreaterThan(200);
    expect(p4.b).toBeGreaterThan(200);

    // 待機なしで4連続逆戻り (4 -> 0: 赤)
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");

    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const p0 = readPngCenterPixel(await canvas.screenshot());
    expect(p0.r).toBeGreaterThan(200);
    expect(p0.g).toBeLessThan(30);
    expect(p0.b).toBeLessThan(30);

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await page.getByTestId("copy-diagnostics-button").click();
    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("# ExLibris Diagnostic Report");
    const report = await page.evaluate(() => navigator.clipboard.readText());
    expect(report).not.toContain("[ERROR]");

    expect(pageErrors).toEqual([]);
  });

  test("1280x800でインテリジェント見開き・横長単独化・自動再ペアリング・最終頁no-op・spreadHistory逆戻りが一貫動作すること (AC-RD-10, AC-GL-08)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "mixed-spread.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticMixedSpreadArchive()),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:0");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(canvas).toHaveAttribute("data-rendered-pages", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    const p0Pixel = readPngCenterPixel(await canvas.screenshot());
    expect(p0Pixel.r).toBeGreaterThan(200);
    expect(p0Pixel.g).toBeLessThan(30);
    expect(p0Pixel.b).toBeLessThan(30);

    const surface = page.getByTestId("reader-interaction-surface");
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const surfaceBox = box!;

    // 表紙0P状態でHUD確認: 自動(見開き), 1 / 6
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-bottom")).toBeVisible();
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("1 / 6");
    await expect(page.getByTestId("reader-spread-mode-button")).toHaveText(
      "自動(見開き)",
    );
    await expect(page.getByTestId("reader-prev-button")).toBeDisabled();
    await expect(page.getByTestId("reader-next-button")).toBeEnabled();
    await expect(
      page.getByTestId("reader-offset-toggle-button"),
    ).toHaveAttribute("aria-pressed", "false");

    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-bottom")).toBeHidden();

    // 次頁 -> [1, 2] 縦見開き (left:2 青, right:1 緑)
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:2,right:1",
    );
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");
    await expect(canvas).toHaveAttribute("data-rendered-pages", "1,2");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    const spread12Shot = await canvas.screenshot();
    const left12Pixel = readPngPixelAtRatio(spread12Shot, 0.35, 0.5);
    const right12Pixel = readPngPixelAtRatio(spread12Shot, 0.65, 0.5);
    expect(left12Pixel.b).toBeGreaterThan(200);
    expect(left12Pixel.r).toBeLessThan(30);
    expect(left12Pixel.g).toBeLessThan(30);
    expect(right12Pixel.g).toBeGreaterThan(200);
    expect(right12Pixel.r).toBeLessThan(30);
    expect(right12Pixel.b).toBeLessThan(30);

    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "2-3 / 6",
    );

    // 次頁 -> 横長画像 3P 単独中央表示 (center:3 黄, 4 / 6)
    await page.getByTestId("reader-next-button").click();
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:3");
    await expect(canvas).toHaveAttribute("data-rendered-page", "3");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("4 / 6");

    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-bottom")).toBeHidden();
    const p3Pixel = readPngCenterPixel(await canvas.screenshot());
    expect(p3Pixel.r).toBeGreaterThan(200);
    expect(p3Pixel.g).toBeGreaterThan(200);
    expect(p3Pixel.b).toBeLessThan(30);

    // 次頁 -> [4, 5] 自動再ペアリング (left:5 マゼンタ, right:4 シアン, 5-6 / 6)
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:5,right:4",
    );
    await expect(canvas).toHaveAttribute("data-rendered-page", "4");
    await expect(canvas).toHaveAttribute("data-rendered-pages", "4,5");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    const spread45Shot = await canvas.screenshot();
    const left45Pixel = readPngPixelAtRatio(spread45Shot, 0.35, 0.5);
    const right45Pixel = readPngPixelAtRatio(spread45Shot, 0.65, 0.5);
    expect(left45Pixel.r).toBeGreaterThan(200);
    expect(left45Pixel.g).toBeLessThan(30);
    expect(left45Pixel.b).toBeGreaterThan(200);
    expect(right45Pixel.r).toBeLessThan(30);
    expect(right45Pixel.g).toBeGreaterThan(200);
    expect(right45Pixel.b).toBeGreaterThan(200);

    // 最終見開き表示中の全次頁操作 (HUD 次へ disabled / ArrowLeft / 左30%タップ) が完全 no-op
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "5-6 / 6",
    );
    await expect(page.getByTestId("reader-next-button")).toBeDisabled();

    const endEpoch = await canvas.getAttribute("data-rendered-epoch");
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:5,right:4",
    );
    await expect(canvas).toHaveAttribute("data-rendered-epoch", endEpoch ?? "");
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "5-6 / 6",
    );

    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-bottom")).toBeHidden();

    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.15,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:5,right:4",
    );
    await expect(canvas).toHaveAttribute("data-rendered-epoch", endEpoch ?? "");

    // spreadHistory 通りに前へ逆戻り: [4,5] -> 3 -> [1,2] -> 0
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-bottom")).toBeVisible();

    await page.getByTestId("reader-prev-button").click();
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:3");
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("4 / 6");

    await page.getByTestId("reader-prev-button").click();
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:2,right:1",
    );
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "2-3 / 6",
    );

    await page.getByTestId("reader-prev-button").click();
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:0");
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("1 / 6");
    await expect(page.getByTestId("reader-prev-button")).toBeDisabled();

    expect(pageErrors).toEqual([]);
  });

  test("1280x800で1ページずらし(spreadPageOffset)および右開き(rtl)↔左開き(ltr)切替時の全入力/HUD反転・L1即時再配置が動作すること (AC-RD-03, AC-RD-04, AC-RD-10, AC-RD-11)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "offset-and-direction.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticPortraitSpreadArchive()),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    const surface = page.getByTestId("reader-interaction-surface");
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const surfaceBox = box!;

    // HUD を開き、0P での 1ページずらし [0] ↔ [0, 1] を検証
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    const offsetButton = page.getByTestId("reader-offset-toggle-button");
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("1 / 6");
    await expect(offsetButton).toBeEnabled();
    await expect(offsetButton).toHaveAttribute("aria-pressed", "false");

    await offsetButton.click();
    await expect(offsetButton).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:1,right:0",
    );
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "1-2 / 6",
    );

    await offsetButton.click();
    await expect(offsetButton).toHaveAttribute("aria-pressed", "false");
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:0");
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("1 / 6");

    // [1, 2] へ進み、中間頁での 1ページずらし (2-3 / 6 -> 3-4 / 6 -> 2-3 / 6) を検証
    await page.getByTestId("reader-next-button").click();
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:2,right:1",
    );
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "2-3 / 6",
    );

    await offsetButton.click();
    await expect(offsetButton).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:3,right:2",
    );
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "3-4 / 6",
    );

    await offsetButton.click();
    await expect(offsetButton).toHaveAttribute("aria-pressed", "false");
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:2,right:1",
    );
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "2-3 / 6",
    );

    // rtl 時の HUD 配置順・ボタン表記と左右 RGB ピクセルを確認
    const navRowChildren = page
      .getByTestId("reader-hud-nav-row")
      .locator("> *");
    await expect(navRowChildren.nth(0)).toHaveAttribute(
      "data-testid",
      "reader-next-button",
    );
    await expect(navRowChildren.nth(1)).toHaveAttribute(
      "data-testid",
      "reader-page-indicator",
    );
    await expect(navRowChildren.nth(2)).toHaveAttribute(
      "data-testid",
      "reader-prev-button",
    );
    await expect(page.getByTestId("reader-next-button")).toHaveText("← 次へ");
    await expect(page.getByTestId("reader-prev-button")).toHaveText("前へ →");

    const directionButton = page.getByTestId("reader-direction-button");
    await expect(directionButton).toHaveText("右開き");
    await expect(directionButton).toHaveAttribute(
      "data-reading-direction",
      "rtl",
    );

    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-bottom")).toBeHidden();
    const rtlShot = await canvas.screenshot();
    expect(readPngPixelAtRatio(rtlShot, 0.35, 0.5).b).toBeGreaterThan(200);
    expect(readPngPixelAtRatio(rtlShot, 0.65, 0.5).g).toBeGreaterThan(200);

    // HUD を開いて 右開き -> 左開き へ切替: HUD 反転 + L1 キャッシュ即時再配置 (同一 epoch)
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-bottom")).toBeVisible();
    const epochBeforeToggle = await canvas.getAttribute("data-rendered-epoch");

    await directionButton.click();
    await expect(directionButton).toHaveText("左開き");
    await expect(directionButton).toHaveAttribute(
      "data-reading-direction",
      "ltr",
    );
    await expect(navRowChildren.nth(0)).toHaveAttribute(
      "data-testid",
      "reader-prev-button",
    );
    await expect(navRowChildren.nth(1)).toHaveAttribute(
      "data-testid",
      "reader-page-indicator",
    );
    await expect(navRowChildren.nth(2)).toHaveAttribute(
      "data-testid",
      "reader-next-button",
    );
    await expect(page.getByTestId("reader-prev-button")).toHaveText("← 前へ");
    await expect(page.getByTestId("reader-next-button")).toHaveText("次へ →");
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:1,right:2",
    );
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");
    await expect(canvas).toHaveAttribute("data-rendered-pages", "1,2");
    await expect(canvas).toHaveAttribute(
      "data-rendered-epoch",
      epochBeforeToggle ?? "",
    );

    // HUD を閉じて左開きでの左右 RGB 反転を確認
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-bottom")).toBeHidden();
    const ltrShot = await canvas.screenshot();
    const ltrLeftPixel = readPngPixelAtRatio(ltrShot, 0.35, 0.5);
    const ltrRightPixel = readPngPixelAtRatio(ltrShot, 0.65, 0.5);
    expect(ltrLeftPixel.g).toBeGreaterThan(200);
    expect(ltrLeftPixel.b).toBeLessThan(30);
    expect(ltrRightPixel.b).toBeGreaterThan(200);
    expect(ltrRightPixel.g).toBeLessThan(30);

    // ltr 状態での全入力反転: ArrowRight / 右30%タップ / 右->左スワイプ で「次へ」、逆で「前へ」
    await page.keyboard.press("ArrowRight");
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:3,right:4",
    );
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:1,right:2",
    );

    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.85,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:3,right:4",
    );
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.15,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:1,right:2",
    );

    const swipeY = surfaceBox.y + surfaceBox.height * 0.5;
    await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.65, swipeY);
    await page.mouse.down();
    await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.35, swipeY, {
      steps: 10,
    });
    await page.mouse.up();
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:3,right:4",
    );

    await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.35, swipeY);
    await page.mouse.down();
    await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.65, swipeY, {
      steps: 10,
    });
    await page.mouse.up();
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:1,right:2",
    );

    expect(pageErrors).toEqual([]);
  });

  test("375x667縦向きでauto単ページ追従・モード循環・リロードなし動的リサイズ切替が動作すること (AC-RD-10, AC-RD-11)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "portrait-auto-resize.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticPortraitSpreadArchive()),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    // 縦向き auto は次頁も単ページ追従
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:1");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    const surface = page.getByTestId("reader-interaction-surface");
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const surfaceBox = box!;

    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-bottom")).toBeVisible();

    const spreadModeButton = page.getByTestId("reader-spread-mode-button");
    const offsetButton = page.getByTestId("reader-offset-toggle-button");
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("2 / 6");
    await expect(spreadModeButton).toHaveText("自動(単頁)");
    await expect(spreadModeButton).toHaveAttribute("data-spread-mode", "auto");
    await expect(spreadModeButton).toHaveAttribute(
      "data-effective-spread-mode",
      "single",
    );
    await expect(offsetButton).toBeDisabled();

    // 表示モード循環: 自動(単頁) -> 見開き -> 単ページ -> 自動(単頁)
    await spreadModeButton.click();
    await expect(spreadModeButton).toHaveText("見開き");
    await expect(spreadModeButton).toHaveAttribute(
      "data-spread-mode",
      "spread",
    );
    await expect(spreadModeButton).toHaveAttribute(
      "data-effective-spread-mode",
      "spread",
    );
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:2,right:1",
    );
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "2-3 / 6",
    );
    await expect(offsetButton).toBeEnabled();

    await spreadModeButton.click();
    await expect(spreadModeButton).toHaveText("単ページ");
    await expect(spreadModeButton).toHaveAttribute(
      "data-spread-mode",
      "single",
    );
    await expect(spreadModeButton).toHaveAttribute(
      "data-effective-spread-mode",
      "single",
    );
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:1");
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("2 / 6");
    await expect(offsetButton).toBeDisabled();

    await spreadModeButton.click();
    await expect(spreadModeButton).toHaveText("自動(単頁)");
    await expect(spreadModeButton).toHaveAttribute("data-spread-mode", "auto");
    await expect(spreadModeButton).toHaveAttribute(
      "data-effective-spread-mode",
      "single",
    );
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:1");
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("2 / 6");
    await expect(offsetButton).toBeDisabled();

    // リロードなし動的リサイズ: 375x667 -> 1280x800 -> 375x667
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(spreadModeButton).toHaveText("自動(見開き)");
    await expect(spreadModeButton).toHaveAttribute(
      "data-effective-spread-mode",
      "spread",
    );
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:2,right:1",
    );
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "2-3 / 6",
    );
    await expect(offsetButton).toBeEnabled();

    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(spreadModeButton).toHaveText("自動(単頁)");
    await expect(spreadModeButton).toHaveAttribute(
      "data-effective-spread-mode",
      "single",
    );
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:1");
    await expect(page.getByTestId("reader-page-indicator")).toHaveText("2 / 6");
    await expect(offsetButton).toBeDisabled();

    expect(pageErrors).toEqual([]);
  });

  test("実SwiftShader gl.MAX_TEXTURE_SIZE超合成PNGのタイル分割描画(非黒)と診断WARN記録が動作すること (AC-GL-07)", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const maxTex = await page.evaluate(() => {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl2");
      if (!gl) {
        throw new Error("WebGL2 context is not available");
      }
      return gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    });
    expect(maxTex).toBeGreaterThan(0);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "oversized-texture-split.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticOversizedTextureArchive(maxTex)),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    // Page 1 (横幅 maxTex + 128, 高さ 64, 左半分赤・右半分青) へ移動しタイル分割完了を待機
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:1");
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    const splitShot = await canvas.screenshot();
    const leftPixel = readPngPixelAtRatio(splitShot, 0.35, 0.5);
    const rightPixel = readPngPixelAtRatio(splitShot, 0.65, 0.5);
    const tile1CenterRatio = (maxTex + 64) / (maxTex + 128);
    const tile1Pixel = readPngPixelAtRatio(splitShot, tile1CenterRatio, 0.5);

    expect(leftPixel.r).toBeGreaterThan(200);
    expect(leftPixel.g).toBeLessThan(30);
    expect(leftPixel.b).toBeLessThan(30);

    expect(rightPixel.b).toBeGreaterThan(200);
    expect(rightPixel.r).toBeLessThan(30);
    expect(rightPixel.g).toBeLessThan(30);

    expect(tile1Pixel.b).toBeGreaterThan(200);
    expect(tile1Pixel.r).toBeLessThan(30);
    expect(tile1Pixel.g).toBeLessThan(30);

    // '/' 復帰後に診断ログをコピーし、[WARN] [webgl2] MAX_TEXTURE_SIZE が記録され [ERROR] が無いことを確認
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await page.getByTestId("copy-diagnostics-button").click();
    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("# ExLibris Diagnostic Report");
    const report = await page.evaluate(() => navigator.clipboard.readText());
    expect(report).toContain("[WARN]");
    expect(report).toContain("[webgl2]");
    expect(report).toContain("MAX_TEXTURE_SIZE");
    expect(report).not.toContain("[ERROR]");

    expect(pageErrors).toEqual([]);
  });

  test("見開き片側デコードエラー時に正常側半面WebGL2描画が継続し、両側エラー時は中央代表エラー表示へ切り替わること (AC-GL-08, AC-RD-12)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    // 1) 片側破損 (Page 1 破損 / Page 2 正常青): 左半分正常描画 + 右側エラーカード
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "half-corrupt-spread.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSpreadCorruptArchive([1])),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-rendered-slots", "left:2");
    await expect(canvas).toHaveAttribute("data-rendered-page", "2");
    await expect(canvas).toHaveAttribute("data-rendered-pages", "2");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    const halfShot = await canvas.screenshot();
    const validLeftPixel = readPngPixelAtRatio(halfShot, 0.35, 0.5);
    expect(validLeftPixel.b).toBeGreaterThan(200);
    expect(validLeftPixel.r).toBeLessThan(30);
    expect(validLeftPixel.g).toBeLessThan(30);

    const pageError = page.getByTestId("reader-page-error");
    await expect(pageError).toHaveCount(1);
    await expect(pageError).toHaveAttribute("data-slot-position", "right");
    await expect(pageError).toContainText("ページ読込エラー (p.2)");
    await expect(page.getByTestId("reader-error-code")).toContainText(
      "DECODE_FAILED",
    );

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();

    // 2) 両側破損 (Page 1・Page 2 とも破損): 描画クリア + 中央代表エラー1件 (ページ番号なし)
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "both-corrupt-spread.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSpreadCorruptArchive([1, 2])),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    await page.keyboard.press("ArrowLeft");
    await expect(pageError).toHaveCount(1);
    await expect(pageError).toBeVisible();
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    await expect(canvas).toHaveAttribute("data-rendered-page", "");
    await expect(canvas).toHaveAttribute("data-rendered-pages", "");
    await expect(canvas).toHaveAttribute("data-rendered-slots", "");
    await expect(pageError).toHaveAttribute("data-slot-position", "center");
    await expect(pageError).toContainText("ページ読込エラー");
    await expect(pageError).not.toContainText("(p.");
    await expect(page.getByTestId("reader-error-code")).toContainText(
      "DECODE_FAILED",
    );

    // エラー状態からも前ページへ復帰可能であることを確認
    await page.keyboard.press("ArrowRight");
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:0");
    await expect(pageError).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });
});
