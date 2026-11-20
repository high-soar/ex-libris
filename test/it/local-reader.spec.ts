import { expect, test } from "@playwright/test";
import type { MockAppBridge } from "../../src/bridges/app/mockAppBridge";
import {
  buildCorruptZipBytes,
  buildPartialCorruptArchive,
  buildSyntheticThreePageArchive,
  readPngCenterPixel,
  trackPageErrors,
  waitForServicesReady,
} from "./helpers";

test.describe("SCN-02: ローカルZIP/CBZストリーミングリーダー結合シナリオ", () => {
  test("合成CBZ選択から実WebWorker解凍・WebGL2単ページ描画・右開き操作(タップ/スワイプ/キー/HUD)・Escape終了(TR-08)まで一貫して動作すること", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");
    await waitForServicesReady(page);

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
});
