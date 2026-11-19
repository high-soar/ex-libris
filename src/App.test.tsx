import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diagnosticLogger } from "./diagnostics/diagnosticLogger";
import { APP_VERSION } from "./shared/constants/app";
import * as stories from "./App.stories";

const { Default, CopiedFeedback, CopyFailedFeedback } = composeStories(stories);

describe("App", () => {
  const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );

  beforeEach(() => {
    diagnosticLogger.clear();
    delete window.__exLibrisServices;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalClipboardDescriptor) {
      Object.defineProperty(
        navigator,
        "clipboard",
        originalClipboardDescriptor,
      );
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("Defaultストーリーを描画しサービス初期化完了フラグとバージョンを設定すること", () => {
    render(<Default />);

    expect(screen.getByTestId("app-root")).toHaveAttribute(
      "data-app-ready",
      "true",
    );
    expect(screen.getByTestId("app-version")).toHaveTextContent(
      `v${APP_VERSION}`,
    );
    expect(screen.getByTestId("bookshelf-empty")).toBeVisible();
    expect(window.__exLibrisServices?.isReady).toBe(true);
  });

  it("CopiedFeedbackおよびCopyFailedFeedbackストーリーを描画できること", () => {
    const { unmount } = render(<CopiedFeedback />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "診断ログをコピーしました",
    );
    unmount();

    render(<CopyFailedFeedback />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "クリップボードへコピーできませんでした",
    );
  });

  it("診断ログをコピー押下時にクリップボードへ機密マスク済みレポートを書き込むこと", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    diagnosticLogger.warn("oauth", "トークン検証", "Bearer secretTokenValue");

    render(<Default />);
    await user.click(screen.getByTestId("copy-diagnostics-button"));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("Bearer [REDACTED]");
    expect(screen.getByRole("status")).toHaveTextContent(
      "診断ログをコピーしました",
    );
  });

  it("navigator.clipboardが存在しない場合にエラー通知を表示すること", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    render(<Default />);
    await user.click(screen.getByTestId("copy-diagnostics-button"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "クリップボードへコピーできませんでした",
    );
  });

  it("clipboard.writeTextが拒否された場合にエラー通知を表示すること", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("Permission denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<Default />);
    await user.click(screen.getByTestId("copy-diagnostics-button"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "クリップボードへコピーできませんでした",
    );
  });
});
