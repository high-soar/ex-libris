import { composeStories } from "@storybook/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import { useLocalReaderSessionStore } from "../reader/localReaderSessionStore";
import * as BookshelfHeaderModule from "./BookshelfHeader";
import * as stories from "./BookshelfPage.stories";
import * as LocalArchiveEmptyStateModule from "./LocalArchiveEmptyState";

const { Default, DragActive, UnsupportedExtensionError, CopiedFeedback } =
  composeStories(stories);

describe("BookshelfPage", () => {
  const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  const originalUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  let headerSpy: MockInstance<typeof BookshelfHeaderModule.BookshelfHeader>;
  let emptyStateSpy: MockInstance<
    typeof LocalArchiveEmptyStateModule.LocalArchiveEmptyState
  >;

  beforeEach(() => {
    diagnosticLogger.clear();
    useLocalReaderSessionStore.setState({ session: null });
    window.history.replaceState(null, "", "/");

    headerSpy = vi
      .spyOn(BookshelfHeaderModule, "BookshelfHeader")
      .mockImplementation(() => null);
    emptyStateSpy = vi
      .spyOn(LocalArchiveEmptyStateModule, "LocalArchiveEmptyState")
      .mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", originalUrl || "/");
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

  const getLatestHeaderProps =
    (): BookshelfHeaderModule.BookshelfHeaderProps => {
      const lastCall = headerSpy.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      return lastCall![0] as BookshelfHeaderModule.BookshelfHeaderProps;
    };

  const getLatestEmptyStateProps =
    (): LocalArchiveEmptyStateModule.LocalArchiveEmptyStateProps => {
      const lastCall = emptyStateSpy.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      return lastCall![0] as LocalArchiveEmptyStateModule.LocalArchiveEmptyStateProps;
    };

  it("全ストーリーを描画し直下の子コンポーネントへ初期Propsを正しく渡すこと", () => {
    const { unmount: unmountDefault } = render(<Default />);
    expect(getLatestHeaderProps()).toEqual({
      copyStatus: "idle",
      onCopyDiagnostics: expect.any(Function),
      onOpenLocalZip: expect.any(Function),
    });
    expect(getLatestEmptyStateProps()).toEqual({
      isDragActive: false,
      errorMessage: null,
      onOpenLocalZip: expect.any(Function),
    });
    unmountDefault();

    const { unmount: unmountDrag } = render(<DragActive />);
    expect(getLatestEmptyStateProps().isDragActive).toBe(true);
    unmountDrag();

    const { unmount: unmountError } = render(<UnsupportedExtensionError />);
    expect(getLatestEmptyStateProps().errorMessage).toBe(
      "対応形式は .zip または .cbz ファイルのみです",
    );
    unmountError();

    render(<CopiedFeedback />);
    expect(getLatestHeaderProps().copyStatus).toBe("copied");
  });

  it("ヘッダーおよび空本棚カードのonOpenLocalZipからSAF互換input要素のclickが呼ばれること (AC-BS-01)", () => {
    render(<Default />);

    const input = screen.getByTestId(
      "local-zip-file-input",
    ) as HTMLInputElement;
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute(
      "accept",
      ".zip,.cbz,application/zip,application/x-zip-compressed,application/x-cbz,application/octet-stream",
    );
    expect(input).toHaveClass("hidden");

    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});

    act(() => {
      getLatestHeaderProps().onOpenLocalZip();
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);

    act(() => {
      getLatestEmptyStateProps().onOpenLocalZip();
    });
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  it("有効な.zip/.cbzファイル選択でセッション格納・エラー解除・/read/local遷移とinput値リセットを行うこと (AC-BS-01, AC-BS-04)", () => {
    render(<UnsupportedExtensionError />);
    expect(getLatestEmptyStateProps().errorMessage).not.toBeNull();

    const input = screen.getByTestId(
      "local-zip-file-input",
    ) as HTMLInputElement;
    const valueSetterSpy = vi.spyOn(input, "value", "set");

    const cbzFile = new File(["cbz-bytes"], "Sample-Comic.CBZ", {
      type: "application/x-cbz",
    });

    fireEvent.change(input, { target: { files: [cbzFile] } });

    expect(valueSetterSpy).toHaveBeenCalledWith("");
    expect(getLatestEmptyStateProps().errorMessage).toBeNull();
    expect(useLocalReaderSessionStore.getState().session).toEqual({
      file: cbzFile,
      fileName: "Sample-Comic.CBZ",
      fileSize: cbzFile.size,
    });
    expect(window.location.pathname).toBe("/read/local");
  });

  it("大文字小文字を問わず.zipファイルでも有効として/read/localへ遷移し、空選択では何もしないこと (AC-BS-04)", () => {
    render(<Default />);
    const input = screen.getByTestId(
      "local-zip-file-input",
    ) as HTMLInputElement;

    // キャンセル（ファイル未選択）時は状態変化なし
    fireEvent.change(input, { target: { files: [] } });
    expect(useLocalReaderSessionStore.getState().session).toBeNull();
    expect(window.location.pathname).toBe("/");

    // .ZIP 選択時は遷移
    const zipFile = new File(["zip-bytes"], "archive.ZIP", {
      type: "application/zip",
    });
    fireEvent.change(input, { target: { files: [zipFile] } });
    expect(useLocalReaderSessionStore.getState().session?.fileName).toBe(
      "archive.ZIP",
    );
    expect(window.location.pathname).toBe("/read/local");
  });

  it("非対応拡張子のファイル選択時は遷移せずエラーメッセージ設定と警告ログ記録を行うこと (AC-BS-03)", () => {
    render(<Default />);
    const input = screen.getByTestId("local-zip-file-input");

    const pdfFile = new File(["pdf"], "document.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(input, { target: { files: [pdfFile] } });

    expect(useLocalReaderSessionStore.getState().session).toBeNull();
    expect(window.location.pathname).toBe("/");
    expect(getLatestEmptyStateProps().errorMessage).toBe(
      "対応形式は .zip または .cbz ファイルのみです",
    );
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          scope: "bookshelf",
          detail: "document.pdf",
        }),
      ]),
    );
  });

  it("ドラッグ＆ドロップ操作でisDragActive制御・関連ターゲット判定・ファイル検証を行うこと (AC-BS-02, AC-BS-03, AC-BS-04)", () => {
    render(<Default />);
    const main = screen.getByRole("main");
    const innerInput = screen.getByTestId("local-zip-file-input");

    // dragOver で preventDefault + isDragActive=true
    const dragOverEvent = new Event("dragover", {
      bubbles: true,
      cancelable: true,
    });
    fireEvent(main, dragOverEvent);
    expect(dragOverEvent.defaultPrevented).toBe(true);
    expect(getLatestEmptyStateProps().isDragActive).toBe(true);

    // 子要素への dragLeave では isDragActive を解除しない
    const dragLeaveToChildEvent = new Event("dragleave", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(dragLeaveToChildEvent, "relatedTarget", {
      value: innerInput,
    });
    fireEvent(main, dragLeaveToChildEvent);
    expect(getLatestEmptyStateProps().isDragActive).toBe(true);

    // 領域外（relatedTarget: null）への dragLeave で isDragActive=false
    const dragLeaveOutsideEvent = new Event("dragleave", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(dragLeaveOutsideEvent, "relatedTarget", {
      value: null,
    });
    fireEvent(main, dragLeaveOutsideEvent);
    expect(getLatestEmptyStateProps().isDragActive).toBe(false);

    // drop（files が空）で isDragActive=false のまま遷移しない
    fireEvent.dragOver(main);
    expect(getLatestEmptyStateProps().isDragActive).toBe(true);
    const emptyDropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(emptyDropEvent, "dataTransfer", {
      value: { files: [] },
    });
    fireEvent(main, emptyDropEvent);
    expect(emptyDropEvent.defaultPrevented).toBe(true);
    expect(getLatestEmptyStateProps().isDragActive).toBe(false);
    expect(window.location.pathname).toBe("/");

    // drop（非対応拡張子）でエラー表示
    const badDropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(badDropEvent, "dataTransfer", {
      value: {
        files: [new File(["png"], "cover.png", { type: "image/png" })],
      },
    });
    fireEvent(main, badDropEvent);
    expect(getLatestEmptyStateProps().errorMessage).toBe(
      "対応形式は .zip または .cbz ファイルのみです",
    );
    expect(window.location.pathname).toBe("/");

    // drop（有効 .zip）でセッション保存＆/read/local遷移
    const validZip = new File(["zip"], "manga-vol1.zip", {
      type: "application/zip",
    });
    const validDropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(validDropEvent, "dataTransfer", {
      value: { files: [validZip] },
    });
    fireEvent(main, validDropEvent);
    expect(useLocalReaderSessionStore.getState().session?.file).toBe(validZip);
    expect(window.location.pathname).toBe("/read/local");
  });

  it("診断ログコピー成功・API不在・拒否の3分岐に応じてcopyStatusを更新すること (AC-BS-05)", async () => {
    const writeTextSuccess = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextSuccess },
    });
    diagnosticLogger.warn("oauth", "テスト", "Bearer secret123");

    const { unmount } = render(<Default />);
    await act(async () => {
      await getLatestHeaderProps().onCopyDiagnostics();
    });
    expect(writeTextSuccess).toHaveBeenCalledTimes(1);
    expect(writeTextSuccess.mock.calls[0]?.[0]).toContain("Bearer [REDACTED]");
    expect(getLatestHeaderProps().copyStatus).toBe("copied");
    unmount();

    // navigator.clipboard 不在時 -> failed
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const { unmount: unmountMissing } = render(<Default />);
    await act(async () => {
      await getLatestHeaderProps().onCopyDiagnostics();
    });
    expect(getLatestHeaderProps().copyStatus).toBe("failed");
    unmountMissing();

    // writeText 拒否時 -> failed
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("Denied")),
      },
    });
    render(<Default />);
    await act(async () => {
      await getLatestHeaderProps().onCopyDiagnostics();
    });
    expect(getLatestHeaderProps().copyStatus).toBe("failed");
  });
});
