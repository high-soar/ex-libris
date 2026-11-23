import type { Meta, StoryObj } from "@storybook/react";
import { App } from "./App";
import type { DiagnosticEntry } from "./diagnostics/types";

const FIXED_SETTINGS_ENTRIES: readonly DiagnosticEntry[] = [
  {
    id: 1,
    timestamp: "2026-11-23T00:00:00.000Z",
    level: "info",
    scope: "app",
    message: "ExLibris shell initialized",
  },
  {
    id: 2,
    timestamp: "2026-11-23T00:01:00.000Z",
    level: "info",
    scope: "oauth",
    message: "Googleアカウント連携を確認しました",
  },
];

const meta: Meta<typeof App> = {
  title: "Shell/App",
  component: App,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof App>;

/** 初期起動時の空本棚シェル表示 */
export const Default: Story = {
  name: "初期状態（空の本棚シェル）",
  args: {
    initialDriveSetupState: { kind: "ready" },
  },
};

/** 診断ログのクリップボードコピー成功時のフィードバック表示 */
export const CopiedFeedback: Story = {
  name: "診断ログコピー完了状態",
  args: {
    initialCopyStatus: "copied",
    initialDriveSetupState: { kind: "ready" },
  },
};

/** クリップボードAPI非対応または拒否時のエラー通知表示 */
export const CopyFailedFeedback: Story = {
  name: "診断ログコピー失敗状態",
  args: {
    initialCopyStatus: "failed",
    initialDriveSetupState: { kind: "ready" },
  },
};

/** 設定画面（/settings）表示 */
export const SettingsRoute: Story = {
  name: "設定画面（/settings）",
  args: {
    initialPath: "/settings",
    initialSettingsSnapshot: {
      authState: {
        status: "connected",
        email: "reader@example.com",
        errorMessage: null,
      },
      syncRoots: [
        {
          folderId: "mock-folder-comics",
          folderName: "Comics",
          enabled: 1,
          addedAt: 1_730_000_000_000,
          updatedAt: 1_730_000_000_000,
          deletedAt: null,
        },
      ],
      diagnosticEntries: FIXED_SETTINGS_ENTRIES,
      copyStatus: "idle",
    },
  },
};

/** ローカルセッション不在で /read/local へアクセスした際に '/' へ安全フォールバックする状態（TR-10） */
export const ReaderLocalFallback: Story = {
  name: "ローカルリーダーセッション不在フォールバック（/）",
  args: {
    initialPath: "/read/local",
    initialDriveSetupState: { kind: "ready" },
  },
};
