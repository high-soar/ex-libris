import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as stories from "./ReaderErrorView.stories";

const { ArchiveError, PageDecodeError } = composeStories(stories);

describe("ReaderErrorView", () => {
  it("ArchiveErrorストーリーで全画面エラーパネル・コード表示・ホームへ戻るボタンを表示し押下で通知すること (AC-RD-06)", async () => {
    const user = userEvent.setup();
    const onBackToHome = vi.fn();

    const { unmount } = render(<ArchiveError onBackToHome={onBackToHome} />);

    const panel = screen.getByTestId("reader-error-view");
    expect(panel).toHaveAttribute("role", "alert");
    expect(panel).toHaveTextContent(
      "ZIP ファイルが破損しているため開けませんでした",
    );
    expect(screen.getByTestId("reader-error-code")).toHaveTextContent(
      "CORRUPT_ZIP",
    );

    await user.click(screen.getByTestId("reader-error-back-button"));
    expect(onBackToHome).toHaveBeenCalledTimes(1);
    unmount();

    // errorCode 省略時はエラーコード表示を省略すること
    render(<ArchiveError errorCode={undefined} message="WebGL2 初期化失敗" />);
    expect(screen.queryByTestId("reader-error-code")).not.toBeInTheDocument();
  });

  it("PageDecodeErrorストーリーでpointer-events-noneオーバーレイ内にページエラーカードと前後移動案内を表示すること (AC-RD-07)", () => {
    const { unmount } = render(<PageDecodeError />);

    const card = screen.getByTestId("reader-page-error");
    expect(card).toHaveAttribute("role", "alert");
    expect(card).toHaveTextContent("ページの画像デコードに失敗しました");
    expect(card).toHaveTextContent("前後のページへ移動できます");
    expect(screen.getByTestId("reader-error-code")).toHaveTextContent(
      "DECODE_FAILED",
    );
    expect(card.parentElement).toHaveClass("pointer-events-none");
    expect(screen.queryByTestId("reader-error-view")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("reader-error-back-button"),
    ).not.toBeInTheDocument();
    unmount();

    // errorCode 省略時はエラーコード表示を省略すること
    render(<PageDecodeError errorCode={undefined} />);
    expect(screen.queryByTestId("reader-error-code")).not.toBeInTheDocument();
  });
});
