import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as stories from "./LocalArchiveEmptyState.stories";

const { Default, DragActive, UnsupportedExtensionError } =
  composeStories(stories);

describe("LocalArchiveEmptyState", () => {
  it("Defaultストーリーで空本棚カード・D&D案内・CTAボタンを表示しエラーを非表示にすること (AC-BS-01)", () => {
    render(<Default />);

    const card = screen.getByTestId("bookshelf-empty");
    expect(card).toHaveAttribute("data-drag-active", "false");
    expect(card).toHaveClass("border-slate-800", "bg-slate-900/60");
    expect(screen.getByTestId("open-local-zip-button")).toHaveTextContent(
      "ローカル ZIP を開く（.zip / .cbz）",
    );
    expect(card).toHaveTextContent("ドラッグ＆ドロップ");
    expect(screen.queryByTestId("local-zip-error")).not.toBeInTheDocument();
  });

  it("DragActiveストーリーでドラッグ中のハイライトスタイルとdata属性を表示すること (AC-BS-02)", () => {
    render(<DragActive />);

    const card = screen.getByTestId("bookshelf-empty");
    expect(card).toHaveAttribute("data-drag-active", "true");
    expect(card).toHaveClass("border-indigo-400", "bg-indigo-950/30");
  });

  it("UnsupportedExtensionErrorストーリーでrole='alert'付きのエラーメッセージを表示すること (AC-BS-03)", () => {
    render(<UnsupportedExtensionError />);

    const alert = screen.getByTestId("local-zip-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(
      "対応形式は .zip または .cbz ファイルのみです",
    );
  });

  it("CTAボタン押下でonOpenLocalZipが呼ばれること (AC-BS-01)", async () => {
    const user = userEvent.setup();
    const onOpenLocalZip = vi.fn();

    render(<Default onOpenLocalZip={onOpenLocalZip} />);

    await user.click(screen.getByTestId("open-local-zip-button"));
    expect(onOpenLocalZip).toHaveBeenCalledTimes(1);
  });
});
