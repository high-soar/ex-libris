import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useState } from "react";
import { ServiceProvider } from "../../app/ServiceProvider";
import { RouterProvider } from "../../shared/router/RouterProvider";
import { ReaderPage } from "./ReaderPage";
import { useLocalReaderSessionStore } from "./localReaderSessionStore";

const STORY_ARCHIVE_FILE = new File(
  ["storybook-mock-comic"],
  "sample-comic-vol01.cbz",
  { type: "application/x-cbz" },
);

function StorySessionDecorator({ children }: { readonly children: ReactNode }) {
  useState(() => {
    useLocalReaderSessionStore.getState().openLocalFile(STORY_ARCHIVE_FILE);
    return true;
  });

  return (
    <ServiceProvider>
      <RouterProvider initialPath="/read/local">{children}</RouterProvider>
    </ServiceProvider>
  );
}

const meta: Meta<typeof ReaderPage> = {
  title: "Reader/ReaderPage",
  component: ReaderPage,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <StorySessionDecorator>
        <Story />
      </StorySessionDecorator>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ReaderPage>;

/** 初期没入状態（HUD非表示・WebGL2キャンバス描画待機中） */
export const FullscreenCanvas: Story = {
  name: "フルスクリーン待機状態（HUD非表示）",
  args: {
    initialSnapshot: {
      totalPages: 24,
      currentPageIndex: 0,
      frame: null,
      isOpening: false,
      isHudOpen: false,
    },
  },
};

/** 中央タップ等で上下オーバーレイHUDを開いた状態 */
export const HudOpen: Story = {
  name: "HUD表示状態（中間ページ）",
  args: {
    initialSnapshot: {
      totalPages: 24,
      currentPageIndex: 11,
      frame: null,
      isOpening: false,
      isHudOpen: true,
    },
  },
};

/** アーカイブ破損等の致命的エラー表示状態 */
export const ArchiveError: Story = {
  name: "アーカイブエラー状態",
  args: {
    initialSnapshot: {
      totalPages: 0,
      archiveError: {
        code: "CORRUPT_ZIP",
        message: "ZIP ファイルが破損しているため開けませんでした",
      },
      isOpening: false,
      isHudOpen: false,
    },
  },
};

/** 個別ページのみデコード失敗した状態（前後めくり継続可能） */
export const PageError: Story = {
  name: "個別ページエラー状態",
  args: {
    initialSnapshot: {
      totalPages: 24,
      currentPageIndex: 2,
      frame: {
        status: "error",
        pageIndex: 2,
        epoch: 1,
        errorCode: "DECODE_FAILED",
        message: "ページの画像デコードに失敗しました",
      },
      isOpening: false,
      isHudOpen: false,
    },
  },
};
