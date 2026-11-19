import type { Meta, StoryObj } from "@storybook/react";
import { ReaderCanvas } from "./ReaderCanvas";

const meta: Meta<typeof ReaderCanvas> = {
  title: "WebGL/ReaderCanvas",
  component: ReaderCanvas,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="h-screen w-screen bg-black">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ReaderCanvas>;

/** 待機中の純黒 WebGL2 キャンバス表示 */
export const Default: Story = {
  name: "待機状態（純黒キャンバス）",
  args: {
    frame: null,
  },
};

/** WebGL2 非対応環境またはコンテキスト取得不可時のエラー状態 */
export const UnsupportedEnvironment: Story = {
  name: "WebGL2 非対応状態",
  args: {
    frame: null,
    getWebGL2Context: () => null,
  },
};
