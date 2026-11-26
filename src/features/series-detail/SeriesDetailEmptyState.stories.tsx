import type { Meta, StoryObj } from "@storybook/react";
import { SeriesDetailEmptyState } from "./SeriesDetailEmptyState";

const meta: Meta<typeof SeriesDetailEmptyState> = {
  title: "SeriesDetail/SeriesDetailEmptyState",
  component: SeriesDetailEmptyState,
  parameters: {
    layout: "padded",
  },
  args: {
    onBack: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SeriesDetailEmptyState>;

/** 未存在・論理削除・有効巻0件時の案内ビュー */
export const Default: Story = {
  name: "未存在・有効巻0件案内",
};
