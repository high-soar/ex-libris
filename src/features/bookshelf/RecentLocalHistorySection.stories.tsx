import type { Meta, StoryObj } from "@storybook/react";
import type { LocalReadingHistoryItem } from "../../storage/repositories/readingProgressRepository";
import { RecentLocalHistorySection } from "./RecentLocalHistorySection";

const SINGLE_READING_ITEMS: readonly LocalReadingHistoryItem[] = [
  {
    targetKey: "local:sample-comic-vol01.cbz:15728640",
    rawFileName: "sample-comic-vol01.cbz",
    fileSize: 15_728_640,
    currentPageIndex: 11,
    totalPageCount: 24,
    readStatus: "reading",
    spreadPageOffset: 0,
    lastReadAt: 1_730_000_000_000,
  },
];

const MIXED_STATUS_ITEMS: readonly LocalReadingHistoryItem[] = [
  {
    targetKey:
      "local:とても長いタイトルの自炊マンガ合本_第01巻-第03巻_高解像度スキャン.cbz:1610612736",
    rawFileName:
      "とても長いタイトルの自炊マンガ合本_第01巻-第03巻_高解像度スキャン.cbz",
    fileSize: 1_610_612_736,
    currentPageIndex: 19,
    totalPageCount: 40,
    readStatus: "reading",
    spreadPageOffset: 1,
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
  {
    targetKey: "local:medium-archive.zip:25690112",
    rawFileName: "medium-archive.zip",
    fileSize: 25_690_112,
    currentPageIndex: 2,
    totalPageCount: 12,
    readStatus: "reading",
    spreadPageOffset: 0,
    lastReadAt: 1_730_000_050_000,
  },
];

const meta: Meta<typeof RecentLocalHistorySection> = {
  title: "Bookshelf/RecentLocalHistorySection",
  component: RecentLocalHistorySection,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    items: SINGLE_READING_ITEMS,
    onReopenLocalFile: () => {},
    onDeleteItem: () => {},
    onClearAll: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof RecentLocalHistorySection>;

/** 履歴0件時の非表示状態 */
export const Empty: Story = {
  name: "履歴なし（非表示）",
  tags: ["skip-vrt"],
  args: {
    items: [],
  },
};

/** 読書中のローカル閲覧履歴が1件ある表示状態 */
export const SingleReading: Story = {
  name: "最近のローカル閲覧履歴（読書中1件）",
  args: {
    items: SINGLE_READING_ITEMS,
  },
};

/** 読書中・読了・未読および各種ファイルサイズ・長大ファイル名混在時の表示状態 */
export const MixedStatuses: Story = {
  name: "最近のローカル閲覧履歴（複数ステータス混在）",
  args: {
    items: MIXED_STATUS_ITEMS,
  },
};
