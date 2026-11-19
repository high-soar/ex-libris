import { expect, type Page, test } from "@playwright/test";

async function waitForServicesReady(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.__exLibrisServices?.isReady === true),
      { timeout: 10_000 },
    )
    .toBe(true);
}

test.describe("SCN-01: Phase 1 初期シェル起動・WebGL2環境・診断ログ導線検証", () => {
  test("初期シェルがゼロコンフィグで起動しWebGL2コンテキストと診断ログコピーが動作すること", async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await waitForServicesReady(page);

    await expect(page.getByTestId("app-root")).toHaveAttribute(
      "data-app-ready",
      "true",
    );
    await expect(page.getByTestId("app-version")).toHaveText("v0.0.0");
    await expect(page.getByTestId("bookshelf-empty")).toBeVisible();

    const hasWebGL2 = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      return canvas.getContext("webgl2") !== null;
    });
    expect(hasWebGL2).toBe(true);

    await page.getByTestId("copy-diagnostics-button").click();
    await expect(page.getByTestId("copy-diagnostics-status")).toHaveText(
      "診断ログをコピーしました",
    );
  });
});
