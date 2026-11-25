import { composeStories } from "@storybook/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, type ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { ServiceProvider } from "../../app/ServiceProvider";
import type {
  AuthSessionListener,
  GoogleAuthBridge,
  GoogleAuthSession,
} from "../../bridges/oauth/types";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import { RouterProvider } from "../../shared/router/RouterProvider";
import { resetTestDb } from "../../storage/db";
import type { DriveSyncRootsRepository } from "../../storage/repositories/driveSyncRootsRepository";
import {
  type LocalReadingHistoryItem,
  RECENT_LOCAL_HISTORY_DEFAULT_LIMIT,
  type ReadingProgressRepository,
} from "../../storage/repositories/readingProgressRepository";
import * as BookshelfHeaderModule from "./BookshelfHeader";
import { BookshelfPage, type BookshelfPageProps } from "./BookshelfPage";
import * as stories from "./BookshelfPage.stories";
import * as DriveSetupBannerModule from "./DriveSetupBanner";
import * as LocalArchiveEmptyStateModule from "./LocalArchiveEmptyState";
import * as RecentLocalHistorySectionModule from "./RecentLocalHistorySection";
import {
  resetBookshelfUiState,
  useBookshelfUiStateStore,
} from "./bookshelfUiStateStore";
import { useLocalReaderSessionStore } from "../reader/localReaderSessionStore";

const {
  Default,
  Unauthenticated,
  NoDriveRoots,
  DragActive,
  UnsupportedExtensionError,
  CopiedFeedback,
  WithRecentHistory,
} = composeStories(stories);

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createSampleHistoryItem(
  overrides: Partial<LocalReadingHistoryItem> = {},
): LocalReadingHistoryItem {
  return {
    targetKey: "local:sample-comic.cbz:1024",
    rawFileName: "sample-comic.cbz",
    fileSize: 1024,
    currentPageIndex: 3,
    totalPageCount: 20,
    readStatus: "reading",
    spreadPageOffset: 0,
    lastReadAt: 1_730_000_000_000,
    ...overrides,
  };
}

