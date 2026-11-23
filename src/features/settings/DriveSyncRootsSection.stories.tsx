import type { Meta, StoryObj } from "@storybook/react";
import type { DriveSyncRootRecord } from "../../storage/types";
import { DriveSyncRootsSection } from "./DriveSyncRootsSection";

const MIXED_SYNC_ROOTS: readonly DriveSyncRootRecord[] = [
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
    folderName: "週刊誌・定期購読フォルダ（長期タイトル確認用のサンプル表示）",
    enabled: 0,
    addedAt: 1_730_000_100_000,
    updatedAt: 1_730_000_200_000,
    deletedAt: null,
  },
];

const meta: Meta<typeof DriveSyncRootsSection> = {
  title: "Settings/DriveSyncRootsSection",
  component: DriveSyncRootsSection,
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
    roots: [],
    isConnected: false,
    folderInput: "",
    isSubmitting: false,
    errorMessage: null,
    onChangeFolderInput: () => {},
    onAddFolderByInput: () => {},
    onOpenFolderPicker: () => {},
    onToggleRootEnabled: () => {},
    onRemoveRoot: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof DriveSyncRootsSection>;

/** Google アカウント未連携かつ登録済みフォルダ0件の状態 */
export const UnlinkedEmpty: Story = {
  name: "未連携（登録なし）",
};

/** Google アカウント未連携だが既存登録済みフォルダを保持表示している状態 */
export const UnlinkedWithExistingRoots: Story = {
  name: "未連携（既存フォルダあり）",
  args: {
    roots: MIXED_SYNC_ROOTS,
  },
};

/** Google アカウント連携済みかつ登録済みフォルダ0件の状態 */
export const ConnectedEmpty: Story = {
  name: "連携済み（登録なし）",
  args: {
    isConnected: true,
  },
};

/** Google アカウント連携済みで有効・無効フォルダが複数登録された状態 */
export const ConnectedWithMixedRoots: Story = {
  name: "連携済み（複数件・有効無効混在）",
  args: {
    isConnected: true,
    roots: MIXED_SYNC_ROOTS,
  },
};

/** フォルダ URL / ID 検証および保存の追加処理中状態 */
export const Submitting: Story = {
  name: "追加処理中",
  args: {
    isConnected: true,
    folderInput: "https://drive.google.com/drive/folders/3NewFolderId123",
    isSubmitting: true,
    roots: MIXED_SYNC_ROOTS,
  },
};

/** 不正なフォルダ URL / ID または API エラー時の警告表示状態 */
export const ErrorState: Story = {
  name: "エラー表示状態",
  args: {
    isConnected: true,
    folderInput: "https://drive.google.com/drive/folders/root",
    errorMessage:
      "マイドライブ直下（root）や無効なフォルダ URL / ID は登録できません。",
    roots: MIXED_SYNC_ROOTS,
  },
};
