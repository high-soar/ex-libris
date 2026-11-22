import type { Meta, StoryObj } from "@storybook/react";
import { DEFAULT_SHADER_CORRECTION_PARAMS } from "../../webgl/shaderParams";
import { ReaderShaderSheet } from "./ReaderShaderSheet";

const ADJUSTED_PARAMS = {
  sharpness: 0.45,
  whitePoint: 0.92,
  blackPoint: 0.08,
  gamma: 0.85,
} as const;

const meta: Meta<typeof ReaderShaderSheet> = {
  title: "Reader/ReaderShaderSheet",
  component: ReaderShaderSheet,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="relative h-screen w-screen bg-black">
        <Story />
      </div>
    ),
  ],
  args: {
    isOpen: true,
    shaderParams: DEFAULT_SHADER_CORRECTION_PARAMS,
    saveStatus: "idle",
    onChangeShaderParams: () => {},
    onReset: () => {},
    onSaveDefault: () => {},
    onClose: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ReaderShaderSheet>;

/** 画質補正ボトムシートの初期ニュートラル表示状態 */
export const Default: Story = {
  name: "画質補正シート（初期値）",
};

/** 4種類の画質補正パラメータを調整済みの表示状態 */
export const CustomAdjusted: Story = {
  name: "画質補正シート（補正適用中）",
  args: {
    shaderParams: ADJUSTED_PARAMS,
  },
};

/** デフォルト設定の保存完了メッセージ表示状態 */
export const SavedFeedback: Story = {
  name: "画質補正シート（保存完了メッセージ）",
  args: {
    shaderParams: ADJUSTED_PARAMS,
    saveStatus: "saved",
  },
};

/** デフォルト設定の保存失敗アラート表示状態 */
export const SaveErrorFeedback: Story = {
  name: "画質補正シート（保存失敗メッセージ）",
  args: {
    shaderParams: ADJUSTED_PARAMS,
    saveStatus: "error",
  },
};

/** ボトムシート非表示状態（フルスクリーン閲覧中） */
export const Closed: Story = {
  name: "画質補正シート（非表示）",
  tags: ["skip-vrt"],
  args: {
    isOpen: false,
  },
};
