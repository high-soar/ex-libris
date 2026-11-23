import type { Meta, StoryObj } from "@storybook/react";
import { SettingsHeader } from "./SettingsHeader";

const meta: Meta<typeof SettingsHeader> = {
  title: "Settings/SettingsHeader",
  component: SettingsHeader,
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
    isBackBlocked: false,
    onBack: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SettingsHeader>;

/** 設定画面ヘッダーの初期表示状態 */
export const Default: Story = {
  name: "初期状態",
};

/** OAuth 認証や保存処理中に戻る操作がブロックされた状態 */
export const BackBlocked: Story = {
  name: "戻るブロック中状態",
  args: {
    isBackBlocked: true,
  },
};
