import { composeStories } from "@storybook/react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as stories from "./DiagnosticsSection.stories";

const { WithEntries, Empty, CopiedFeedback, CopyFailedFeedback } =
  composeStories(stories);

describe("DiagnosticsSection", () => {
  it("WithEntriesストーリーで件数・最新順のログ一覧・全レベル・detail有無・操作ボタンを表示しコールバックを呼ぶこと (AC-ST-05)", async () => {
    const user = userEvent.setup();
    const onCopyDiagnostics = vi.fn();
    const onClearDiagnostics = vi.fn();

    render(
      <WithEntries
        onCopyDiagnostics={onCopyDiagnostics}
        onClearDiagnostics={onClearDiagnostics}
      />,
    );

    const section = screen.getByTestId("diagnostics-section");
    expect(section).toHaveClass("bg-slate-900", "border", "border-slate-800");
    expect(screen.getByTestId("diagnostics-entry-count")).toHaveTextContent(
      "3 件",
    );
    expect(screen.queryByTestId("diagnostics-empty")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-copy-diagnostics-status"),
    ).not.toBeInTheDocument();

    const list = screen.getByTestId("diagnostics-log-list");
    const items = within(list).getAllByTestId("diagnostics-log-item");
    expect(items).toHaveLength(3);

    // 新しいエントリ（id=3）から逆順に確認しやすい順序で並んでいること
    expect(items[0]).toHaveTextContent("2026-11-23T00:02:30.000Z");
    expect(items[0]).toHaveTextContent("ERROR");
    expect(items[0]).toHaveTextContent("[gdrive-folder]");
    expect(items[0]).toHaveTextContent("access_token=[REDACTED]");

    expect(items[1]).toHaveTextContent("WARN");
    expect(items[1]).toHaveTextContent("Bearer [REDACTED]");

    expect(items[2]).toHaveTextContent("INFO");
    expect(items[2]).toHaveTextContent("ExLibris shell initialized");

    const copyBtn = screen.getByTestId("settings-copy-diagnostics-button");
    const clearBtn = screen.getByTestId("settings-clear-diagnostics-button");
    expect(copyBtn).toHaveTextContent("診断ログをコピー");
    expect(copyBtn).toBeEnabled();
    expect(copyBtn).toHaveClass("touch-manipulation");

    expect(clearBtn).toHaveTextContent("ログをクリア");
    expect(clearBtn).toBeEnabled();
    expect(clearBtn).toHaveClass("touch-manipulation");

    await user.click(copyBtn);
    expect(onCopyDiagnostics).toHaveBeenCalledTimes(1);

    await user.click(clearBtn);
    expect(onClearDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("Emptyストーリーで0件表示・空メッセージ・クリアボタン非活性かつコピーのみ実行可能であること (AC-ST-05)", async () => {
    const user = userEvent.setup();
    const onCopyDiagnostics = vi.fn();
    const onClearDiagnostics = vi.fn();

    render(
      <Empty
        onCopyDiagnostics={onCopyDiagnostics}
        onClearDiagnostics={onClearDiagnostics}
      />,
    );

    expect(screen.getByTestId("diagnostics-entry-count")).toHaveTextContent(
      "0 件",
    );
    expect(screen.getByTestId("diagnostics-empty")).toBeVisible();
    expect(
      screen.queryByTestId("diagnostics-log-list"),
    ).not.toBeInTheDocument();

    const copyBtn = screen.getByTestId("settings-copy-diagnostics-button");
    const clearBtn = screen.getByTestId("settings-clear-diagnostics-button");
    expect(copyBtn).toBeEnabled();
    expect(clearBtn).toBeDisabled();

    await user.click(clearBtn);
    expect(onClearDiagnostics).not.toHaveBeenCalled();

    await user.click(copyBtn);
    expect(onCopyDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("CopiedFeedbackおよびCopyFailedFeedbackストーリーで適切なrole付きコピー結果を表示すること (AC-ST-05)", () => {
    const { unmount } = render(<CopiedFeedback />);
    const copiedStatus = screen.getByTestId("settings-copy-diagnostics-status");
    expect(copiedStatus).toHaveAttribute("role", "status");
    expect(copiedStatus).toHaveTextContent("診断ログをコピーしました");
    unmount();

    render(<CopyFailedFeedback />);
    const failedStatus = screen.getByTestId("settings-copy-diagnostics-status");
    expect(failedStatus).toHaveAttribute("role", "alert");
    expect(failedStatus).toHaveTextContent(
      "クリップボードへコピーできませんでした",
    );
  });
});
