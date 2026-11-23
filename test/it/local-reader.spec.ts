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
  buildSyntheticShaderTestArchive,
  buildSyntheticThreePageArchive,
  buildSyntheticZip64Archive,
  deleteReadingProgressRecord,
  readPngCenterPixel,
  readPngHorizontalContrastRange,
  readPngPixelAtRatio,
  readReadingProgressRecord,
  readSyncMetaValue,
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
    await page.setViewportSize({ width: 375, height: 667 });
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
    await page.setViewportSize({ width: 375, height: 667 });
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
    await page.setViewportSize({ width: 375, height: 667 });
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
    await page.setViewportSize({ width: 375, height: 667 });
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
    await page.setViewportSize({ width: 375, height: 667 });
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
    await page.setViewportSize({ width: 375, height: 667 });
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
    await page.setViewportSize({ width: 375, height: 667 });
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

  test("同一ローカルアーカイブ再オープン時にIndexedDB zipIndexCache経由で0RTTオープンされリロード後も永続化されること (AC-ENG-11, NFR-01)", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const archiveBytes = buildSyntheticThreePageArchive();
    const cacheKey = `local:cache-0rtt.cbz:${archiveBytes.byteLength}`;

    // 1回目: キャッシュミス -> Central Directory 解析 & IndexedDB 永続化 (TTFP計測)
    const firstOpenStartMs = performance.now();
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "cache-0rtt.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(archiveBytes),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const firstTtfpMs = performance.now() - firstOpenStartMs;
    expect(firstTtfpMs).toBeGreaterThanOrEqual(0);
    expect(firstTtfpMs).toBeLessThan(5_000);

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

    // ホームに戻り、初回オープンログ(fromIndexCache=false + タイムスタンプ)を確認
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();

    await page.getByTestId("copy-diagnostics-button").click();
    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("fromIndexCache=false");
    const firstReport = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(firstReport).toMatch(
      /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[reader\] Central Directory解析でアーカイブを開きました \| local:cache-0rtt\.cbz:\d+ \(pages=3, fromIndexCache=false\)/,
    );

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

    // 2回目: 同一アーカイブを再オープン -> 0RTT (fromIndexCache=true) & TTFP計測 & LRU cachedAt 更新
    const secondOpenStartMs = performance.now();
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "cache-0rtt.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(archiveBytes),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    const secondTtfpMs = performance.now() - secondOpenStartMs;
    expect(secondTtfpMs).toBeGreaterThanOrEqual(0);
    expect(secondTtfpMs).toBeLessThan(5_000);
    test.info().annotations.push({
      type: "ttfp-ms",
      description: `first=${firstTtfpMs.toFixed(1)}ms, second(0RTT)=${secondTtfpMs.toFixed(1)}ms`,
    });
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
    expect(secondReport).toMatch(
      /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[reader\] 目次キャッシュからアーカイブを開きました \(0RTT\) \| local:cache-0rtt\.cbz:\d+ \(pages=3, fromIndexCache=true\)/,
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

  test("生WebGL2 1パス画質補正シェーダーの実ピクセルRGB変化・リセット・syncMetaデフォルト保存永続化が動作すること (AC-GL-09, AC-RD-13)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "shader-lab.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticShaderTestArchive()),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(canvas).toHaveAttribute(
      "data-shader-params",
      "0.00,1.00,0.00,1.00",
    );
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    // 初期状態 4 象限ピクセル検証 (1280x800 中 800x800 中央配置: xRatio 0.1875..0.8125)
    const initialShot = await canvas.screenshot();
    const initYellow = readPngPixelAtRatio(initialShot, 0.34, 0.25);
    expect(initYellow.r).toBeGreaterThanOrEqual(230);
    expect(initYellow.r).toBeLessThanOrEqual(240);
    expect(initYellow.g).toBeGreaterThanOrEqual(223);
    expect(initYellow.g).toBeLessThanOrEqual(233);
    expect(initYellow.b).toBeGreaterThanOrEqual(207);
    expect(initYellow.b).toBeLessThanOrEqual(217);

    const initDark = readPngPixelAtRatio(initialShot, 0.66, 0.25);
    expect(initDark.r).toBeGreaterThanOrEqual(37);
    expect(initDark.r).toBeLessThanOrEqual(47);
    expect(initDark.g).toBeGreaterThanOrEqual(37);
    expect(initDark.g).toBeLessThanOrEqual(47);
    expect(initDark.b).toBeGreaterThanOrEqual(37);
    expect(initDark.b).toBeLessThanOrEqual(47);

    const initThin = readPngPixelAtRatio(initialShot, 0.34, 0.75);
    expect(initThin.g).toBeGreaterThanOrEqual(123);
    expect(initThin.g).toBeLessThanOrEqual(133);

    const baseEdge = readPngHorizontalContrastRange(
      initialShot,
      0.75,
      0.56,
      0.76,
    );
    expect(baseEdge.min).toBeGreaterThanOrEqual(75);
    expect(baseEdge.max).toBeLessThanOrEqual(185);

    const surface = page.getByTestId("reader-interaction-surface");
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const surfaceBox = box!;
    const tapCenter = async () => {
      await page.mouse.click(
        surfaceBox.x + surfaceBox.width * 0.5,
        surfaceBox.y + surfaceBox.height * 0.5,
      );
    };

    // HUD「画質補正」ボタンでシートを開き、HUD が閉じ透明バックドロップ上で上半分が露出していることを確認
    await tapCenter();
    const shaderButton = page.getByTestId("reader-shader-button");
    await expect(shaderButton).toHaveAttribute("data-shader-modified", "false");
    await shaderButton.click();

    await expect(page.getByTestId("reader-hud-top")).toBeHidden();
    await expect(page.getByTestId("reader-hud-bottom")).toBeHidden();
    await expect(page.getByTestId("reader-shader-backdrop")).toBeVisible();
    await expect(page.getByTestId("reader-shader-backdrop")).toHaveClass(
      /bg-transparent/,
    );
    const sheet = page.getByTestId("reader-shader-sheet");
    await expect(sheet).toBeVisible();
    const sheetBox = await sheet.boundingBox();
    expect(sheetBox).not.toBeNull();
    expect(sheetBox!.y).toBeGreaterThan(
      surfaceBox.y + surfaceBox.height * 0.45,
    );

    // 1. whitePoint -> 0.80 (シート開いたまま透明バックドロップ越しに左上黄ばみ紙色が完全白飛ばしへ変化)
    await page.getByTestId("shader-white-point-slider").fill("0.80");
    await expect(canvas).toHaveAttribute(
      "data-shader-params",
      "0.00,0.80,0.00,1.00",
    );
    const whiteShot = await canvas.screenshot();
    const blownWhite = readPngPixelAtRatio(whiteShot, 0.34, 0.25);
    expect(blownWhite.r).toBeGreaterThanOrEqual(245);
    expect(blownWhite.g).toBeGreaterThanOrEqual(245);
    expect(blownWhite.b).toBeGreaterThanOrEqual(245);

    // 2. blackPoint -> 0.20 (右上裏写り暗灰が完全黒引き締めへ変化)
    await page.getByTestId("shader-black-point-slider").fill("0.20");
    await expect(canvas).toHaveAttribute(
      "data-shader-params",
      "0.00,0.80,0.20,1.00",
    );
    const blackShot = await canvas.screenshot();
    const crushedBlack = readPngPixelAtRatio(blackShot, 0.66, 0.25);
    expect(crushedBlack.r).toBeLessThanOrEqual(10);
    expect(crushedBlack.g).toBeLessThanOrEqual(10);
    expect(crushedBlack.b).toBeLessThanOrEqual(10);

    // 3. gamma -> 0.65 (薄墨濃化) / gamma -> 1.50 (薄墨明化)
    await page.getByTestId("shader-gamma-slider").fill("0.65");
    await expect(canvas).toHaveAttribute(
      "data-shader-params",
      "0.00,0.80,0.20,0.65",
    );
    await page.getByTestId("shader-sheet-close-button").click();
    await expect(sheet).toHaveCount(0);
    const gammaDarkShot = await canvas.screenshot();
    const darkenedThin = readPngPixelAtRatio(gammaDarkShot, 0.34, 0.75);
    expect(darkenedThin.g).toBeLessThan(105);

    await tapCenter();
    await shaderButton.click();
    await expect(sheet).toBeVisible();
    await page.getByTestId("shader-gamma-slider").fill("1.50");
    await expect(canvas).toHaveAttribute(
      "data-shader-params",
      "0.00,0.80,0.20,1.50",
    );
    await page.getByTestId("shader-sheet-close-button").click();
    await expect(sheet).toHaveCount(0);
    const gammaLightShot = await canvas.screenshot();
    const lightenedThin = readPngPixelAtRatio(gammaLightShot, 0.34, 0.75);
    expect(lightenedThin.g).toBeGreaterThan(150);
    const preSharpEdge = readPngHorizontalContrastRange(
      gammaLightShot,
      0.75,
      0.56,
      0.76,
    );
    expect(preSharpEdge.contrast).toBeGreaterThan(baseEdge.contrast);

    // 4. sharpness -> 1.00 (右下階段エッジ周辺の最大・最小コントラスト差がオーバーシュートにより拡大)
    await tapCenter();
    await shaderButton.click();
    await expect(sheet).toBeVisible();
    await page.getByTestId("shader-sharpness-slider").fill("1.00");
    await expect(canvas).toHaveAttribute(
      "data-shader-params",
      "1.00,0.80,0.20,1.50",
    );
    await page.getByTestId("shader-sheet-close-button").click();
    await expect(sheet).toHaveCount(0);
    const sharpShot = await canvas.screenshot();
    const sharpEdge = readPngHorizontalContrastRange(
      sharpShot,
      0.75,
      0.56,
      0.76,
    );
    expect(sharpEdge.contrast).toBeGreaterThan(preSharpEdge.contrast + 50);

    // 5. 「リセット」で初期ニュートラル値と元 RGB へ復帰
    await tapCenter();
    await shaderButton.click();
    await expect(sheet).toBeVisible();
    await page.getByTestId("shader-reset-button").click();
    await expect(canvas).toHaveAttribute(
      "data-shader-params",
      "0.00,1.00,0.00,1.00",
    );
    await page.getByTestId("shader-sheet-close-button").click();
    await expect(sheet).toHaveCount(0);

    const resetShot = await canvas.screenshot();
    const resetYellow = readPngPixelAtRatio(resetShot, 0.34, 0.25);
    expect(resetYellow.r).toBeGreaterThanOrEqual(230);
    expect(resetYellow.b).toBeLessThanOrEqual(217);
    const resetDark = readPngPixelAtRatio(resetShot, 0.66, 0.25);
    expect(resetDark.r).toBeGreaterThanOrEqual(37);
    expect(resetDark.r).toBeLessThanOrEqual(47);
    const resetThin = readPngPixelAtRatio(resetShot, 0.34, 0.75);
    expect(resetThin.g).toBeGreaterThanOrEqual(123);
    expect(resetThin.g).toBeLessThanOrEqual(133);
    const resetEdge = readPngHorizontalContrastRange(
      resetShot,
      0.75,
      0.56,
      0.76,
    );
    expect(resetEdge.contrast).toBeLessThanOrEqual(baseEdge.contrast + 5);

    // 6. 再調整 + 「デフォルト保存」-> IndexedDB 永続化 & リロード後別ファイルへ自動適用
    await tapCenter();
    await shaderButton.click();
    await expect(sheet).toBeVisible();
    await page.getByTestId("shader-sharpness-slider").fill("0.50");
    await page.getByTestId("shader-white-point-slider").fill("0.85");
    await page.getByTestId("shader-black-point-slider").fill("0.15");
    await page.getByTestId("shader-gamma-slider").fill("0.80");
    await expect(canvas).toHaveAttribute(
      "data-shader-params",
      "0.50,0.85,0.15,0.80",
    );

    await page.getByTestId("shader-save-default-button").click();
    await expect(page.getByTestId("shader-save-status")).toHaveText(
      "デフォルト設定を保存しました",
    );
    await expect
      .poll(async () => readSyncMetaValue(page, "defaultReaderSettingsJson"))
      .toBe(
        JSON.stringify({
          version: 1,
          shader: {
            sharpness: 0.5,
            whitePoint: 0.85,
            blackPoint: 0.15,
            gamma: 0.8,
          },
        }),
      );

    await page.reload();
    await waitForServicesReady(page);
    await expect(page).toHaveURL(/\/$/);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "other-book-shader-default.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticThreePageArchive()),
    });
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(canvas).toHaveAttribute(
      "data-shader-params",
      "0.50,0.85,0.15,0.80",
    );

    await tapCenter();
    await expect(page.getByTestId("reader-shader-button")).toHaveAttribute(
      "data-shader-modified",
      "true",
    );

    expect(pageErrors).toEqual([]);
  });

  test("画質補正ボトムシート表示中はAppBridge戻るボタン・Escape・バックドロップでシートのみ閉鎖(優先度2)し、閉鎖後の戻る操作でTR-08終了→'/'でminimizeApp(優先度5)が実行されること", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "priority2-back-control.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticThreePageArchive()),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    const surface = page.getByTestId("reader-interaction-surface");
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const surfaceBox = box!;
    const openSheetFromHud = async () => {
      await page.mouse.click(
        surfaceBox.x + surfaceBox.width * 0.5,
        surfaceBox.y + surfaceBox.height * 0.5,
      );
      await expect(page.getByTestId("reader-hud-top")).toBeVisible();
      await page.getByTestId("reader-shader-button").click();
      await expect(page.getByTestId("reader-shader-sheet")).toBeVisible();
    };

    const triggerBridgeBack = async (): Promise<number> =>
      page.evaluate(async () => {
        const bridge = window.__exLibrisServices?.appBridge as
          MockAppBridge | undefined;
        if (!bridge) {
          throw new Error("MockAppBridge is not available on window");
        }
        await bridge.triggerBackButton();
        return bridge.getMinimizeAppCallCount();
      });

    // 1. ボトムシート表示中の AppBridge backButton -> 優先度2でシートのみ閉鎖
    await openSheetFromHud();
    const minimizeAfterSheetBack = await triggerBridgeBack();
    expect(minimizeAfterSheetBack).toBe(0);
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(page.getByTestId("reader-shader-sheet")).toHaveCount(0);
    await expect(page.getByTestId("reader-hud-top")).toBeHidden();

    // 2. 再度開いて Escape キー -> 優先度2でシートのみ閉鎖 (TR-08 不発)
    await openSheetFromHud();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(page.getByTestId("reader-shader-sheet")).toHaveCount(0);

    // 3. 再度開いてバックドロップ上部クリック -> 優先度2でシートのみ閉鎖 (TR-08 不発)
    await openSheetFromHud();
    const backdrop = page.getByTestId("reader-shader-backdrop");
    await backdrop.click({ position: { x: 24, y: 24 } });
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(page.getByTestId("reader-shader-sheet")).toHaveCount(0);

    // 4. シート閉鎖状態での AppBridge backButton -> 優先度3で TR-08 ('/' 復帰)
    const minimizeAfterReaderBack = await triggerBridgeBack();
    expect(minimizeAfterReaderBack).toBe(0);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();

    // 5. '/' 上での AppBridge backButton -> 優先度5で minimizeApp()
    const minimizeOnHome = await triggerBridgeBack();
    expect(minimizeOnHome).toBe(1);

    expect(pageErrors).toEqual([]);
  });

  test("rtl/ltr連動シークバーのドラッグプレビュー(非通信)・要素外リリース確定・キャンセル・ltrキーボード操作・1280x800見開き着地が動作すること (AC-RD-14)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const dragSeekbarToValue = async (
      targetIndex: number,
      maxIndex: number,
      direction: "rtl" | "ltr",
    ): Promise<{ currentX: number; topY: number }> => {
      const seekbar = page.getByTestId("reader-seekbar");
      const barBox = await seekbar.boundingBox();
      expect(barBox).not.toBeNull();
      const rect = barBox!;
      const centerY = rect.y + rect.height / 2;
      const currentVal = Number(await seekbar.inputValue());
      const startRatio =
        direction === "rtl" ? 1 - currentVal / maxIndex : currentVal / maxIndex;
      const startX = Math.min(
        rect.x + rect.width - 4,
        Math.max(rect.x + 4, rect.x + rect.width * startRatio),
      );
      await page.mouse.move(startX, centerY);
      await page.mouse.down();

      const targetRatio =
        direction === "rtl"
          ? 1 - targetIndex / maxIndex
          : targetIndex / maxIndex;
      let currentX = Math.min(
        rect.x + rect.width - 4,
        Math.max(rect.x + 4, rect.x + rect.width * targetRatio),
      );
      await page.mouse.move(currentX, centerY, { steps: 6 });

      for (let step = 0; step < 40; step += 1) {
        const val = Number(await seekbar.inputValue());
        if (val === targetIndex) {
          break;
        }
        const moveSign =
          direction === "rtl"
            ? val < targetIndex
              ? -1
              : 1
            : val < targetIndex
              ? 1
              : -1;
        currentX = Math.min(
          rect.x + rect.width - 2,
          Math.max(rect.x + 2, currentX + moveSign * 6),
        );
        await page.mouse.move(currentX, centerY, { steps: 2 });
      }
      expect(Number(await seekbar.inputValue())).toBe(targetIndex);
      return { currentX, topY: rect.y };
    };

    // Part A: 375x667 単ページ 7ページアーカイブ
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "seekbar-seven-pages.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticSevenPageArchive()),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
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

    const seekbar = page.getByTestId("reader-seekbar");
    const indicator = page.getByTestId("reader-page-indicator");
    await expect(seekbar).toHaveAttribute("dir", "rtl");
    await expect(seekbar).toHaveAttribute("data-reading-direction", "rtl");
    await expect(indicator).toHaveAttribute("data-seek-preview", "false");
    await expect(indicator).toHaveText("1 / 7");

    const epochBeforeDrag = Number(
      await canvas.getAttribute("data-rendered-epoch"),
    );

    // 1. rtl ドラッグ中はプレビュー("5 / 7")のみ更新し canvas/Epoch は一切進まない -> 要素外リリースで1回だけジャンプ確定
    const dragInfo = await dragSeekbarToValue(4, 6, "rtl");
    await expect(indicator).toHaveAttribute("data-seek-preview", "true");
    await expect(indicator).toHaveText("5 / 7");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(canvas).toHaveAttribute(
      "data-rendered-epoch",
      String(epochBeforeDrag),
    );

    // 指をバー上側の矩形外へずらしてもプレビュー＆未通信を維持し、要素外 mouse.up で 1 回だけ新 Epoch ジャンプ
    await page.mouse.move(dragInfo.currentX, dragInfo.topY - 60, { steps: 5 });
    await expect(indicator).toHaveAttribute("data-seek-preview", "true");
    await expect(canvas).toHaveAttribute(
      "data-rendered-epoch",
      String(epochBeforeDrag),
    );
    await page.mouse.up();

    await expect(indicator).toHaveAttribute("data-seek-preview", "false");
    await expect(indicator).toHaveText("5 / 7");
    await expect(canvas).toHaveAttribute("data-rendered-page", "4");
    await expect(canvas).toHaveAttribute(
      "data-rendered-epoch",
      String(epochBeforeDrag + 1),
    );
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    // HUDを一旦閉じて p.5 (シアン) が描画されていることも確認
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-bottom")).toBeHidden();
    const seekedP4Pixel = readPngCenterPixel(await canvas.screenshot());
    expect(seekedP4Pixel.r).toBeLessThan(30);
    expect(seekedP4Pixel.g).toBeGreaterThan(200);
    expect(seekedP4Pixel.b).toBeGreaterThan(200);

    // 2. ドラッグ中の pointercancel はジャンプせずプレビュー解除
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-bottom")).toBeVisible();
    const epochBeforeCancel = Number(
      await canvas.getAttribute("data-rendered-epoch"),
    );
    await dragSeekbarToValue(1, 6, "rtl");
    await expect(indicator).toHaveAttribute("data-seek-preview", "true");
    await expect(indicator).toHaveText("2 / 7");
    await page.evaluate(() => {
      window.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true }),
      );
    });
    await page.mouse.up();

    await expect(indicator).toHaveAttribute("data-seek-preview", "false");
    await expect(indicator).toHaveText("5 / 7");
    await expect(canvas).toHaveAttribute("data-rendered-page", "4");
    await expect(canvas).toHaveAttribute(
      "data-rendered-epoch",
      String(epochBeforeCancel),
    );

    // 3. ltr 切替後の dir="ltr" 確認 + <input> フォーカス中 ArrowRight で1ページだけ確定ジャンプ（ページめくり二重非干渉）
    await page.getByTestId("reader-direction-button").click();
    await expect(seekbar).toHaveAttribute("dir", "ltr");
    await expect(seekbar).toHaveAttribute("data-reading-direction", "ltr");
    const epochBeforeKeySeek = Number(
      await canvas.getAttribute("data-rendered-epoch"),
    );

    await seekbar.focus();
    await page.keyboard.press("ArrowRight");
    await expect(indicator).toHaveAttribute("data-seek-preview", "false");
    await expect(indicator).toHaveText("6 / 7");
    await expect(canvas).toHaveAttribute("data-rendered-page", "5");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    // L1窓外の先頭(0)へ Home キーでキーボードシーク確定し、新 Epoch (ArrowRightのepoch+1に続くepoch+2) ジャンプを検証
    await page.keyboard.press("Home");
    await expect(indicator).toHaveAttribute("data-seek-preview", "false");
    await expect(indicator).toHaveText("1 / 7");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(canvas).toHaveAttribute(
      "data-rendered-epoch",
      String(epochBeforeKeySeek + 2),
    );
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    // TR-08 で戻る
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);

    // Part B: 1280x800 見開き状態でシーク確定時に目標ページが data-rendered-pages に確実に含まれること
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "seekbar-spread-landing.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticPortraitSpreadArchive()),
    });
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(canvas).toHaveAttribute("data-rendered-slots", "center:0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    const spreadBox = await surface.boundingBox();
    expect(spreadBox).not.toBeNull();
    await page.mouse.click(
      spreadBox!.x + spreadBox!.width * 0.5,
      spreadBox!.y + spreadBox!.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-bottom")).toBeVisible();

    const spreadDrag = await dragSeekbarToValue(2, 5, "rtl");
    await expect(indicator).toHaveAttribute("data-seek-preview", "true");
    await expect(indicator).toHaveText("3 / 6");
    await page.mouse.move(spreadDrag.currentX, spreadDrag.topY - 60, {
      steps: 4,
    });
    await page.mouse.up();

    await expect(indicator).toHaveAttribute("data-seek-preview", "false");
    await expect(indicator).toHaveText("3-4 / 6");
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:3,right:2",
    );
    const renderedPagesAttr = await canvas.getAttribute("data-rendered-pages");
    expect((renderedPagesAttr ?? "").split(",")).toContain("2");

    expect(pageErrors).toEqual([]);
  });

  test("1280x800見開き+1ページずらしのreadingProgress自動レジューム・読了更新・SCR-01最近のローカル閲覧履歴の表示/リロード保持/個別削除/一括クリアが動作すること (AC-RD-15, AC-BS-06)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const bookABytes = buildSyntheticPortraitSpreadArchive();
    const bookAName = "progress-book-a.cbz";
    const bookAKey = `local:${bookAName}:${bookABytes.byteLength}`;

    // 1. 1280x800 見開きアーカイブを開き、1ページずらし ON で中間ページ (index 2 = 3-4 / 6) へ進めて TR-08 復帰
    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: bookAName,
      mimeType: "application/x-cbz",
      buffer: Buffer.from(bookABytes),
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
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.5,
      surfaceBox.y + surfaceBox.height * 0.5,
    );
    await expect(page.getByTestId("reader-hud-bottom")).toBeVisible();

    await page.getByTestId("reader-offset-toggle-button").click();
    await expect(
      page.getByTestId("reader-offset-toggle-button"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:1,right:0",
    );

    await page.getByTestId("reader-next-button").click();
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:3,right:2",
    );
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "3-4 / 6",
    );
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);

    // 2. SCR-01 に「最近のローカル閲覧履歴」(読書中・3 / 6 ページ・進捗バー) が表示されリロード後も維持されること
    const historySection = page.getByTestId("recent-local-history-section");
    await expect(historySection).toBeVisible();
    const items = page.getByTestId("recent-local-history-item");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(bookAName);
    await expect(items.first()).toContainText("読書中");
    await expect(items.first()).toContainText("3 / 6 ページ");
    const readingBar = items.first().getByRole("progressbar");
    await expect(readingBar).toHaveAttribute("aria-valuenow", "50");
    await expect(
      items.first().getByTestId("local-history-progress-fill"),
    ).toHaveAttribute("style", /width:\s*50%/);

    await page.reload();
    await waitForServicesReady(page);
    await expect(historySection).toBeVisible();
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("読書中");
    await expect(items.first()).toContainText("3 / 6 ページ");

    // 3. 履歴行の reopen-local-history-button クリックで filechooser が開き、再選択時に index 2 & 1ページずらし ON で自動レジューム
    const [reopenChooser1] = await Promise.all([
      page.waitForEvent("filechooser"),
      items.first().getByTestId("reopen-local-history-button").click(),
    ]);
    await reopenChooser1.setFiles({
      name: bookAName,
      mimeType: "application/x-cbz",
      buffer: Buffer.from(bookABytes),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:3,right:2",
    );
    await expect(canvas).toHaveAttribute("data-rendered-pages", "2,3");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    const resumedBox = await surface.boundingBox();
    expect(resumedBox).not.toBeNull();
    await page.mouse.click(
      resumedBox!.x + resumedBox!.width * 0.5,
      resumedBox!.y + resumedBox!.height * 0.5,
    );
    await expect(
      page.getByTestId("reader-offset-toggle-button"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "3-4 / 6",
    );

    // 4. 最終見開き (index 4: 5-6 / 6) まで進めて TR-08 復帰 -> バッジ「読了」・進捗バー 100%
    await page.getByTestId("reader-next-button").click();
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:5,right:4",
    );
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "5-6 / 6",
    );
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await expect(historySection).toBeVisible();
    await expect(items.first()).toContainText("読了");
    await expect(items.first()).toContainText("5 / 6 ページ");
    await expect(items.first().getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    await expect(
      items.first().getByTestId("local-history-progress-fill"),
    ).toHaveAttribute("style", /width:\s*100%/);

    // 5. 「読了」状態を再選択しても保存位置 (index 4 & 1ページずらし ON) から忠実にレジュームすること (Q4)
    const [reopenChooser2] = await Promise.all([
      page.waitForEvent("filechooser"),
      items.first().getByTestId("reopen-local-history-button").click(),
    ]);
    await reopenChooser2.setFiles({
      name: bookAName,
      mimeType: "application/x-cbz",
      buffer: Buffer.from(bookABytes),
    });
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(canvas).toHaveAttribute(
      "data-rendered-slots",
      "left:5,right:4",
    );
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    await page.mouse.click(
      resumedBox!.x + resumedBox!.width * 0.5,
      resumedBox!.y + resumedBox!.height * 0.5,
    );
    await expect(
      page.getByTestId("reader-offset-toggle-button"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("reader-page-indicator")).toHaveText(
      "5-6 / 6",
    );

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);

    const bookARecord = await readReadingProgressRecord(page, bookAKey);
    expect(bookARecord).not.toBeNull();
    const bookATimestamp = bookARecord!.lastReadAt;

    // 6. 別ファイルも開いて 2 件履歴にした後、1 件目のみ個別削除(filechooser未発火) -> 最後に全消去で非表示
    await expect
      .poll(() => Date.now(), { timeout: 2_000 })
      .toBeGreaterThan(bookATimestamp);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "progress-book-b.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(buildSyntheticThreePageArchive()),
    });
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);

    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("progress-book-b.zip");
    await expect(items.nth(1)).toContainText(bookAName);

    let fileChooserOpenedOnDelete = false;
    const handleUnexpectedChooser = () => {
      fileChooserOpenedOnDelete = true;
    };
    page.on("filechooser", handleUnexpectedChooser);
    await items.nth(0).getByTestId("delete-local-history-button").click();
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(bookAName);
    page.off("filechooser", handleUnexpectedChooser);
    expect(fileChooserOpenedOnDelete).toBe(false);

    await page.getByTestId("clear-local-history-button").click();
    await expect(historySection).toHaveCount(0);

    await page.reload();
    await waitForServicesReady(page);
    await expect(historySection).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("WEBGL_lose_context発火時にcontext-lostへ遷移し警告ログ記録後、restoreContext()で自動再描画復帰すること (AC-GL-05)", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: "webgl-context-lost.cbz",
      mimeType: "application/x-cbz",
      buffer: Buffer.from(buildSyntheticThreePageArchive()),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    const beforeLostPixel = readPngCenterPixel(await canvas.screenshot());
    expect(beforeLostPixel.r).toBeGreaterThan(200);
    expect(beforeLostPixel.g).toBeLessThan(30);
    expect(beforeLostPixel.b).toBeLessThan(30);

    const hasExtension = await page.evaluate(() => {
      const canvasEl = document.querySelector<HTMLCanvasElement>(
        '[data-testid="reader-canvas"]',
      );
      const gl = canvasEl?.getContext("webgl2");
      const ext = gl?.getExtension("WEBGL_lose_context") ?? null;
      if (!ext) {
        return false;
      }
      (
        window as unknown as {
          __testWebglLoseContextExt?: WEBGL_lose_context;
        }
      ).__testWebglLoseContextExt = ext;
      ext.loseContext();
      return true;
    });
    expect(hasExtension).toBe(true);

    await expect(canvas).toHaveAttribute("data-webgl-status", "context-lost");

    await page.evaluate(() => {
      const win = window as unknown as {
        __testWebglLoseContextExt?: WEBGL_lose_context;
      };
      win.__testWebglLoseContextExt?.restoreContext();
      delete win.__testWebglLoseContextExt;
    });

    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    const restoredPixel = readPngCenterPixel(await canvas.screenshot());
    expect(restoredPixel.r).toBeGreaterThan(200);
    expect(restoredPixel.g).toBeLessThan(30);
    expect(restoredPixel.b).toBeLessThan(30);

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/$/);
    await page.getByTestId("copy-diagnostics-button").click();
    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("[WARN] [webgl2] WebGL2 コンテキストがロストしました");
    const report = await page.evaluate(() => navigator.clipboard.readText());
    expect(report).not.toContain("[ERROR]");

    expect(pageErrors).toEqual([]);
  });

  test("visibilitychange(hidden)およびpagehide発火時にIndexedDBのreadingProgressが即時フラッシュ保存されること (AC-RD-15)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const archiveBytes = buildSyntheticThreePageArchive();
    const fileName = "lifecycle-flush.cbz";
    const targetKey = `local:${fileName}:${archiveBytes.byteLength}`;

    await page.getByTestId("local-zip-file-input").setInputFiles({
      name: fileName,
      mimeType: "application/x-cbz",
      buffer: Buffer.from(archiveBytes),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-rendered-page", "1");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    let settledAfterMoveTimestamp = 0;
    await expect
      .poll(async () => {
        const rec = await readReadingProgressRecord(page, targetKey);
        if (rec && rec.currentPageIndex === 1) {
          settledAfterMoveTimestamp = rec.lastReadAt;
          return true;
        }
        return false;
      })
      .toBe(true);

    // 1. IndexedDB レコード削除後、visibilityState="hidden" + visibilitychange 発火で即時再保存されること
    await expect
      .poll(() => page.evaluate(() => Date.now()), { timeout: 2_000 })
      .toBeGreaterThan(settledAfterMoveTimestamp);
    await deleteReadingProgressRecord(page, targetKey);
    expect(await readReadingProgressRecord(page, targetKey)).toBeNull();

    const visibilityDispatchStartMs = await page.evaluate(() => Date.now());
    await page.evaluate(() => {
      const hadOwnDescriptor = Object.prototype.hasOwnProperty.call(
        document,
        "visibilityState",
      );
      const prevDescriptor = Object.getOwnPropertyDescriptor(
        document,
        "visibilityState",
      );
      try {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      } finally {
        if (hadOwnDescriptor && prevDescriptor) {
          Object.defineProperty(document, "visibilityState", prevDescriptor);
        } else {
          delete (document as unknown as { visibilityState?: unknown })
            .visibilityState;
        }
      }
    });

    await expect
      .poll(async () => readReadingProgressRecord(page, targetKey))
      .toMatchObject({
        targetKey,
        volumeId: null,
        currentPageIndex: 1,
        totalPageCount: 3,
        readStatus: "reading",
        spreadPageOffset: 0,
      });
    const afterVisibilityRecord = await readReadingProgressRecord(
      page,
      targetKey,
    );
    expect(afterVisibilityRecord).not.toBeNull();
    expect(afterVisibilityRecord!.lastReadAt).toBeGreaterThanOrEqual(
      visibilityDispatchStartMs,
    );

    // 2. 再削除後に window "pagehide" 発火で即時再保存されること
    await expect
      .poll(() => page.evaluate(() => Date.now()), { timeout: 2_000 })
      .toBeGreaterThan(afterVisibilityRecord!.lastReadAt);
    await deleteReadingProgressRecord(page, targetKey);
    expect(await readReadingProgressRecord(page, targetKey)).toBeNull();

    const pageHideDispatchStartMs = await page.evaluate(() => Date.now());
    await page.evaluate(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    await expect
      .poll(async () => readReadingProgressRecord(page, targetKey))
      .toMatchObject({
        targetKey,
        volumeId: null,
        currentPageIndex: 1,
        totalPageCount: 3,
        readStatus: "reading",
        spreadPageOffset: 0,
      });
    const afterPageHideRecord = await readReadingProgressRecord(
      page,
      targetKey,
    );
    expect(afterPageHideRecord).not.toBeNull();
    expect(afterPageHideRecord!.lastReadAt).toBeGreaterThanOrEqual(
      pageHideDispatchStartMs,
    );

    expect(pageErrors).toEqual([]);
  });
});
