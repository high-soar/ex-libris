import type { Meta, StoryObj } from "@storybook/react";
import type { DiagnosticEntry } from "../../diagnostics/types";
import { DiagnosticsSection } from "./DiagnosticsSection";

const FIXED_DIAGNOSTIC_ENTRIES: readonly DiagnosticEntry[] = [
  {
    id: 1,
    timestamp: "2026-11-23T00:00:00.000Z",
    level: "info",
    scope: "app",
    message: "ExLibris shell initialized",
  },
  {
    id: 2,
    timestamp: "2026-11-23T00:01:15.000Z",
    level: "warn",
    scope: "oauth",
    message: "一時的な通信失敗のためサイレント復元を保留しました",
    detail: "Authorization: Bearer [REDACTED]",
  },
  {
    id: 3,
    timestamp: "2026-11-23T00:02:30.000Z",
    level: "error",
    scope: "gdrive-folder",
    message: "フォルダ参照 API で 403 レート制限を検知しました",
    detail: "access_token=[REDACTED] | status=403",
  },
];

const meta: Meta<typeof DiagnosticsSection> = {
  title: "Settings/DiagnosticsSection",
  component: DiagnosticsSection,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <div className="mx-auto max-w-3xl">
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    entries: FIXED_DIAGNOSTIC_ENTRIES,
    copyStatus: "idle",
    onCopyDiagnostics: () => {},
    onClearDiagnostics: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof DiagnosticsSection>;

/** 固定タイムスタンプ・マスク済み診断ログ一覧の表示状態 */
export const WithEntries: Story = {
  name: "ログ一覧表示",
};

/** 診断ログが 0 件の空状態 */
export const Empty: Story = {
  name: "ログ空状態",
  args: {
    entries: [],
  },
};

/** 診断ログのクリップボードコピー完了状態 */
export const CopiedFeedback: Story = {
  name: "コピー完了状態",
  args: {
    copyStatus: "copied",
  },
};

/** 診断ログのクリップボードコピー失敗状態 */
export const CopyFailedFeedback: Story = {
  name: "コピー失敗状態",
  args: {
    copyStatus: "failed",
  },
};
