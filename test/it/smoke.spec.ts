import { expect, test } from "@playwright/test";
import {
  buildSyntheticThreePageArchive,
  createFileDataTransfer,
  trackPageErrors,
  waitForServicesReady,
} from "./helpers";

test.describe("SCN-01: 初期シェル起動・WebGL2環境・診断ログ・ローカルZIP導線検証", () => {
  test("初期シェルがゼロコンフィグで起動しWebGL2コンテキスト・診断ログコピー・ヘッダーCTAからのfilechooser非対応拡張子警告が動作すること", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await waitForServicesReady(page);

    await expect(page.getByTestId("app-root")).toHaveAttribute(
      "data-app-ready",
      "true",
    );
    await expect(page.getByTestId("app-version")).toHaveText("v0.0.0");
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();
    await expect(page.getByTestId("bookshelf-empty")).toHaveAttribute(
      "data-drag-active",
      "false",
    );
    await expect(
      page.getByTestId("header-open-local-zip-button"),
    ).toBeVisible();
    await expect(page.getByTestId("open-local-zip-button")).toBeVisible();

    const hasWebGL2 = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      return canvas.getContext("webgl2") !== null;
    });
    expect(hasWebGL2).toBe(true);

    await page.getByTestId("copy-diagnostics-button").click();
    await expect(page.getByTestId("copy-diagnostics-status")).toHaveText(
      "診断ログをコピーしました",
    );

    const [headerFileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("header-open-local-zip-button").click(),
    ]);
    await headerFileChooser.setFiles({
      name: "unsupported.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n"),
    });

    await expect(page).toHaveURL(/\/$/);
    const errorAlert = page.getByTestId("local-zip-error");
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toHaveAttribute("role", "alert");
    await expect(errorAlert).toContainText(
      "対応形式は .zip または .cbz ファイルのみです",
    );

    expect(pageErrors).toEqual([]);
  });

  test("メインカードCTA押下からのfilechooserで有効.zip選択時に/read/localへ遷移(TR-02a)すること (AC-BS-01, AC-BS-04)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");
    await waitForServicesReady(page);

    const [cardFileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("open-local-zip-button").click(),
    ]);
    await cardFileChooser.setFiles({
      name: "cta-sample.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(buildSyntheticThreePageArchive()),
    });

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    expect(pageErrors).toEqual([]);
  });

  test("メインドロップゾーンへのdragoverハイライト・非対応.txtドロップ警告・有効.cbzドロップ起動(TR-02a)が動作すること (AC-BS-02, AC-BS-03, AC-BS-04)", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");
    await waitForServicesReady(page);

    const mainDropZone = page.locator("main");
    const emptyCard = page.getByTestId("bookshelf-empty");
    await expect(emptyCard).toHaveAttribute("data-drag-active", "false");

    const unsupportedTransfer = await createFileDataTransfer(page, {
      name: "unsupported.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("not a comic archive"),
    });
    await mainDropZone.dispatchEvent("dragover", {
      dataTransfer: unsupportedTransfer,
    });
    await expect(emptyCard).toHaveAttribute("data-drag-active", "true");

    await mainDropZone.dispatchEvent("drop", {
      dataTransfer: unsupportedTransfer,
    });
    await unsupportedTransfer.dispose();

    await expect(emptyCard).toHaveAttribute("data-drag-active", "false");
    await expect(page).toHaveURL(/\/$/);
    const errorAlert = page.getByTestId("local-zip-error");
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toHaveAttribute("role", "alert");
    await expect(errorAlert).toContainText(
      "対応形式は .zip または .cbz ファイルのみです",
    );

    const validTransfer = await createFileDataTransfer(page, {
      name: "dropped-comic.cbz",
      mimeType: "application/x-cbz",
      bytes: buildSyntheticThreePageArchive(),
    });
    await mainDropZone.dispatchEvent("dragover", {
      dataTransfer: validTransfer,
    });
    await expect(emptyCard).toHaveAttribute("data-drag-active", "true");

    await mainDropZone.dispatchEvent("drop", {
      dataTransfer: validTransfer,
    });
    await validTransfer.dispose();

    await expect(page).toHaveURL(/\/read\/local$/);
    const canvas = page.getByTestId("reader-canvas");
    await expect(canvas).toHaveAttribute("data-webgl-status", "ready");
    await expect(canvas).toHaveAttribute("data-rendered-page", "0");
    await expect(page.getByTestId("reader-loading")).toBeHidden();

    expect(pageErrors).toEqual([]);
  });
});
