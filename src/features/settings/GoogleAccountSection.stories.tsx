import type { Meta, StoryObj } from "@storybook/react";
import { GoogleAccountSection } from "./GoogleAccountSection";

const meta: Meta<typeof GoogleAccountSection> = {
  title: "Settings/GoogleAccountSection",
  component: GoogleAccountSection,
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
    status: "unlinked",
    email: null,
    errorMessage: null,
    onSignIn: () => {},
    onSignOut: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof GoogleAccountSection>;

/** Google アカウント未連携時の初期表示状態 */
export const Unlinked: Story = {
  name: "未連携",
};

/** Google OAuth 同意認可のログイン処理中状態 */
export const SigningIn: Story = {
  name: "ログイン処理中",
  args: {
    status: "signing-in",
  },
};

/** Google アカウント連携済み（メールアドレス表示）状態 */
export const Connected: Story = {
  name: "連携済み",
  args: {
    status: "connected",
    email: "reader@example.com",
  },
};

/** Google アカウントのログアウト（連携解除）処理中状態 */
export const SigningOut: Story = {
  name: "ログアウト処理中",
  args: {
    status: "signing-out",
    email: "reader@example.com",
  },
};

/** Google OAuth 認証エラー時のインライン警告表示状態 */
export const ErrorState: Story = {
  name: "エラー表示状態",
  args: {
    status: "unlinked",
    errorMessage:
      "Google アカウントとの通信に失敗しました。通信環境を確認して再試行してください。",
  },
};
