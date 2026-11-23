import type { Meta, StoryObj } from "@storybook/react";
import type { DriveFolderMetadata } from "../../providers/gdrive/types";
import { DriveFolderPickerModal } from "./DriveFolderPickerModal";
import type { DriveFolderBreadcrumbItem } from "./types";

const ROOT_BREADCRUMBS: readonly DriveFolderBreadcrumbItem[] = [
  { id: "root", name: "マイドライブ" },
];

const SUB_BREADCRUMBS: readonly DriveFolderBreadcrumbItem[] = [
  { id: "root", name: "マイドライブ" },
  { id: "folder-comics", name: "Comics" },
  { id: "folder-manga", name: "自炊マンガ" },
];

const SAMPLE_FOLDERS: readonly DriveFolderMetadata[] = [
  { id: "folder-action", name: "アクション" },
  { id: "folder-scifi", name: "SF・ファンタジー" },
  { id: "folder-weekly", name: "週刊誌アーカイブ" },
];

const meta: Meta<typeof DriveFolderPickerModal> = {
  title: "Settings/DriveFolderPickerModal",
  component: DriveFolderPickerModal,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <Story />
      </div>
    ),
  ],
  args: {
    isOpen: true,
    breadcrumbs: ROOT_BREADCRUMBS,
    folders: SAMPLE_FOLDERS,
    nextPageToken: null,
    isLoading: false,
    isLoadingMore: false,
    isSaving: false,
    errorMessage: null,
    onNavigateBreadcrumb: () => {},
    onOpenFolder: () => {},
    onSelectFolder: () => {},
    onConfirmCurrentFolder: () => {},
    onLoadMore: () => {},
    onClose: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof DriveFolderPickerModal>;

/** マイドライブ最上位階層（全件同期防止のため現在の階層確定は不可） */
export const RootDirectory: Story = {
  name: "ルート階層（確定不可）",
};

/** サブ階層表示（パンくず戻り・このフォルダを追加・ページネーション有効） */
export const SubdirectoryWithPagination: Story = {
  name: "サブ階層（ページネーションあり）",
  args: {
    breadcrumbs: SUB_BREADCRUMBS,
    nextPageToken: "next-page-token-2",
  },
};

/** フォルダ一覧を取得中のローディング状態 */
export const Loading: Story = {
  name: "読込中",
  args: {
    breadcrumbs: SUB_BREADCRUMBS,
    folders: [],
    isLoading: true,
  },
};

/** 選択フォルダを保存中の状態（バックドロップ・閉じるボタン操作をブロック） */
export const Saving: Story = {
  name: "保存中（閉鎖不可）",
  args: {
    breadcrumbs: SUB_BREADCRUMBS,
    nextPageToken: "next-page-token-2",
    isSaving: true,
  },
};

/** サブフォルダ取得または保存に失敗したエラー表示状態 */
export const ErrorState: Story = {
  name: "エラー状態",
  args: {
    breadcrumbs: SUB_BREADCRUMBS,
    folders: [],
    errorMessage: "Google Drive フォルダ一覧の取得に失敗しました。",
  },
};

/** サブフォルダが 0 件の空ディレクトリ表示状態 */
export const EmptySubdirectory: Story = {
  name: "空状態",
  args: {
    breadcrumbs: SUB_BREADCRUMBS,
    folders: [],
  },
};

/** モーダル非表示状態（設定画面の通常表示時） */
export const Closed: Story = {
  name: "非表示",
  tags: ["skip-vrt"],
  args: {
    isOpen: false,
  },
};
