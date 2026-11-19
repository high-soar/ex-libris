import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { APP_NAME, APP_VERSION } from "../../shared/constants/app";
import * as stories from "./BookshelfHeader.stories";

const { Default, CopiedFeedback, CopyFailedFeedback } = composeStories(stories);

describe("BookshelfHeader", () => {
  it("Defaultストーリーでタイトル・バージョン・ローカルZIP・診断コピーボタンを表示し初期ステータスを非表示にすること (AC-BS-01, AC-BS-05)", () => {
    render(<Default />);

    expect(screen.getByRole("banner")).toHaveClass(
      "border-b",
      "border-slate-800",
      "bg-slate-900/90",
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      APP_NAME,
    );
    expect(screen.getByTestId("app-version")).toHaveTextContent(
      `v${APP_VERSION}`,
    );
    expect(
      screen.getByTestId("header-open-local-zip-button"),
    ).toHaveTextContent("ローカル ZIP を開く");
    expect(screen.getByTestId("copy-diagnostics-button")).toHaveTextContent(
      "診断ログをコピー",
    );
    expect(
      screen.queryByTestId("copy-diagnostics-status"),
    ).not.toBeInTheDocument();
  });

  it("CopiedFeedbackおよびCopyFailedFeedbackストーリーで適切なroleとメッセージを表示すること (AC-BS-05)", () => {
    const { unmount } = render(<CopiedFeedback />);
    const copiedStatus = screen.getByTestId("copy-diagnostics-status");
    expect(copiedStatus).toHaveAttribute("role", "status");
    expect(copiedStatus).toHaveTextContent("診断ログをコピーしました");
    unmount();

    render(<CopyFailedFeedback />);
    const failedStatus = screen.getByTestId("copy-diagnostics-status");
    expect(failedStatus).toHaveAttribute("role", "alert");
    expect(failedStatus).toHaveTextContent(
      "クリップボードへコピーできませんでした",
    );
  });

  it("ローカルZIPを開くボタンおよび診断ログをコピーボタン押下で対応コールバックが呼ばれること (AC-BS-01, AC-BS-05)", async () => {
    const user = userEvent.setup();
    const onOpenLocalZip = vi.fn();
    const onCopyDiagnostics = vi.fn();

    render(
      <Default
        onOpenLocalZip={onOpenLocalZip}
        onCopyDiagnostics={onCopyDiagnostics}
      />,
    );

    await user.click(screen.getByTestId("header-open-local-zip-button"));
    expect(onOpenLocalZip).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("copy-diagnostics-button"));
    expect(onCopyDiagnostics).toHaveBeenCalledTimes(1);
  });
});
