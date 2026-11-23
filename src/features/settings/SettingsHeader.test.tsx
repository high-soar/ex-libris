import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../../shared/constants/app";
import { SettingsHeader } from "./SettingsHeader";
import * as stories from "./SettingsHeader.stories";

const { Default, BackBlocked } = composeStories(stories);

describe("SettingsHeader", () => {
  it("Defaultストーリーでセーフエリア対応ヘッダー・戻るボタン・見出し・バージョンバッジを表示すること (AC-ST-01, AC-ST-06)", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();

    render(<Default onBack={onBack} />);

    const header = screen.getByRole("banner");
    expect(header).toHaveClass(
      "border-b",
      "border-slate-800",
      "bg-slate-900/90",
    );
    expect(header).toHaveStyle({
      paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))",
    });
    expect(header.style.paddingTop).toContain("safe-area-inset-top");

    const backButton = screen.getByTestId("settings-back-button");
    expect(backButton).toHaveTextContent("本棚へ戻る");
    expect(backButton).toBeEnabled();
    expect(backButton).toHaveClass("touch-manipulation");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "ストレージ連携・設定",
    );
    expect(screen.getByTestId("settings-app-version")).toHaveTextContent(
      `v${APP_VERSION}`,
    );

    await user.click(backButton);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("BackBlockedストーリーでは戻るボタンが非活性となり押下してもonBackが呼ばれないこと (AC-ST-06)", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();

    render(<BackBlocked onBack={onBack} />);

    const backButton = screen.getByTestId("settings-back-button");
    expect(backButton).toBeDisabled();

    await user.click(backButton);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("isBackBlocked省略時はデフォルトfalseとして戻るボタンが有効であること (AC-ST-06)", () => {
    render(<SettingsHeader onBack={vi.fn()} />);

    expect(screen.getByTestId("settings-back-button")).toBeEnabled();
  });
});
