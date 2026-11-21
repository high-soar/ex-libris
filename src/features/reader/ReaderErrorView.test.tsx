import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as stories from "./ReaderErrorView.stories";

const {
  ArchiveError,
  PageDecodeError,
  PageDecodeErrorLeftSlot,
  PageDecodeErrorRightSlot,
} = composeStories(stories);

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

  it("PageDecodeErrorストーリーでpointer-events-none中央オーバーレイ内にdata-slot-position='center'付きページエラーカードを表示すること (AC-RD-07, AC-RD-12)", () => {
    const { unmount } = render(<PageDecodeError />);

    const card = screen.getByTestId("reader-page-error");
    expect(card).toHaveAttribute("role", "alert");
    expect(card).toHaveAttribute("data-slot-position", "center");
    expect(card).toHaveTextContent("ページ読込エラー");
    expect(card.textContent).not.toContain("(p.");
    expect(card).toHaveTextContent("ページの画像デコードに失敗しました");
    expect(card).toHaveTextContent("前後のページへ移動できます");
    expect(screen.getByTestId("reader-error-code")).toHaveTextContent(
      "DECODE_FAILED",
    );
    expect(card.parentElement).toHaveClass(
      "pointer-events-none",
      "inset-0",
      "p-6",
    );
    expect(screen.queryByTestId("reader-error-view")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("reader-error-back-button"),
    ).not.toBeInTheDocument();
    unmount();

    // errorCode 省略時はエラーコード表示を省略し、slotPosition デフォルトは center であること
    const { unmount: unmountNoCode } = render(
      <PageDecodeError errorCode={undefined} />,
    );
    expect(screen.queryByTestId("reader-error-code")).not.toBeInTheDocument();
    expect(screen.getByTestId("reader-page-error")).toHaveAttribute(
      "data-slot-position",
      "center",
    );
    unmountNoCode();

    // 明示的 slotPosition="center" + pageNumber 指定時も正しく表示されること
    render(<PageDecodeError slotPosition="center" pageNumber={1} />);
    const numberedCenterCard = screen.getByTestId("reader-page-error");
    expect(numberedCenterCard).toHaveAttribute("data-slot-position", "center");
    expect(numberedCenterCard).toHaveTextContent("ページ読込エラー (p.1)");
    expect(numberedCenterCard.parentElement).toHaveClass("inset-0", "p-6");
  });

  it("PageDecodeErrorLeftSlotおよびPageDecodeErrorRightSlotストーリーで片側半面スロット位置とページ番号を表示すること (AC-RD-12)", () => {
    const { unmount } = render(<PageDecodeErrorLeftSlot />);

    const leftCard = screen.getByTestId("reader-page-error");
    expect(leftCard).toHaveAttribute("role", "alert");
    expect(leftCard).toHaveAttribute("data-slot-position", "left");
    expect(leftCard).toHaveTextContent("ページ読込エラー (p.3)");
    expect(leftCard).toHaveTextContent("ページの画像デコードに失敗しました");
    expect(screen.getByTestId("reader-error-code")).toHaveTextContent(
      "DECODE_FAILED",
    );
    expect(leftCard.parentElement).toHaveClass(
      "pointer-events-none",
      "inset-y-0",
      "left-0",
      "w-1/2",
      "p-4",
    );
    unmount();

    render(<PageDecodeErrorRightSlot />);
    const rightCard = screen.getByTestId("reader-page-error");
    expect(rightCard).toHaveAttribute("role", "alert");
    expect(rightCard).toHaveAttribute("data-slot-position", "right");
    expect(rightCard).toHaveTextContent("ページ読込エラー (p.2)");
    expect(rightCard).toHaveTextContent("ファイルの読み込みに失敗しました");
    expect(screen.getByTestId("reader-error-code")).toHaveTextContent(
      "READ_ERROR",
    );
    expect(rightCard.parentElement).toHaveClass(
      "pointer-events-none",
      "inset-y-0",
      "right-0",
      "w-1/2",
      "p-4",
    );
  });
});
