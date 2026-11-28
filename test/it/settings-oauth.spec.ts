import { expect, test } from "@playwright/test";
import { APP_VERSION } from "../../src/shared/constants/app";
import type { MockAppBridge } from "../../src/bridges/app/mockAppBridge";
import {
  buildSyntheticThreePageArchive,
  resetTestDatabase,
  trackPageErrors,
  waitForServicesReady,
} from "./helpers";

test.describe("SCN-03: Google OAuth連携・Driveフォルダ設定・診断ログ・戻る優先度結合検証", () => {
  test("(1) SCR-01設定導線(TR-03)・AUTH_CANCELLEDサイレント・OAuthログイン・リロード後復元・ログアウト時ルート保持", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    const setupBanner = page.getByTestId("drive-setup-banner");
    await expect(setupBanner).toHaveAttribute(
      "data-banner-kind",
      "unauthenticated",
    );

    // 未連携バナー CTA から /settings へ遷移 (TR-03)
    await page.getByTestId("drive-setup-banner-cta").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("settings-app-version")).toHaveText(
      `v${APP_VERSION}`,
    );
    await expect(page.getByTestId("google-auth-status-badge")).toHaveText(
      "未連携",
    );
    await expect(page.getByTestId("open-folder-picker-button")).toBeDisabled();
    await expect(page.getByTestId("folder-input")).toBeDisabled();
    await expect(page.getByTestId("sync-roots-unlinked-notice")).toBeVisible();

    // 戻るボタン(TR-09)で / へ復帰し、ヘッダー設定ボタンから再遷移(TR-03)
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);

    // AUTH_CANCELLED 時は破壊的エラーアラートを出さず未連携を維持
    await page.evaluate(() => {
      window.__exLibrisServices?.mockGoogleAuthAdapter?.queueNextSignInCancelled();
    });
    await page.getByTestId("google-signin-button").click();
    await expect(page.getByTestId("google-auth-status-badge")).toHaveText(
      "未連携",
    );
    await expect(page.getByTestId("google-auth-error")).toHaveCount(0);

    // 通常の Google アカウント連携
    await page.getByTestId("google-signin-button").click();
    await expect(page.getByTestId("google-auth-status-badge")).toHaveText(
      "連携済み",
    );
    await expect(page.getByTestId("google-account-email")).toHaveText(
      "reader@example.com",
    );
    await expect(page.getByTestId("open-folder-picker-button")).toBeEnabled();

    // 同期ルートを 1 件追加
    await page
      .getByTestId("folder-input")
      .fill("https://drive.google.com/drive/folders/mock-folder-comics");
    await page.getByTestId("add-folder-by-input-button").click();
    await expect(page.getByTestId("sync-root-item")).toHaveCount(1);
    await expect(page.getByTestId("sync-root-item").first()).toContainText(
      "Comics",
    );

    // ページリロード後のサイレントセッション復元 & IndexedDB 同期ルート復元
    await page.reload();
    await waitForServicesReady(page);
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("google-auth-status-badge")).toHaveText(
      "連携済み",
    );
    await expect(page.getByTestId("google-account-email")).toHaveText(
      "reader@example.com",
    );
    await expect(page.getByTestId("sync-root-item")).toHaveCount(1);
    await expect(page.getByTestId("sync-root-item").first()).toContainText(
      "Comics",
    );

    // ログアウト後も登録済み driveSyncRoots が保持され、追加操作は非活性になること
    await page.getByTestId("google-signout-button").click();
    await expect(page.getByTestId("google-auth-status-badge")).toHaveText(
      "未連携",
    );
    await expect(page.getByTestId("sync-roots-unlinked-notice")).toBeVisible();
    await expect(page.getByTestId("open-folder-picker-button")).toBeDisabled();
    await expect(page.getByTestId("folder-input")).toBeDisabled();
    await expect(page.getByTestId("sync-root-item")).toHaveCount(1);
    await expect(page.getByTestId("sync-root-item").first()).toContainText(
      "Comics",
    );

    // ログアウト後のリロードでも未連携のまま同期ルートを保持し操作非活性
    await page.reload();
    await waitForServicesReady(page);
    await expect(page.getByTestId("google-auth-status-badge")).toHaveText(
      "未連携",
    );
    await expect(page.getByTestId("open-folder-picker-button")).toBeDisabled();
    await expect(page.getByTestId("folder-input")).toBeDisabled();
    await expect(page.getByTestId("sync-root-item")).toHaveCount(1);

    expect(pageErrors).toEqual([]);
  });

  test("(2) DriveFolderPickerModal階層・パンくず・root抑止・105件ページング・URL/ID直接入力・有効無効トグル・論理削除", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByTestId("google-signin-button").click();
    await expect(page.getByTestId("google-auth-status-badge")).toHaveText(
      "連携済み",
    );

    // 階層ブラウズ・パンくず・root 確定ボタン抑止
    await page.getByTestId("open-folder-picker-button").click();
    await expect(page.getByTestId("drive-folder-picker-modal")).toBeVisible();
    await expect(page.getByTestId("folder-picker-breadcrumbs")).toContainText(
      "マイドライブ",
    );
    await expect(
      page.getByTestId("confirm-current-folder-button"),
    ).toBeDisabled();
    await expect(page.getByTestId("folder-picker-item")).toHaveCount(2);

    // Comics を開く -> アクション/SF 表示、確定ボタン有効化
    await page.getByRole("button", { name: "Comics を開く" }).click();
    await expect(page.getByTestId("folder-picker-breadcrumbs")).toContainText(
      "Comics",
    );
    await expect(
      page.getByTestId("confirm-current-folder-button"),
    ).toBeEnabled();
    await expect(page.getByTestId("folder-picker-item")).toHaveCount(2);

    // パンくずでマイドライブへ戻る -> 再び root 確定無効化
    await page
      .getByTestId("folder-picker-breadcrumbs")
      .getByRole("button", { name: "マイドライブ" })
      .click();
    await expect(
      page.getByTestId("confirm-current-folder-button"),
    ).toBeDisabled();

    // Comics -> アクションを開き「現在フォルダを確定」で追加
    await page.getByRole("button", { name: "Comics を開く" }).click();
    await page.getByRole("button", { name: "アクション を開く" }).click();
    await expect(page.getByTestId("folder-picker-empty")).toBeVisible();
    await page.getByTestId("confirm-current-folder-button").click();
    await expect(page.getByTestId("drive-folder-picker-modal")).toHaveCount(0);
    await expect(page.getByTestId("sync-root-item")).toHaveCount(1);
    await expect(page.getByTestId("sync-root-item").first()).toContainText(
      "アクション",
    );

    // 105件ページネーション(さらに読み込む)からの選択追加
    await page.evaluate(() => {
      const nodes = Array.from({ length: 105 }, (_, index) => ({
        id: `page-folder-${String(index + 1).padStart(3, "0")}`,
        name: `Paging Folder ${String(index + 1).padStart(3, "0")}`,
        parentId: "root",
      }));
      window.__exLibrisServices?.mockDriveFolderClient?.setNodes(nodes);
    });

    await page.getByTestId("open-folder-picker-button").click();
    await expect(page.getByTestId("folder-picker-item")).toHaveCount(100);
    await expect(page.getByTestId("folder-picker-load-more")).toBeVisible();
    await page.getByTestId("folder-picker-load-more").click();
    await expect(page.getByTestId("folder-picker-item")).toHaveCount(105);
    await expect(page.getByTestId("folder-picker-load-more")).toHaveCount(0);

    await page
      .getByRole("button", { name: "Paging Folder 105 を選択して追加" })
      .click();
    await expect(page.getByTestId("drive-folder-picker-modal")).toHaveCount(0);
    await expect(page.getByTestId("sync-root-item")).toHaveCount(2);

    // モックノードを初期化し、直接 URL/ID 入力による「root」拒否・非フォルダ拒否・正常追加を検証
    await page.evaluate(() => {
      window.__exLibrisServices?.mockDriveFolderClient?.setNodes([
        { id: "mock-folder-comics", name: "Comics", parentId: "root" },
        { id: "mock-folder-manga", name: "自炊マンガ", parentId: "root" },
        {
          id: "mock-file-not-folder",
          name: "comic.cbz",
          parentId: "root",
          isFolder: false,
        },
      ]);
    });

    await page.getByTestId("folder-input").fill("root");
    await page.getByTestId("add-folder-by-input-button").click();
    const syncRootsError = page.getByTestId("sync-roots-error");
    await expect(syncRootsError).toHaveAttribute("role", "alert");
    await expect(syncRootsError).toContainText("マイドライブ直下（root）");

    await page.getByTestId("folder-input").fill("mock-file-not-folder");
    await page.getByTestId("add-folder-by-input-button").click();
    await expect(syncRootsError).toHaveAttribute("role", "alert");
    await expect(syncRootsError).toContainText("フォルダではありません");

    await page
      .getByTestId("folder-input")
      .fill(
        "https://drive.google.com/drive/folders/mock-folder-manga?usp=sharing",
      );
    await page.getByTestId("add-folder-by-input-button").click();
    await expect(page.getByTestId("sync-roots-error")).toHaveCount(0);
    await expect(page.getByTestId("folder-input")).toHaveValue("");
    await expect(page.getByTestId("sync-root-item")).toHaveCount(3);

    // 有効/無効トグルとリロード永続化
    const mangaToggle = page.getByRole("button", {
      name: "自炊マンガ の同期を無効にする",
    });
    await mangaToggle.click();
    const mangaEnableToggle = page.getByRole("button", {
      name: "自炊マンガ の同期を有効にする",
    });
    await expect(mangaEnableToggle).toHaveAttribute("aria-pressed", "false");

    await page.reload();
    await waitForServicesReady(page);
    await expect(
      page.getByRole("button", { name: "自炊マンガ の同期を有効にする" }),
    ).toHaveAttribute("aria-pressed", "false");

    // 論理削除と再追加復活
    await page.getByRole("button", { name: "自炊マンガ を削除" }).click();
    await expect(page.getByTestId("sync-root-item")).toHaveCount(2);

    await page.getByTestId("folder-input").fill("mock-folder-manga");
    await page.getByTestId("add-folder-by-input-button").click();
    await expect(page.getByTestId("sync-root-item")).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "自炊マンガ の同期を無効にする" }),
    ).toHaveAttribute("aria-pressed", "true");

    expect(pageErrors).toEqual([]);
  });

  test("(3) DiagnosticsSection診断ログ一覧・クリップボードコピー・[REDACTED]マスキング・ログクリア", async ({
    context,
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);

    // ya29.* アクセストークンを含む例外を意図的に発生させる
    const secretToken = "ya29.it-secret-leak-guard-98765";
    await page.evaluate((token) => {
      window.__exLibrisServices?.mockGoogleAuthAdapter?.queueNextFailure(
        "signIn",
        new Error(`OAuth failed with Bearer ${token}`),
      );
    }, secretToken);

    await page.getByTestId("google-signin-button").click();
    await expect(page.getByTestId("google-auth-error")).toContainText(
      "Bearer [REDACTED]",
    );
    await expect(page.getByTestId("google-auth-error")).not.toContainText(
      secretToken,
    );

    const diagnosticsSection = page.getByTestId("diagnostics-section");
    await expect(page.getByTestId("diagnostics-log-list")).toBeVisible();
    await expect(diagnosticsSection).toContainText("[REDACTED]");
    await expect(diagnosticsSection).not.toContainText(secretToken);

    // クリップボードコピーと [REDACTED] 検証
    await page.getByTestId("settings-copy-diagnostics-button").click();
    await expect(
      page.getByTestId("settings-copy-diagnostics-status"),
    ).toHaveText("診断ログをコピーしました");
    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboardText).toContain("# ExLibris Diagnostic Report");
    expect(clipboardText).toContain("[REDACTED]");
    expect(clipboardText).not.toContain(secretToken);

    // ログクリア
    await page.getByTestId("settings-clear-diagnostics-button").click();
    await expect(page.getByTestId("diagnostics-entry-count")).toHaveText(
      "0 件",
    );
    await expect(page.getByTestId("diagnostics-empty")).toBeVisible();
    await expect(page.getByTestId("diagnostics-log-item")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("(4) SCR-01 DriveSetupBanner状態遷移(unauthenticated→no-roots→ready)とTR-03/TR-09スクロール位置復元", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.setViewportSize({ width: 375, height: 420 });
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    // ローカル閲覧履歴を 1 件作成して十分な高さを確保
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("open-local-zip-button").click(),
    ]);
    await chooser.setFiles({
      name: "scroll-check.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(buildSyntheticThreePageArchive()),
    });
    await expect(page).toHaveURL(/\/read\/local$/);
    await expect(page.getByTestId("reader-canvas")).toHaveAttribute(
      "data-webgl-status",
      "ready",
    );
    await page.getByTestId("reader-canvas").click();
    await page.getByTestId("reader-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByTestId("recent-local-history-section"),
    ).toBeVisible();

    // unauthenticated バナー状態でスクロールし、バナー CTA クリック(TR-03) -> /settings
    const setupBanner = page.getByTestId("drive-setup-banner");
    await expect(setupBanner).toHaveAttribute(
      "data-banner-kind",
      "unauthenticated",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight - window.innerHeight,
        ),
      )
      .toBeGreaterThan(140);

    await page.evaluate(() => {
      window.scrollTo(0, 120);
    });
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(120);

    await page.getByTestId("drive-setup-banner-cta").click();
    await expect(page).toHaveURL(/\/settings$/);
    // 非ゼロ位置からの順方向遷移 (TR-03) で先頭初期化されること (R1-21)
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(0);

    // Google アカウント連携のみ行いルート未登録で戻る(TR-09) -> no-roots バナーへ遷移 & スクロール位置復元
    await page.getByTestId("google-signin-button").click();
    await expect(page.getByTestId("google-auth-status-badge")).toHaveText(
      "連携済み",
    );
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);

    await expect(page.getByTestId("drive-setup-banner")).toHaveAttribute(
      "data-banner-kind",
      "no-roots",
    );
    await expect(page.getByTestId("drive-setup-banner-email")).toHaveText(
      "reader@example.com",
    );
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(120);

    // no-roots バナー CTA から再遷移(TR-03)し、同期ルート追加後に戻る(TR-09) -> バナー非表示(ready) & スクロール位置復元
    await page.evaluate(() => {
      window.scrollTo(0, 100);
    });
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(100);

    await page.getByTestId("drive-setup-banner-cta").click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByTestId("folder-input").fill("mock-folder-comics");
    await page.getByTestId("add-folder-by-input-button").click();
    await expect(page.getByTestId("sync-root-item")).toHaveCount(1);

    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("drive-setup-banner")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(100);

    // 0px 位置保存後に /settings でスクロールしてから戻る (TR-09) -> 0px へ復元されること (R1-21)
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(0);
    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight - window.innerHeight,
        ),
      )
      .toBeGreaterThan(80);
    await page.evaluate(() => {
      window.scrollTo(0, 80);
    });
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(80);
    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect
      .poll(() => page.evaluate(() => Math.round(window.scrollY)))
      .toBe(0);

    // 登録済み全ルートフォルダを無効化して '/' へ戻ると no-roots バナーが再表示されること
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
    await expect(page.getByTestId("drive-setup-banner")).toHaveAttribute(
      "data-banner-kind",
      "no-roots",
    );
    await expect(page.getByTestId("drive-setup-banner-email")).toHaveText(
      "reader@example.com",
    );

    // 再度 1 件以上有効化して '/' へ戻るとバナーが非表示になること
    await page.getByTestId("drive-setup-banner-cta").click();
    await expect(page).toHaveURL(/\/settings$/);
    await page
      .getByRole("button", { name: "Comics の同期を有効にする" })
      .click();
    await expect(
      page.getByRole("button", { name: "Comics の同期を無効にする" }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("settings-back-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("drive-setup-banner")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("(5) ハードウェア戻る優先度1/2/4/5・モーダルEscape/背景閉鎖・ブラウザ履歴goBack/goForward", async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");
    await waitForServicesReady(page);
    await resetTestDatabase(page);

    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);

    // 優先度 1: 遅延サインイン処理中のハードウェア戻るは無効化される
    await page.evaluate(() => {
      window.__exLibrisServices?.mockGoogleAuthAdapter?.setOperationDelay(
        "signIn",
        400,
      );
    });
    await page.getByTestId("google-signin-button").click();
    await expect(page.getByTestId("settings-back-button")).toBeDisabled();
    await page.evaluate(async () => {
      const bridge = window.__exLibrisServices?.appBridge as
        MockAppBridge | undefined;
      await bridge?.triggerBackButton();
    });
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("google-auth-status-badge")).toHaveText(
      "連携済み",
    );
    await page.evaluate(() => {
      window.__exLibrisServices?.mockGoogleAuthAdapter?.setOperationDelay(
        "signIn",
        0,
      );
    });

    // 優先度 2: フォルダピッカーモーダル開中のハードウェア戻る -> モーダルのみ閉鎖し /settings に留まる
    await page.getByTestId("open-folder-picker-button").click();
    await expect(page.getByTestId("drive-folder-picker-modal")).toBeVisible();
    await page.evaluate(async () => {
      const bridge = window.__exLibrisServices?.appBridge as
        MockAppBridge | undefined;
      await bridge?.triggerBackButton();
    });
    await expect(page.getByTestId("drive-folder-picker-modal")).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings$/);

    // Escape キーによるモーダル閉鎖
    await page.getByTestId("open-folder-picker-button").click();
    await expect(page.getByTestId("drive-folder-picker-modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("drive-folder-picker-modal")).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings$/);

    // バックドロップクリックによるモーダル閉鎖
    await page.getByTestId("open-folder-picker-button").click();
    await expect(page.getByTestId("drive-folder-picker-modal")).toBeVisible();
    await page
      .getByTestId("folder-picker-backdrop")
      .click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId("drive-folder-picker-modal")).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings$/);

    // 優先度 4: モーダル閉鎖後の /settings でハードウェア戻る -> '/' へ復帰
    await page.evaluate(async () => {
      const bridge = window.__exLibrisServices?.appBridge as
        MockAppBridge | undefined;
      await bridge?.triggerBackButton();
    });
    await expect(page).toHaveURL(/\/$/);

    // 優先度 5: '/' 上のハードウェア戻る -> minimizeApp 呼び出し
    const minimizeCount = await page.evaluate(async () => {
      const bridge = window.__exLibrisServices?.appBridge as
        MockAppBridge | undefined;
      await bridge?.triggerBackButton();
      return bridge?.getMinimizeAppCallCount() ?? 0;
    });
    expect(minimizeCount).toBe(1);

    // ブラウザ履歴 goBack() / goForward() 追従確認
    await page.getByTestId("header-settings-button").click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/settings$/);

    expect(pageErrors).toEqual([]);
  });
});
