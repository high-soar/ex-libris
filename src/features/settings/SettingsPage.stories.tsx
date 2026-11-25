import type { Meta, StoryObj } from "@storybook/react";
import { ServiceProvider } from "../../app/ServiceProvider";
import type {
  DiagnosticEntry,
  DiagnosticLogger,
} from "../../diagnostics/types";
import { RouterProvider } from "../../shared/router/RouterProvider";
import { APP_NAME, APP_VERSION } from "../../shared/constants/app";
import type { DriveSyncRootRecord } from "../../storage/types";
import { SettingsPage } from "./SettingsPage";

const FIXED_REPORT_TIME = new Date("2026-11-23T00:05:00.000Z");

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
    message: "一時的な通信障害のためGoogleセッション復元を保留しました",
    detail: "Authorization: Bearer [REDACTED]",
  },
  {
    id: 3,
    timestamp: "2026-11-23T00:02:30.000Z",
    level: "error",
    scope: "gdrive-folder",
    message: "フォルダ参照 API で 403 レート制限を検知しました",
    detail: "token=[REDACTED] | status=403",
  },
];

const SAMPLE_SYNC_ROOTS: readonly DriveSyncRootRecord[] = [
  {
    folderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
    folderName: "自炊マンガ（完結）",
    enabled: 1,
    addedAt: 1_730_000_000_000,
    updatedAt: 1_730_000_000_000,
    deletedAt: null,
  },
  {
    folderId: "2ZyXwVuTsRqPoNmLkJiHgFeDcBa",
    folderName: "週刊誌・定期購読フォルダ",
    enabled: 0,
    addedAt: 1_730_000_100_000,
    updatedAt: 1_730_000_200_000,
    deletedAt: null,
  },
];

function createDeterministicStoryLogger(
  seedEntries: readonly DiagnosticEntry[],
): DiagnosticLogger {
  const entries = [...seedEntries];
  return {
    log: (level, scope, message, detail) => {
      const entry: DiagnosticEntry = {
        id: entries.length + 1,
        timestamp: FIXED_REPORT_TIME.toISOString(),
        level,
        scope,
        message,
        ...(detail !== undefined ? { detail } : {}),
      };
      entries.push(entry);
      return entry;
    },
    info: (scope, message, detail) => ({
      id: entries.length + 1,
      timestamp: FIXED_REPORT_TIME.toISOString(),
      level: "info",
      scope,
      message,
      ...(detail !== undefined ? { detail } : {}),
    }),
    warn: (scope, message, detail) => ({
      id: entries.length + 1,
      timestamp: FIXED_REPORT_TIME.toISOString(),
      level: "warn",
      scope,
      message,
      ...(detail !== undefined ? { detail } : {}),
    }),
    error: (scope, message, detail) => ({
      id: entries.length + 1,
      timestamp: FIXED_REPORT_TIME.toISOString(),
      level: "error",
      scope,
      message,
      ...(detail !== undefined ? { detail } : {}),
    }),
    getEntries: () => [...entries],
    clear: () => {
      entries.length = 0;
    },
    formatReport: (now = FIXED_REPORT_TIME) => {
      const header = [
        `# ${APP_NAME} Diagnostic Report`,
        `version: v${APP_VERSION}`,
        `generatedAt: ${now.toISOString()}`,
        `entries: ${entries.length}`,
      ];
      if (entries.length === 0) {
        return [...header, "(no diagnostic entries)"].join("\n");
      }
      const lines = entries.map((entry) => {
        const base = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}`;
        return entry.detail !== undefined ? `${base} | ${entry.detail}` : base;
      });
      return [...header, ...lines].join("\n");
    },
  };
}

const meta: Meta<typeof SettingsPage> = {
  title: "Settings/SettingsPage",
  component: SettingsPage,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <ServiceProvider>
        <RouterProvider initialPath="/settings">
          <Story />
        </RouterProvider>
      </ServiceProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SettingsPage>;

/** Google アカウント未連携・登録フォルダ0件の初期表示状態 */
export const Unlinked: Story = {
  name: "未連携（初期状態）",
  args: {
    logger: createDeterministicStoryLogger(FIXED_DIAGNOSTIC_ENTRIES),
    initialSnapshot: {
      authState: {
        status: "unlinked",
        email: null,
      },
      syncRoots: [],
      diagnosticEntries: FIXED_DIAGNOSTIC_ENTRIES,
      copyStatus: "idle",
    },
  },
};

/** OAuth サインイン処理中で戻る操作がブロックされた状態 */
export const AuthProcessing: Story = {
  name: "認証処理中（戻るブロック）",
  args: {
    logger: createDeterministicStoryLogger(FIXED_DIAGNOSTIC_ENTRIES),
    initialSnapshot: {
      authState: {
        status: "signing-in",
        email: null,
      },
      syncRoots: [],
      diagnosticEntries: FIXED_DIAGNOSTIC_ENTRIES,
      copyStatus: "idle",
    },
  },
};

/** Google アカウント連携済み・ルートフォルダ複数登録済み状態 */
export const ConnectedWithRoots: Story = {
  name: "連携済み（登録フォルダあり）",
  args: {
    logger: createDeterministicStoryLogger(FIXED_DIAGNOSTIC_ENTRIES),
    initialSnapshot: {
      authState: {
        status: "connected",
        email: "reader@example.com",
      },
      syncRoots: SAMPLE_SYNC_ROOTS,
      diagnosticEntries: FIXED_DIAGNOSTIC_ENTRIES,
      copyStatus: "copied",
    },
  },
};

/** アプリ内 Drive フォルダ選択モーダルを展開している状態 */
export const FolderPickerOpen: Story = {
  name: "フォルダ選択モーダル展開",
  args: {
    logger: createDeterministicStoryLogger(FIXED_DIAGNOSTIC_ENTRIES),
    initialSnapshot: {
      authState: {
        status: "connected",
        email: "reader@example.com",
      },
      syncRoots: SAMPLE_SYNC_ROOTS,
      diagnosticEntries: FIXED_DIAGNOSTIC_ENTRIES,
      pickerState: {
        isOpen: true,
        breadcrumbs: [
          { id: "root", name: "マイドライブ" },
          { id: "mock-folder-comics", name: "Comics" },
        ],
        folders: [
          { id: "mock-folder-action", name: "アクション" },
          { id: "mock-folder-scifi", name: "SF" },
        ],
        nextPageToken: "next-page-token-2",
      },
    },
  },
};

/** 認証失敗および不正フォルダ URL/ID エラー表示状態 */
export const ErrorState: Story = {
  name: "エラー表示状態",
  args: {
    logger: createDeterministicStoryLogger(FIXED_DIAGNOSTIC_ENTRIES),
    initialSnapshot: {
      authState: {
        status: "unlinked",
        email: null,
        errorMessage:
          "Google アカウントとの通信に失敗しました。通信環境を確認して再試行してください。",
      },
      syncRoots: SAMPLE_SYNC_ROOTS,
      folderInput: "https://drive.google.com/drive/folders/root",
      syncRootsErrorMessage:
        "マイドライブ直下（root）や無効なフォルダ URL / ID は登録できません。",
      diagnosticEntries: FIXED_DIAGNOSTIC_ENTRIES,
      copyStatus: "failed",
    },
  },
};
