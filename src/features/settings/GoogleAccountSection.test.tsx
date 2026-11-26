import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GoogleAccountSection } from "./GoogleAccountSection";
import * as stories from "./GoogleAccountSection.stories";

const { Unlinked, SigningIn, Connected, SigningOut, ErrorState } =
  composeStories(stories);

describe("GoogleAccountSection", () => {
  it("Unlinkedストーリーで未連携バッジ・drive.readonly説明・ログインボタンを表示しクリックでonSignInを呼ぶこと (AC-ST-01)", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();

    render(<Unlinked onSignIn={onSignIn} />);

    const section = screen.getByTestId("google-account-section");
    expect(section).toHaveClass("bg-slate-900", "border", "border-slate-800");
    expect(screen.getByTestId("google-auth-status-badge")).toHaveTextContent(
      "未連携",
    );
    expect(section).toHaveTextContent("drive.readonly");

    const signInButton = screen.getByTestId("google-signin-button");
    expect(signInButton).toHaveTextContent("Google でログイン");
    expect(signInButton).toBeEnabled();
    expect(signInButton).toHaveClass("touch-manipulation");

    expect(
      screen.queryByTestId("google-account-email"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("google-signout-button"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("google-auth-error")).not.toBeInTheDocument();

    await user.click(signInButton);
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("SigningInストーリーで処理中ラベル・スピナーを表示しログインボタンを非活性化すること (AC-ST-01)", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();

    render(<SigningIn onSignIn={onSignIn} />);

    expect(screen.getByTestId("google-auth-status-badge")).toHaveTextContent(
      "処理中",
    );
    expect(screen.getByTestId("google-auth-spinner")).toBeInTheDocument();
    expect(screen.getByTestId("google-auth-processing")).toHaveAttribute(
      "role",
      "status",
    );

    const signInButton = screen.getByTestId("google-signin-button");
    expect(signInButton).toBeDisabled();
    expect(signInButton).toHaveTextContent("ログイン処理中");

    await user.click(signInButton);
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("Connectedストーリーで連携済みバッジ・メールアドレス・ログアウトボタンを表示しクリックでonSignOutを呼ぶこと (AC-ST-01)", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();

    const { unmount } = render(<Connected onSignOut={onSignOut} />);

    expect(screen.getByTestId("google-auth-status-badge")).toHaveTextContent(
      "連携済み",
    );
    expect(screen.getByTestId("google-account-email")).toHaveTextContent(
      "reader@example.com",
    );

    const signOutButton = screen.getByTestId("google-signout-button");
    expect(signOutButton).toHaveTextContent("連携を解除（ログアウト）");
    expect(signOutButton).toBeEnabled();
    expect(signOutButton).toHaveClass("touch-manipulation");
    expect(
      screen.queryByTestId("google-signin-button"),
    ).not.toBeInTheDocument();

    await user.click(signOutButton);
    expect(onSignOut).toHaveBeenCalledTimes(1);
    unmount();

    // email が null で連携済みの制限環境でも安全にフォールバック表示すること
    render(
      <GoogleAccountSection
        status="connected"
        email={null}
        errorMessage={null}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    expect(screen.getByTestId("google-account-email")).toHaveTextContent(
      "Google Drive 連携済み",
    );
  });

  it("SigningOutストーリーで処理中ラベル・スピナーを表示しログアウトボタンを非活性化すること (AC-ST-01)", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();

    render(<SigningOut onSignOut={onSignOut} />);

    expect(screen.getByTestId("google-auth-status-badge")).toHaveTextContent(
      "処理中",
    );
    expect(screen.getByTestId("google-auth-spinner")).toBeInTheDocument();
    expect(screen.getByTestId("google-auth-processing")).toHaveAttribute(
      "role",
      "status",
    );

    const signOutButton = screen.getByTestId("google-signout-button");
    expect(signOutButton).toBeDisabled();
    expect(signOutButton).toHaveTextContent("ログアウト処理中");

    await user.click(signOutButton);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("ErrorStateストーリーでrole='alert'付きエラー表示を行い、空文字エラー時はアラートを表示しないこと (AC-ST-01)", () => {
    const { unmount } = render(<ErrorState />);

    const alert = screen.getByTestId("google-auth-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("Google アカウントとの通信に失敗しました");
    unmount();

    render(
      <GoogleAccountSection
        status="unlinked"
        email={null}
        errorMessage=""
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("google-auth-error")).not.toBeInTheDocument();
  });

  it("Drive同期実行中(isSyncing=true)はログアウトボタンをdisabledで排他保護すること (AC-ST-08)", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();

    render(
      <GoogleAccountSection
        status="connected"
        email="reader@example.com"
        errorMessage={null}
        isSyncing={true}
        onSignIn={vi.fn()}
        onSignOut={onSignOut}
      />,
    );

    const signOutButton = screen.getByTestId("google-signout-button");
    expect(signOutButton).toBeDisabled();
    await user.click(signOutButton);
    expect(onSignOut).not.toHaveBeenCalled();
  });
});