function createMockReadingProgressRepo(
  overrides: Partial<ReadingProgressRepository> = {},
): ReadingProgressRepository {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    listRecentLocal: vi.fn(async () => []),
    clearLocal: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createMockGoogleAuthBridge(
  overrides: Partial<GoogleAuthBridge> = {},
): GoogleAuthBridge & {
  emitSession: (session: GoogleAuthSession | null) => void;
} {
  const listeners = new Set<AuthSessionListener>();
  return {
    getCachedSession: vi.fn(() => null),
    getSession: vi.fn(async () => null),
    signIn: vi.fn(),
    signOut: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => "ya29.mock"),
    subscribeSession: vi.fn((listener: AuthSessionListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    emitSession: (session: GoogleAuthSession | null) => {
      for (const listener of [...listeners]) {
        listener(session);
      }
    },
    ...overrides,
  };
}

function createMockDriveSyncRootsRepo(
  overrides: Partial<DriveSyncRootsRepository> = {},
): DriveSyncRootsRepository {
  return {
    listActive: vi.fn(async () => []),
    countEnabled: vi.fn(async () => 0),
    upsertRoot: vi.fn(),
    setEnabled: vi.fn(async () => null),
    removeRoot: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("BookshelfPage", () => {
  const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  const originalUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  let headerSpy: MockInstance<typeof BookshelfHeaderModule.BookshelfHeader>;
  let driveBannerSpy: MockInstance<
    typeof DriveSetupBannerModule.DriveSetupBanner
  >;
  let emptyStateSpy: MockInstance<
    typeof LocalArchiveEmptyStateModule.LocalArchiveEmptyState
  >;
  let recentHistorySpy: MockInstance<
    typeof RecentLocalHistorySectionModule.RecentLocalHistorySection
  >;

  beforeEach(async () => {
    await resetTestDb();
    diagnosticLogger.clear();
    useLocalReaderSessionStore.setState({ session: null });
    resetBookshelfUiState();
    window.history.replaceState(null, "", "/");

    headerSpy = vi
      .spyOn(BookshelfHeaderModule, "BookshelfHeader")
      .mockImplementation(() => null);
    driveBannerSpy = vi
      .spyOn(DriveSetupBannerModule, "DriveSetupBanner")
      .mockImplementation(() => null);
    emptyStateSpy = vi
      .spyOn(LocalArchiveEmptyStateModule, "LocalArchiveEmptyState")
      .mockImplementation(() => null);
    recentHistorySpy = vi
      .spyOn(RecentLocalHistorySectionModule, "RecentLocalHistorySection")
      .mockImplementation(() => null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDb();
    resetBookshelfUiState();
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

  const getLatestDriveBannerProps =
    (): DriveSetupBannerModule.DriveSetupBannerProps => {
      const lastCall = driveBannerSpy.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      return lastCall![0] as DriveSetupBannerModule.DriveSetupBannerProps;
    };

  const getLatestEmptyStateProps =
    (): LocalArchiveEmptyStateModule.LocalArchiveEmptyStateProps => {
      const lastCall = emptyStateSpy.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      return lastCall![0] as LocalArchiveEmptyStateModule.LocalArchiveEmptyStateProps;
    };

  const getLatestRecentHistoryProps =
    (): RecentLocalHistorySectionModule.RecentLocalHistorySectionProps => {
      const lastCall = recentHistorySpy.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      return lastCall![0] as RecentLocalHistorySectionModule.RecentLocalHistorySectionProps;
    };

  async function renderAndFlush(element: ReactElement) {
    const rendered = render(element);
    await act(async () => {
      await flushMicrotasks();
    });
    return rendered;
  }

  async function renderWithProgressRepo(
    readingProgressRepo: ReadingProgressRepository,
    props: BookshelfPageProps = {},
  ) {
    return renderAndFlush(
      <ServiceProvider readingProgressRepo={readingProgressRepo}>
        <RouterProvider initialPath="/">
          <BookshelfPage {...props} />
        </RouterProvider>
      </ServiceProvider>,
    );
  }

  it("全ストーリーを描画し直下の子コンポーネントへ初期Propsを正しく渡すこと", async () => {
    const { unmount: unmountDefault } = await renderAndFlush(<Default />);
    expect(screen.getByRole("main")).toHaveClass("flex-col", "gap-6");
    expect(getLatestHeaderProps()).toEqual({
      copyStatus: "idle",
      onCopyDiagnostics: expect.any(Function),
      onOpenLocalZip: expect.any(Function),
      onOpenSettings: expect.any(Function),
    });
    expect(getLatestDriveBannerProps()).toEqual({
      state: { kind: "ready" },
      onOpenSettings: expect.any(Function),
    });
    expect(getLatestEmptyStateProps()).toEqual({
      isDragActive: false,
      errorMessage: null,
      onOpenLocalZip: expect.any(Function),
    });
    expect(getLatestRecentHistoryProps()).toEqual({
      items: [],
      onReopenLocalFile: expect.any(Function),
      onDeleteItem: expect.any(Function),
      onClearAll: expect.any(Function),
    });
    unmountDefault();

    const { unmount: unmountUnauth } = await renderAndFlush(
      <Unauthenticated />,
    );
    expect(getLatestDriveBannerProps().state).toEqual({
      kind: "unauthenticated",
    });
    unmountUnauth();

    const { unmount: unmountNoRoots } = await renderAndFlush(<NoDriveRoots />);
    expect(getLatestDriveBannerProps().state).toEqual({
      kind: "no-roots",
      email: "reader@example.com",
    });
    unmountNoRoots();

    const { unmount: unmountDrag } = await renderAndFlush(<DragActive />);
    expect(getLatestEmptyStateProps().isDragActive).toBe(true);
    unmountDrag();

    const { unmount: unmountError } = await renderAndFlush(
      <UnsupportedExtensionError />,
    );
    expect(getLatestEmptyStateProps().errorMessage).toBe(
      "対応形式は .zip または .cbz ファイルのみです",
    );
    unmountError();

    const { unmount: unmountCopied } = await renderAndFlush(<CopiedFeedback />);
    expect(getLatestHeaderProps().copyStatus).toBe("copied");
    unmountCopied();

    await renderAndFlush(<WithRecentHistory />);
    expect(getLatestRecentHistoryProps().items).toHaveLength(3);
  });

  it("ヘッダーおよび空本棚カードのonOpenLocalZipからSAF互換input要素のclickが呼ばれること (AC-BS-01)", async () => {
    await renderAndFlush(<Default />);

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

  it("有効な.zip/.cbzファイル選択でセッション格納・エラー解除・/read/local遷移とinput値リセットを行うこと (AC-BS-01, AC-BS-04)", async () => {
    await renderAndFlush(<UnsupportedExtensionError />);
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

  it("大文字小文字を問わず.zipファイルでも有効として/read/localへ遷移し、空選択では何もしないこと (AC-BS-04)", async () => {
    await renderAndFlush(<Default />);
    const input = screen.getByTestId(
      "local-zip-file-input",
    ) as HTMLInputElement;

    // キャンセル（ファイル未選択・files null）時は状態変化なし
    fireEvent.change(input, { target: { files: null } });
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

  it("非対応拡張子のファイル選択時は遷移せずエラーメッセージ設定と警告ログ記録を行うこと (AC-BS-03)", async () => {
    await renderAndFlush(<Default />);
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

  it("ドラッグ＆ドロップ操作でisDragActive制御・関連ターゲット判定・ファイル検証を行うこと (AC-BS-02, AC-BS-03, AC-BS-04)", async () => {
    await renderAndFlush(<Default />);
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

    // drop（files 不在 / 空）で isDragActive=false のまま遷移しない
    fireEvent.dragOver(main);
    expect(getLatestEmptyStateProps().isDragActive).toBe(true);
    const missingFilesDropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(missingFilesDropEvent, "dataTransfer", {
      value: {},
    });
    fireEvent(main, missingFilesDropEvent);
    expect(getLatestEmptyStateProps().isDragActive).toBe(false);
    expect(window.location.pathname).toBe("/");

    fireEvent.dragOver(main);
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

    const { unmount } = await renderAndFlush(<Default />);
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
    const { unmount: unmountMissing } = await renderAndFlush(<Default />);
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
    await renderAndFlush(<Default />);
    await act(async () => {
      await getLatestHeaderProps().onCopyDiagnostics();
    });
    expect(getLatestHeaderProps().copyStatus).toBe("failed");
  });

  it("マウント時にlistRecentLocal(10)で閲覧履歴を読み込み、initialRecentHistory指定時スキップ・失敗時warn・アンマウント時無視すること (AC-BS-06)", async () => {
    // 1. 通常マウント成功
    const loadedItems = [
      createSampleHistoryItem({
        targetKey: "local:book1.cbz:100",
        rawFileName: "book1.cbz",
      }),
      createSampleHistoryItem({
        targetKey: "local:book2.zip:200",
        rawFileName: "book2.zip",
        readStatus: "completed",
      }),
    ];
    const repoOk = createMockReadingProgressRepo({
      listRecentLocal: vi.fn(async () => loadedItems),
    });
    const { unmount: unmountOk } = await renderWithProgressRepo(repoOk);
    expect(repoOk.listRecentLocal).toHaveBeenCalledWith(
      RECENT_LOCAL_HISTORY_DEFAULT_LIMIT,
    );
    expect(getLatestRecentHistoryProps().items).toEqual(loadedItems);
    unmountOk();

    // 2. initialRecentHistory 指定時は listRecentLocal を呼ばず即反映
    const snapshotItems = [
      createSampleHistoryItem({ targetKey: "local:snap.cbz:50" }),
    ];
    const repoSkipped = createMockReadingProgressRepo();
    const { unmount: unmountSnap } = await renderWithProgressRepo(repoSkipped, {
      initialRecentHistory: snapshotItems,
    });
    expect(repoSkipped.listRecentLocal).not.toHaveBeenCalled();
    expect(getLatestRecentHistoryProps().items).toEqual(snapshotItems);
    unmountSnap();

    // 3. listRecentLocal 失敗時 (Error & non-Error): warn ログのみ記録し空維持
    const repoErr1 = createMockReadingProgressRepo({
      listRecentLocal: vi.fn(async () => {
        throw new Error("load failed error");
      }),
    });
    const { unmount: unmountErr1 } = await renderWithProgressRepo(repoErr1);
    expect(getLatestRecentHistoryProps().items).toEqual([]);
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          scope: "bookshelf",
          detail: "load failed error",
        }),
      ]),
    );
    unmountErr1();

    diagnosticLogger.clear();
    const repoErr2 = createMockReadingProgressRepo({
      listRecentLocal: vi.fn(async () => {
        throw "raw load failure";
      }),
    });
    const { unmount: unmountErr2 } = await renderWithProgressRepo(repoErr2);
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          scope: "bookshelf",
          detail: "raw load failure",
        }),
      ]),
    );
    unmountErr2();

    // 4. アンマウント後の resolve / reject を無視する
    diagnosticLogger.clear();
    const staleResolve = createDeferred<readonly LocalReadingHistoryItem[]>();
    const repoStale1 = createMockReadingProgressRepo({
      listRecentLocal: vi.fn(() => staleResolve.promise),
    });
    const { unmount: unmountStale1 } = render(
      <ServiceProvider readingProgressRepo={repoStale1}>
        <RouterProvider initialPath="/">
          <BookshelfPage />
        </RouterProvider>
      </ServiceProvider>,
    );
    unmountStale1();
    await act(async () => {
      staleResolve.resolve(loadedItems);
      await flushMicrotasks();
    });
    expect(diagnosticLogger.getEntries()).toEqual([]);

    const staleReject = createDeferred<readonly LocalReadingHistoryItem[]>();
    const repoStale2 = createMockReadingProgressRepo({
      listRecentLocal: vi.fn(() => staleReject.promise),
    });
    const { unmount: unmountStale2 } = render(
      <ServiceProvider readingProgressRepo={repoStale2}>
        <RouterProvider initialPath="/">
          <BookshelfPage />
        </RouterProvider>
      </ServiceProvider>,
    );
    unmountStale2();
    await act(async () => {
      staleReject.reject(new Error("late load reject"));
      await flushMicrotasks();
    });
    expect(diagnosticLogger.getEntries()).toEqual([]);
  });

  it("履歴再選択・個別削除・一括クリアが動作し、失敗時warnおよびアンマウント後完了無視を行うこと (AC-BS-06)", async () => {
    const itemA = createSampleHistoryItem({
      targetKey: "local:book-a.cbz:100",
      rawFileName: "book-a.cbz",
    });
    const itemB = createSampleHistoryItem({
      targetKey: "local:book-b.zip:200",
      rawFileName: "book-b.zip",
    });
    const repo = createMockReadingProgressRepo();
    const { unmount: unmountMain } = await renderWithProgressRepo(repo, {
      initialRecentHistory: [itemA, itemB],
    });

    // onReopenLocalFile -> ファイルピッカー起動
    const input = screen.getByTestId(
      "local-zip-file-input",
    ) as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});
    act(() => {
      getLatestRecentHistoryProps().onReopenLocalFile();
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // onDeleteItem 成功 -> 対象アイテムのみ除外
    await act(async () => {
      await getLatestRecentHistoryProps().onDeleteItem(itemA.targetKey);
    });
    expect(repo.delete).toHaveBeenCalledWith(itemA.targetKey);
    expect(getLatestRecentHistoryProps().items).toEqual([itemB]);

    // onDeleteItem 失敗 (Error / non-Error) -> 項目維持 + warn
    vi.mocked(repo.delete).mockRejectedValueOnce(new Error("delete err"));
    await act(async () => {
      await getLatestRecentHistoryProps().onDeleteItem(itemB.targetKey);
    });
    expect(getLatestRecentHistoryProps().items).toEqual([itemB]);
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          scope: "bookshelf",
          detail: expect.stringContaining("delete err"),
        }),
      ]),
    );

    vi.mocked(repo.delete).mockRejectedValueOnce("raw delete failure");
    await act(async () => {
      await getLatestRecentHistoryProps().onDeleteItem(itemB.targetKey);
    });
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          scope: "bookshelf",
          detail: expect.stringContaining("raw delete failure"),
        }),
      ]),
    );

    // onClearAll 失敗 (Error / non-Error) -> 項目維持 + warn
    vi.mocked(repo.clearLocal).mockRejectedValueOnce(new Error("clear err"));
    await act(async () => {
      await getLatestRecentHistoryProps().onClearAll();
    });
    expect(getLatestRecentHistoryProps().items).toEqual([itemB]);
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          scope: "bookshelf",
          detail: expect.stringContaining("clear err"),
        }),
      ]),
    );

    vi.mocked(repo.clearLocal).mockRejectedValueOnce("raw clear failure");
    await act(async () => {
      await getLatestRecentHistoryProps().onClearAll();
    });
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          scope: "bookshelf",
          detail: expect.stringContaining("raw clear failure"),
        }),
      ]),
    );

    // onClearAll 成功 -> []
    await act(async () => {
      await getLatestRecentHistoryProps().onClearAll();
    });
    expect(repo.clearLocal).toHaveBeenCalled();
    expect(getLatestRecentHistoryProps().items).toEqual([]);
    unmountMain();

    // delete / clearLocal のアンマウント後 resolve / reject 無視
    diagnosticLogger.clear();
    const deleteResolve = createDeferred<void>();
    const deleteReject = createDeferred<void>();
    const clearResolve = createDeferred<void>();
    const clearReject = createDeferred<void>();
    const staleRepo = createMockReadingProgressRepo({
      delete: vi
        .fn()
        .mockImplementationOnce(() => deleteResolve.promise)
        .mockImplementationOnce(() => deleteReject.promise),
      clearLocal: vi
        .fn()
        .mockImplementationOnce(() => clearResolve.promise)
        .mockImplementationOnce(() => clearReject.promise),
    });
    const { unmount: unmountStaleOps } = await renderWithProgressRepo(
      staleRepo,
      { initialRecentHistory: [itemA] },
    );
    const ops = getLatestRecentHistoryProps();
    const pendingDelete1 = ops.onDeleteItem(itemA.targetKey);
    const pendingDelete2 = ops.onDeleteItem(itemA.targetKey);
    const pendingClear1 = ops.onClearAll();
    const pendingClear2 = ops.onClearAll();
    unmountStaleOps();
    await act(async () => {
      deleteResolve.resolve(undefined);
      deleteReject.reject(new Error("late delete fail"));
      clearResolve.resolve(undefined);
      clearReject.reject(new Error("late clear fail"));
      await Promise.all([
        pendingDelete1,
        pendingDelete2,
        pendingClear1,
        pendingClear2,
      ]);
    });
    expect(diagnosticLogger.getEntries()).toEqual([]);
  });

  it("ヘッダーおよびバナーのonOpenSettingsでスクロール位置を保存して/settingsへ遷移し、復帰時(StrictMode含む)にwindow.scrollToで復元すること (TR-03, TR-09, AC-BS-07)", async () => {
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 185,
    });

    const { unmount: unmount1 } = await renderAndFlush(
      <ServiceProvider readingProgressRepo={createMockReadingProgressRepo()}>
        <RouterProvider initialPath="/">
          <BookshelfPage initialDriveSetupState={{ kind: "unauthenticated" }} />
        </RouterProvider>
      </ServiceProvider>,
    );

    // 1. ヘッダー設定ボタン -> scrollY 保存 + /settings 遷移
    act(() => {
      getLatestHeaderProps().onOpenSettings?.();
    });
    expect(useBookshelfUiStateStore.getState().scrollY).toBe(185);
    expect(window.location.pathname).toBe("/settings");
    unmount1();

    // 2. バナー CTA -> scrollY 更新 + /settings 遷移
    window.history.replaceState(null, "", "/");
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 240,
    });
    const { unmount: unmount2 } = await renderAndFlush(
      <ServiceProvider readingProgressRepo={createMockReadingProgressRepo()}>
        <RouterProvider initialPath="/">
          <BookshelfPage initialDriveSetupState={{ kind: "unauthenticated" }} />
        </RouterProvider>
      </ServiceProvider>,
    );
    act(() => {
      getLatestDriveBannerProps().onOpenSettings();
    });
    expect(useBookshelfUiStateStore.getState().scrollY).toBe(240);
    expect(window.location.pathname).toBe("/settings");
    unmount2();

    // 3. / 復帰時（StrictMode + 非同期取得後）に window.scrollTo(0, 240) で復元されストアがクリアされること
    window.history.replaceState(null, "", "/");
    scrollToSpy.mockClear();
    const historyDeferred =
      createDeferred<readonly LocalReadingHistoryItem[]>();
    const delayedProgressRepo = createMockReadingProgressRepo({
      listRecentLocal: vi.fn(() => historyDeferred.promise),
    });
    const authBridge = createMockGoogleAuthBridge({
      getSession: vi.fn(async () => null),
    });

    const { unmount: unmount3 } = render(
      <StrictMode>
        <ServiceProvider
          readingProgressRepo={delayedProgressRepo}
          googleAuthBridge={authBridge}
          driveSyncRootsRepo={createMockDriveSyncRootsRepo()}
        >
          <RouterProvider initialPath="/">
            <BookshelfPage />
          </RouterProvider>
        </ServiceProvider>
      </StrictMode>,
    );

    expect(scrollToSpy).toHaveBeenCalledWith(0, 240);
    // 非同期完了前は store の scrollY を消去しないこと
    expect(useBookshelfUiStateStore.getState().scrollY).toBe(240);

    await act(async () => {
      historyDeferred.resolve([]);
      await flushMicrotasks();
    });

    expect(scrollToSpy).toHaveBeenLastCalledWith(0, 240);
    expect(useBookshelfUiStateStore.getState().scrollY).toBe(0);
    unmount3();

    // 4. ローカルファイル選択時 (TR-02a) に残留 scrollY をクリアすること
    useBookshelfUiStateStore.getState().saveScrollY(120);
    await renderAndFlush(<Default />);
    const input = screen.getByTestId("local-zip-file-input");
    fireEvent.change(input, {
      target: {
        files: [
          new File(["zip"], "clean-scroll.zip", { type: "application/zip" }),
        ],
      },
    });
    expect(useBookshelfUiStateStore.getState().scrollY).toBe(0);

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
  });

  it("initialDriveSetupState未指定時にgetCachedSession・getSession・subscribeSession・countEnabledからバナー状態を導出し失敗時は安全フォールバックすること (AC-BS-07)", async () => {
    const progressRepo = createMockReadingProgressRepo();
    const sessionA: GoogleAuthSession = {
      email: "cached@example.com",
      accessToken: "ya29.cached",
      expiresAt: Date.now() + 3_600_000,
    };

    // 1. getCachedSession ヒット + countEnabled > 0 -> ready
    const cachedAuth = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => sessionA),
    });
    const rootsReadyRepo = createMockDriveSyncRootsRepo({
      countEnabled: vi.fn(async () => 2),
    });
    const { unmount: unmountCached } = await renderAndFlush(
      <ServiceProvider
        readingProgressRepo={progressRepo}
        googleAuthBridge={cachedAuth}
        driveSyncRootsRepo={rootsReadyRepo}
      >
        <RouterProvider initialPath="/">
          <BookshelfPage initialRecentHistory={[]} />
        </RouterProvider>
      </ServiceProvider>,
    );
    expect(cachedAuth.getSession).not.toHaveBeenCalled();
    expect(getLatestDriveBannerProps().state).toEqual({ kind: "ready" });

    // subscribeSession で null (サインアウト) -> unauthenticated、再ログイン + countEnabled=0 -> no-roots
    vi.mocked(rootsReadyRepo.countEnabled).mockResolvedValueOnce(0);
    act(() => {
      cachedAuth.emitSession(null);
    });
    expect(getLatestDriveBannerProps().state).toEqual({
      kind: "unauthenticated",
    });

    await act(async () => {
      cachedAuth.emitSession({
        email: "relinked@example.com",
        accessToken: "ya29.new",
        expiresAt: Date.now() + 3_600_000,
      });
      await flushMicrotasks();
    });
    expect(getLatestDriveBannerProps().state).toEqual({
      kind: "no-roots",
      email: "relinked@example.com",
    });
    unmountCached();

    // 2. getCachedSession()=null -> getSession() 解決 & subscribeSession 連携 & countEnabled失敗時は no-roots フォールバック
    const failingRootsRepo = createMockDriveSyncRootsRepo({
      countEnabled: vi.fn(async () => {
        throw new Error("count failed");
      }),
    });
    const asyncAuth = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => null),
      getSession: vi.fn(async () => sessionA),
    });
    const { unmount: unmountCountErr } = await renderAndFlush(
      <ServiceProvider
        readingProgressRepo={progressRepo}
        googleAuthBridge={asyncAuth}
        driveSyncRootsRepo={failingRootsRepo}
      >
        <RouterProvider initialPath="/">
          <BookshelfPage initialRecentHistory={[]} />
        </RouterProvider>
      </ServiceProvider>,
    );
    expect(getLatestDriveBannerProps().state).toEqual({
      kind: "no-roots",
      email: "cached@example.com",
    });
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          scope: "bookshelf",
          detail: "count failed",
        }),
      ]),
    );
    unmountCountErr();

    // 3. getSession() 失敗時は warn 記録し unauthenticated へフォールバック
    diagnosticLogger.clear();
    const failingAuth = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => null),
      getSession: vi.fn(async () => {
        throw new Error("getSession boom");
      }),
    });
    await renderAndFlush(
      <ServiceProvider
        readingProgressRepo={progressRepo}
        googleAuthBridge={failingAuth}
        driveSyncRootsRepo={createMockDriveSyncRootsRepo()}
      >
        <RouterProvider initialPath="/">
          <BookshelfPage initialRecentHistory={[]} />
        </RouterProvider>
      </ServiceProvider>,
    );
    expect(getLatestDriveBannerProps().state).toEqual({
      kind: "unauthenticated",
    });
    expect(diagnosticLogger.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          scope: "bookshelf",
          detail: "getSession boom",
        }),
      ]),
    );
  });

  it("Driveバナー非同期解決中にアンマウントまたはセッション更新が起きた場合は古い結果を破棄すること (AC-BS-07)", async () => {
    const progressRepo = createMockReadingProgressRepo();
    const sessionLate: GoogleAuthSession = {
      email: "late@example.com",
      accessToken: "ya29.late",
      expiresAt: Date.now() + 3_600_000,
    };

    // 1. getSession() 待機中に subscribeSession でサインアウト変化 -> 遅延 resolve / reject は無視
    const getSessionResolve = createDeferred<GoogleAuthSession | null>();
    const raceAuth1 = createMockGoogleAuthBridge({
      getSession: vi.fn(() => getSessionResolve.promise),
    });
    const { unmount: unmountRace1 } = render(
      <ServiceProvider
        readingProgressRepo={progressRepo}
        googleAuthBridge={raceAuth1}
        driveSyncRootsRepo={createMockDriveSyncRootsRepo()}
      >
        <RouterProvider initialPath="/">
          <BookshelfPage initialRecentHistory={[]} />
        </RouterProvider>
      </ServiceProvider>,
    );
    act(() => {
      raceAuth1.emitSession(null);
    });
    expect(getLatestDriveBannerProps().state).toEqual({
      kind: "unauthenticated",
    });
    await act(async () => {
      getSessionResolve.resolve(sessionLate);
      await flushMicrotasks();
    });
    expect(getLatestDriveBannerProps().state).toEqual({
      kind: "unauthenticated",
    });
    unmountRace1();

    const getSessionReject = createDeferred<GoogleAuthSession | null>();
    const raceAuth2 = createMockGoogleAuthBridge({
      getSession: vi.fn(() => getSessionReject.promise),
    });
    const { unmount: unmountRace2 } = render(
      <ServiceProvider
        readingProgressRepo={progressRepo}
        googleAuthBridge={raceAuth2}
        driveSyncRootsRepo={createMockDriveSyncRootsRepo()}
      >
        <RouterProvider initialPath="/">
          <BookshelfPage initialRecentHistory={[]} />
        </RouterProvider>
      </ServiceProvider>,
    );
    unmountRace2();
    await act(async () => {
      getSessionReject.reject(new Error("late session err"));
      await flushMicrotasks();
    });
    expect(diagnosticLogger.getEntries()).toEqual([]);

    // 2. countEnabled() 待機中にアンマウントおよびセッション更新 -> 遅延 resolve / reject は無視
    const countResolve = createDeferred<number>();
    const countAuth1 = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => sessionLate),
    });
    const countRoots1 = createMockDriveSyncRootsRepo({
      countEnabled: vi.fn(() => countResolve.promise),
    });
    const { unmount: unmountCount1 } = render(
      <ServiceProvider
        readingProgressRepo={progressRepo}
        googleAuthBridge={countAuth1}
        driveSyncRootsRepo={countRoots1}
      >
        <RouterProvider initialPath="/">
          <BookshelfPage initialRecentHistory={[]} />
        </RouterProvider>
      </ServiceProvider>,
    );
    act(() => {
      countAuth1.emitSession(null);
    });
    await act(async () => {
      countResolve.resolve(3);
      await flushMicrotasks();
    });
    expect(getLatestDriveBannerProps().state).toEqual({
      kind: "unauthenticated",
    });
    unmountCount1();

    const countReject = createDeferred<number>();
    const countAuth2 = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => sessionLate),
    });
    const countRoots2 = createMockDriveSyncRootsRepo({
      countEnabled: vi.fn(() => countReject.promise),
    });
    const { unmount: unmountCount2 } = render(
      <ServiceProvider
        readingProgressRepo={progressRepo}
        googleAuthBridge={countAuth2}
        driveSyncRootsRepo={countRoots2}
      >
        <RouterProvider initialPath="/">
          <BookshelfPage initialRecentHistory={[]} />
        </RouterProvider>
      </ServiceProvider>,
    );
    unmountCount2();
    await act(async () => {
      countReject.reject(new Error("late count err"));
      await flushMicrotasks();
    });
    expect(diagnosticLogger.getEntries()).toEqual([]);
  });
});
