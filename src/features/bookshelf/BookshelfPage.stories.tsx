import type { Meta, StoryObj } from "@storybook/react";
import { ServiceProvider } from "../../app/ServiceProvider";
import { RouterProvider } from "../../shared/router/RouterProvider";
import type { LocalReadingHistoryItem } from "../../storage/repositories/readingProgressRepository";
import { BookshelfPage } from "./BookshelfPage";

const RECENT_HISTORY_SAMPLE_ITEMS: readonly LocalReadingHistoryItem[] = [
  {
    targetKey: "local:sample-comic-vol01.cbz:15728640",
    rawFileName: "sample-comic-vol01.cbz",
    fileSize: 15_728_640,
    currentPageIndex: 11,
    totalPageCount: 24,
    readStatus: "reading",
    spreadPageOffset: 0,
    lastReadAt: 1_730_000_300_000,
  },
  {
    targetKey: "local:completed-oneshot.zip:524288",
    rawFileName: "completed-oneshot.zip",
    fileSize: 524_288,
    currentPageIndex: 19,
    totalPageCount: 20,
    readStatus: "completed",
    spreadPageOffset: 0,
    lastReadAt: 1_730_000_200_000,
  },
  {
    targetKey: "local:unread-short.cbz:512",
    rawFileName: "unread-short.cbz",
    fileSize: 512,
    currentPageIndex: 0,
    totalPageCount: 10,
    readStatus: "unread",
    spreadPageOffset: 0,
    lastReadAt: 1_730_000_100_000,
  },
];

const meta: Meta<typeof BookshelfPage> = {
  title: "Bookshelf/BookshelfPage",
  component: BookshelfPage,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    initialDriveSetupState: { kind: "ready" },
  },
  decorators: [
    (Story) => (
      <ServiceProvider>
        <RouterProvider initialPath="/">
          <Story />
        </RouterProvider>
      </ServiceProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof BookshelfPage>;

/** 仮想本棚ページ全体の初期表示状態 */
export const Default: Story = {
  name: "初期状態",
};

/** Google アカウント未連携時のセットアップ案内バナー表示状態 */
export const Unauthenticated: Story = {
  name: "Google未連携バナー状態",
  args: {
    initialDriveSetupState: { kind: "unauthenticated" },
  },
};

/** Google アカウント連携済み・有効ルートフォルダ0件時のセットアップ案内バナー表示状態 */
export const NoDriveRoots: Story = {
  name: "Driveフォルダ未設定バナー状態",
  args: {
    initialDriveSetupState: { kind: "no-roots", email: "reader@example.com" },
  },
};

/** ドラッグ＆ドロップ受け入れ中のハイライト状態 */
export const DragActive: Story = {
  name: "ドラッグ中のハイライト状態",
  args: {
    initialDragActive: true,
  },
};

/** 非対応拡張子選択時のエラー表示状態 */
export const UnsupportedExtensionError: Story = {
  name: "対応外拡張子エラー状態",
  args: {
    initialErrorMessage: "対応形式は .zip または .cbz ファイルのみです",
  },
};

/** 診断ログコピー完了時のフィードバック表示状態 */
export const CopiedFeedback: Story = {
  name: "診断ログコピー完了状態",
  args: {
    initialCopyStatus: "copied",
  },
};

/** ローカル閲覧履歴ありの本棚状態 */
export const WithRecentHistory: Story = {
  name: "閲覧履歴あり状態",
  args: {
    initialRecentHistory: RECENT_HISTORY_SAMPLE_ITEMS,
  },
};
