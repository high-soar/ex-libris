import { expect, test } from "@playwright/test";
import { trackPageErrors, waitForServicesReady } from "./helpers";

test.describe("SCN-01: 初期シェル起動・WebGL2環境・診断ログ・ローカルZIP導線検証", () => {
  test("初期シェルがゼロコンフィグで起動しWebGL2コンテキスト・診断ログコピー・CTA表示・非対応拡張子警告が動作すること", async ({
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

    await page.getByTestId("local-zip-file-input").setInputFiles({
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
});
