import { composeStories } from "@storybook/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ReactElement } from "react";
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
import { GoogleAuthError } from "../../bridges/oauth/googleAuthErrors";
import type {
  AuthSessionListener,
  GoogleAuthBridge,
  GoogleAuthSession,
} from "../../bridges/oauth/types";
import {
  createDiagnosticLogger,
  diagnosticLogger,
} from "../../diagnostics/diagnosticLogger";
import type { CoverExtractionScheduler } from "../../engine/cover/types";
import { DriveApiError } from "../../providers/gdrive/driveApiErrors";
import type {
  DriveApiErrorCode,
  DriveFolderClient,
  DriveFolderPage,
  DriveSyncEngine,
} from "../../providers/gdrive/types";
import { RouterProvider } from "../../shared/router/RouterProvider";
import { useRouter } from "../../shared/router/routerContext";
import {
  INITIAL_COVER_EXTRACTION_SNAPSHOT,
  resetCoverExtractionState,
} from "../../shared/sync/coverExtractionStateStore";
import {
  resetDriveSyncState,
  useDriveSyncStateStore,
} from "../../shared/sync/driveSyncStateStore";
import { resetTestDb } from "../../storage/db";
import type { DriveSyncMetaRepository } from "../../storage/repositories/driveSyncMetaRepository";
import type { DriveSyncRootsRepository } from "../../storage/repositories/driveSyncRootsRepository";
import type { DriveSyncRootRecord } from "../../storage/types";
import * as CoverExtractionSectionModule from "./CoverExtractionSection";
import * as DiagnosticsSectionModule from "./DiagnosticsSection";
import * as DriveFolderPickerModalModule from "./DriveFolderPickerModal";
import * as DriveSyncExecutionSectionModule from "./DriveSyncExecutionSection";
import * as DriveSyncRootsSectionModule from "./DriveSyncRootsSection";
import * as GoogleAccountSectionModule from "./GoogleAccountSection";
import * as SettingsHeaderModule from "./SettingsHeader";
import { SettingsPage, type SettingsPageProps } from "./SettingsPage";
import * as stories from "./SettingsPage.stories";

const {
  Unlinked,
  AuthProcessing,
  ConnectedWithRoots,
  Syncing,
  FolderPickerOpen,
  ErrorState,
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

function createSampleRoot(
  overrides: Partial<DriveSyncRootRecord> = {},
): DriveSyncRootRecord {
  return {
    folderId: "folder-comics",
    folderName: "Comics",
    enabled: 1,
    addedAt: 1_730_000_000_000,
    updatedAt: 1_730_000_000_000,
    deletedAt: null,
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
    signIn: vi.fn(async () => ({
      email: "reader@example.com",
      accessToken: "ya29.signed-in",
      expiresAt: Date.now() + 3_600_000,
    })),
    signOut: vi.fn(async () => undefined),
    getValidAccessToken: vi.fn(async () => "ya29.valid"),
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

function createMockSyncRootsRepo(
  overrides: Partial<DriveSyncRootsRepository> = {},
): DriveSyncRootsRepository {
  return {
    listActive: vi.fn(async () => []),
    countEnabled: vi.fn(async () => 0),
    upsertRoot: vi.fn(async (input) =>
      createSampleRoot({
        folderId: input.folderId,
        folderName: input.folderName,
      }),
    ),
    setEnabled: vi.fn(async (folderId, enabled) =>
      createSampleRoot({ folderId, enabled: enabled ? 1 : 0 }),
    ),
    removeRoot: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createMockDriveFolderClient(
  overrides: Partial<DriveFolderClient> = {},
): DriveFolderClient {
  return {
    resolveFolderById: vi.fn(async (folderId) => ({
      id: folderId,
      name: `Folder-${folderId}`,
    })),
    listChildFolders: vi.fn(async () => ({
      folders: [],
      nextPageToken: null,
    })),
    ...overrides,
  };
}

function createMockDriveSyncMetaRepo(
  overrides: Partial<DriveSyncMetaRepository> = {},
): DriveSyncMetaRepository {
  return {
    getSyncState: vi.fn(async () => ({
      startPageToken: null,
      lastDriveSyncAt: null,
      syncedRootFolderIds: [],
    })),
    saveSyncState: vi.fn(async (state) => state),
    clearSyncState: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createMockDriveSyncEngine(
  overrides: Partial<DriveSyncEngine> = {},
): DriveSyncEngine {
  return {
    sync: vi.fn(async () => ({
      mode: "incremental" as const,
      scannedRoots: 1,
      upsertedVolumes: 3,
      trashedVolumes: 0,
      invalidatedZipCaches: 0,
      syncedAt: Date.UTC(2026, 10, 25, 12, 30, 0),
    })),
    ...overrides,
  };
}

function createMockCoverExtractionScheduler(
  overrides: Partial<CoverExtractionScheduler> = {},
): CoverExtractionScheduler {
  return {
    syncQueue: vi.fn(async () => undefined),
    setViewportVolumeIds: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    retryFailedCovers: vi.fn(async () => 0),
    getSnapshot: vi.fn(() => INITIAL_COVER_EXTRACTION_SNAPSHOT),
    subscribeProgress: vi.fn(() => () => undefined),
    subscribeVolumeUpdated: vi.fn(() => () => undefined),
    resetForTest: vi.fn(async () => undefined),
    dispose: vi.fn(),
    ...overrides,
  };
}

describe("SettingsPage", () => {
  const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  const originalUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  let headerSpy: MockInstance<typeof SettingsHeaderModule.SettingsHeader>;
  let accountSpy: MockInstance<
    typeof GoogleAccountSectionModule.GoogleAccountSection
  >;
  let syncRootsSpy: MockInstance<
    typeof DriveSyncRootsSectionModule.DriveSyncRootsSection
  >;
  let syncExecSpy: MockInstance<
    typeof DriveSyncExecutionSectionModule.DriveSyncExecutionSection
  >;
  let coverExtractionSpy: MockInstance<
    typeof CoverExtractionSectionModule.CoverExtractionSection
  >;
  let pickerSpy: MockInstance<
    typeof DriveFolderPickerModalModule.DriveFolderPickerModal
  >;
  let diagnosticsSpy: MockInstance<
    typeof DiagnosticsSectionModule.DiagnosticsSection
  >;

  beforeEach(async () => {
    await resetTestDb();
    diagnosticLogger.clear();
    resetDriveSyncState();
    resetCoverExtractionState();
    window.history.replaceState(null, "", "/settings");

    headerSpy = vi
      .spyOn(SettingsHeaderModule, "SettingsHeader")
      .mockImplementation(() => null);
    accountSpy = vi
      .spyOn(GoogleAccountSectionModule, "GoogleAccountSection")
      .mockImplementation(() => null);
    syncRootsSpy = vi
      .spyOn(DriveSyncRootsSectionModule, "DriveSyncRootsSection")
      .mockImplementation(() => null);
    syncExecSpy = vi
      .spyOn(DriveSyncExecutionSectionModule, "DriveSyncExecutionSection")
      .mockImplementation(() => null);
    coverExtractionSpy = vi
      .spyOn(CoverExtractionSectionModule, "CoverExtractionSection")
      .mockImplementation(() => null);
    pickerSpy = vi
      .spyOn(DriveFolderPickerModalModule, "DriveFolderPickerModal")
      .mockImplementation(() => null);
    diagnosticsSpy = vi
      .spyOn(DiagnosticsSectionModule, "DiagnosticsSection")
      .mockImplementation(() => null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDb();
    resetDriveSyncState();
    resetCoverExtractionState();
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

  const getHeaderProps = (): SettingsHeaderModule.SettingsHeaderProps => {
    const call = headerSpy.mock.calls.at(-1);
    expect(call).toBeDefined();
    return call![0] as SettingsHeaderModule.SettingsHeaderProps;
  };

  const getAccountProps =
    (): GoogleAccountSectionModule.GoogleAccountSectionProps => {
      const call = accountSpy.mock.calls.at(-1);
      expect(call).toBeDefined();
      return call![0] as GoogleAccountSectionModule.GoogleAccountSectionProps;
    };

  const getSyncRootsProps =
    (): DriveSyncRootsSectionModule.DriveSyncRootsSectionProps => {
      const call = syncRootsSpy.mock.calls.at(-1);
      expect(call).toBeDefined();
      return call![0] as DriveSyncRootsSectionModule.DriveSyncRootsSectionProps;
    };

  const getSyncExecProps =
    (): DriveSyncExecutionSectionModule.DriveSyncExecutionSectionProps => {
      const call = syncExecSpy.mock.calls.at(-1);
      expect(call).toBeDefined();
      return call![0] as DriveSyncExecutionSectionModule.DriveSyncExecutionSectionProps;
    };

  const getCoverExtractionProps =
    (): CoverExtractionSectionModule.CoverExtractionSectionProps => {
      const call = coverExtractionSpy.mock.calls.at(-1);
      expect(call).toBeDefined();
      return call![0] as CoverExtractionSectionModule.CoverExtractionSectionProps;
    };

  const getPickerProps =
    (): DriveFolderPickerModalModule.DriveFolderPickerModalProps => {
      const call = pickerSpy.mock.calls.at(-1);
      expect(call).toBeDefined();
      return call![0] as DriveFolderPickerModalModule.DriveFolderPickerModalProps;
    };

  const getDiagnosticsProps =
    (): DiagnosticsSectionModule.DiagnosticsSectionProps => {
      const call = diagnosticsSpy.mock.calls.at(-1);
      expect(call).toBeDefined();
      return call![0] as DiagnosticsSectionModule.DiagnosticsSectionProps;
    };

  async function renderAndFlush(element: ReactElement) {
    const rendered = render(element);
    await act(async () => {
      await flushMicrotasks();
    });
    return rendered;
  }

  async function renderSettings(
    deps: {
      readonly authBridge?: GoogleAuthBridge;
      readonly syncRootsRepo?: DriveSyncRootsRepository;
      readonly folderClient?: DriveFolderClient;
      readonly syncMetaRepo?: DriveSyncMetaRepository;
      readonly syncEngine?: DriveSyncEngine;
      readonly coverExtractionScheduler?: CoverExtractionScheduler;
      readonly initialPath?: string;
      readonly routerProbe?: (blocked: boolean) => void;
    } = {},
    props: SettingsPageProps = {},
  ) {
    function RouterObserver() {
      const { isBackBlocked } = useRouter();
      deps.routerProbe?.(isBackBlocked);
      return null;
    }

    return renderAndFlush(
      <ServiceProvider
        googleAuthBridge={deps.authBridge ?? createMockGoogleAuthBridge()}
        driveSyncRootsRepo={deps.syncRootsRepo ?? createMockSyncRootsRepo()}
        driveFolderClient={deps.folderClient ?? createMockDriveFolderClient()}
        driveSyncMetaRepo={deps.syncMetaRepo ?? createMockDriveSyncMetaRepo()}
        driveSyncEngine={deps.syncEngine ?? createMockDriveSyncEngine()}
        coverExtractionScheduler={
          deps.coverExtractionScheduler ?? createMockCoverExtractionScheduler()
        }
      >
        <RouterProvider initialPath={deps.initialPath ?? "/settings"}>
          <RouterObserver />
          <SettingsPage {...props} />
        </RouterProvider>
      </ServiceProvider>,
    );
  }

  it("全Storybookストーリーを描画し6つの直下子コンポーネントへPropsを正しく配線すること (AC-ST-07, AC-ST-08)", async () => {
    const { unmount: u1 } = await renderAndFlush(<Unlinked />);
    expect(screen.getByTestId("settings-main-content")).not.toHaveAttribute(
      "inert",
    );
    expect(getHeaderProps()).toEqual({
      isBackBlocked: false,
      onBack: expect.any(Function),
    });
    expect(getAccountProps()).toMatchObject({
      status: "unlinked",
      email: null,
      errorMessage: null,
    });
    expect(getSyncRootsProps()).toMatchObject({
      roots: [],
      isConnected: false,
      folderInput: "",
      isSubmitting: false,
      errorMessage: null,
    });
    expect(getPickerProps()).toMatchObject({
      isOpen: false,
    });
    expect(getDiagnosticsProps().entries).toHaveLength(3);
    u1();

    const { unmount: u2 } = await renderAndFlush(<AuthProcessing />);
    expect(getHeaderProps().isBackBlocked).toBe(true);
    expect(getAccountProps().status).toBe("signing-in");
    u2();

    const { unmount: u3 } = await renderAndFlush(<ConnectedWithRoots />);
    expect(getAccountProps()).toMatchObject({
      status: "connected",
      email: "reader@example.com",
    });
    expect(getSyncRootsProps().roots).toHaveLength(2);
    expect(getSyncRootsProps().isConnected).toBe(true);
    expect(getDiagnosticsProps().copyStatus).toBe("copied");
    u3();

    const { unmount: u4 } = await renderAndFlush(<FolderPickerOpen />);
    expect(screen.getByTestId("settings-main-content")).toHaveAttribute(
      "inert",
    );
    expect(getPickerProps()).toMatchObject({
      isOpen: true,
      breadcrumbs: [
        { id: "root", name: "マイドライブ" },
        { id: "mock-folder-comics", name: "Comics" },
      ],
      nextPageToken: "next-page-token-2",
    });
    expect(getPickerProps().folders).toHaveLength(2);
    u4();

    const { unmount: u5 } = await renderAndFlush(<ErrorState />);
    expect(getAccountProps().errorMessage).toContain("通信に失敗");
    expect(getSyncRootsProps().errorMessage).toContain("マイドライブ直下");
    expect(getDiagnosticsProps().copyStatus).toBe("failed");
    u5();

    await renderSettings(
      {},
      {
        initialSnapshot: {
          authState: {
            status: "unlinked",
            email: null,
            errorMessage: null,
          },
          syncRoots: [],
        },
      },
    );
    expect(getDiagnosticsProps().entries).toEqual([]);
  });

  it("初期マウント時にcachedSession/getSession/listActiveを解決し、非同期競合や失敗時は安全フォールバックすること (AC-ST-01, AC-ST-04)", async () => {
    const cachedSession: GoogleAuthSession = {
      email: "cached@example.com",
      accessToken: "ya29.cached",
      expiresAt: Date.now() + 3_600_000,
    };
    const rootA = createSampleRoot({ folderId: "f-a", folderName: "Manga A" });

    // 1. getCachedSession ヒット時は getSession() を呼ばず connected 初期化
    const cachedAuth = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => cachedSession),
    });
    const repoOk = createMockSyncRootsRepo({
      listActive: vi.fn(async () => [rootA]),
    });
    const logger1 = createDiagnosticLogger(20);
    const { unmount: u1 } = await renderSettings(
      { authBridge: cachedAuth, syncRootsRepo: repoOk },
      { logger: logger1 },
    );
    expect(cachedAuth.getSession).not.toHaveBeenCalled();
    expect(getAccountProps()).toMatchObject({
      status: "connected",
      email: "cached@example.com",
    });
    expect(getSyncRootsProps().roots).toEqual([rootA]);

    // subscribeSession で null / 新セッションへ追従
    act(() => {
      cachedAuth.emitSession(null);
    });
    expect(getAccountProps().status).toBe("unlinked");
    act(() => {
      cachedAuth.emitSession({
        email: "next@example.com",
        accessToken: "ya29.next",
        expiresAt: Date.now() + 3_600_000,
      });
    });
    expect(getAccountProps()).toMatchObject({
      status: "connected",
      email: "next@example.com",
    });
    u1();

    // 2. getCachedSession null -> getSession() 復元成功 & null 解決
    const asyncAuth = createMockGoogleAuthBridge({
      getSession: vi.fn(async () => cachedSession),
    });
    const { unmount: u2 } = await renderSettings({ authBridge: asyncAuth });
    expect(getAccountProps()).toMatchObject({
      status: "connected",
      email: "cached@example.com",
    });
    u2();

    // 3. getSession() 失敗 & listActive() 失敗時は警告ログ記録＋安全表示
    const logger3 = createDiagnosticLogger(20);
    const failAuth = createMockGoogleAuthBridge({
      getSession: vi.fn(async () => {
        throw new Error("restore err");
      }),
    });
    const failRepo = createMockSyncRootsRepo({
      listActive: vi.fn(async () => {
        throw "raw listActive err";
      }),
    });
    const { unmount: u3 } = await renderSettings(
      { authBridge: failAuth, syncRootsRepo: failRepo },
      { logger: logger3 },
    );
    expect(getAccountProps().status).toBe("unlinked");
    expect(getSyncRootsProps().errorMessage).toBe(
      "登録済みルートフォルダの読み込みに失敗しました。",
    );
    expect(logger3.getEntries().length).toBeGreaterThanOrEqual(2);
    u3();

    // 4. getSession() / listActive() 完了前のアンマウント・操作競合時は古い結果を破棄
    const getSessionDeferred = createDeferred<GoogleAuthSession | null>();
    const listActiveDeferred = createDeferred<readonly DriveSyncRootRecord[]>();
    const logger4 = createDiagnosticLogger(20);
    const staleAuth = createMockGoogleAuthBridge({
      getSession: vi.fn(() => getSessionDeferred.promise),
    });
    const staleRepo = createMockSyncRootsRepo({
      listActive: vi.fn(() => listActiveDeferred.promise),
    });

    const { unmount: u4 } = render(
      <ServiceProvider
        googleAuthBridge={staleAuth}
        driveSyncRootsRepo={staleRepo}
      >
        <RouterProvider initialPath="/settings">
          <SettingsPage logger={logger4} />
        </RouterProvider>
      </ServiceProvider>,
    );
    // signIn 開始で authFlowEpoch を進めた後に遅延 getSession が解決しても上書きしない
    const signInDeferred = createDeferred<GoogleAuthSession>();
    vi.mocked(staleAuth.signIn).mockImplementationOnce(
      () => signInDeferred.promise,
    );
    act(() => {
      getAccountProps().onSignIn();
    });
    await act(async () => {
      getSessionDeferred.resolve(cachedSession);
      await flushMicrotasks();
    });
    expect(getAccountProps().status).toBe("signing-in");

    u4();
    await act(async () => {
      signInDeferred.resolve(cachedSession);
      listActiveDeferred.resolve([rootA]);
      await flushMicrotasks();
    });

    // reject のアンマウント後破棄
    const getSessionRejectDeferred = createDeferred<GoogleAuthSession | null>();
    const listActiveRejectDeferred =
      createDeferred<readonly DriveSyncRootRecord[]>();
    const logger5 = createDiagnosticLogger(20);
    const staleAuth2 = createMockGoogleAuthBridge({
      getSession: vi.fn(() => getSessionRejectDeferred.promise),
    });
    const staleRepo2 = createMockSyncRootsRepo({
      listActive: vi.fn(() => listActiveRejectDeferred.promise),
    });
    const { unmount: u5 } = render(
      <ServiceProvider
        googleAuthBridge={staleAuth2}
        driveSyncRootsRepo={staleRepo2}
      >
        <RouterProvider initialPath="/settings">
          <SettingsPage logger={logger5} />
        </RouterProvider>
      </ServiceProvider>,
    );
    u5();
    await act(async () => {
      getSessionRejectDeferred.reject(new Error("late restore err"));
      listActiveRejectDeferred.reject(new Error("late list err"));
      await flushMicrotasks();
    });
    expect(logger5.getEntries()).toEqual([]);
  });

  it("Googleログイン/ログアウトのSingle-Flight・AUTH_CANCELLED無言復帰・各種エラー・ログアウト時ルート保持と戻るブロック同期が動作すること (AC-ST-01, AC-ST-04, AC-ST-06)", async () => {
    const blockedStates: boolean[] = [];
    const rootExisting = createSampleRoot();
    let cachedSession: GoogleAuthSession | null = null;
    const authBridge = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => cachedSession),
    });
    const syncRootsRepo = createMockSyncRootsRepo({
      listActive: vi.fn(async () => [rootExisting]),
    });
    const logger = createDiagnosticLogger(20);

    const { rerender } = await renderSettings(
      {
        authBridge,
        syncRootsRepo,
        routerProbe: (b) => blockedStates.push(b),
      },
      { logger },
    );

    // 1. サインイン中: Single-Flight & isBackBlocked=true
    const signInDeferred = createDeferred<GoogleAuthSession>();
    vi.mocked(authBridge.signIn).mockImplementationOnce(
      () => signInDeferred.promise,
    );
    act(() => {
      getAccountProps().onSignIn();
      getAccountProps().onSignIn(); // 2回目はブロック
    });
    expect(authBridge.signIn).toHaveBeenCalledTimes(1);
    expect(getAccountProps().status).toBe("signing-in");
    expect(getHeaderProps().isBackBlocked).toBe(true);
    expect(blockedStates.at(-1)).toBe(true);

    // サインイン中に signOut 呼び出しもブロック
    act(() => {
      getAccountProps().onSignOut();
    });
    expect(authBridge.signOut).not.toHaveBeenCalled();

    const loggedInSession: GoogleAuthSession = {
      email: "reader@example.com",
      accessToken: "ya29.secret-login-token",
      expiresAt: Date.now() + 3_600_000,
    };
    cachedSession = loggedInSession;
    await act(async () => {
      signInDeferred.resolve(loggedInSession);
      await flushMicrotasks();
    });
    expect(getAccountProps()).toMatchObject({
      status: "connected",
      email: "reader@example.com",
      errorMessage: null,
    });
    expect(getHeaderProps().isBackBlocked).toBe(false);
    expect(blockedStates.at(-1)).toBe(false);

    // 2. サインアウト中: subscribeSession による即 unlinked 化を抑止し、完了後も driveSyncRoots は保持
    const signOutDeferred = createDeferred<void>();
    vi.mocked(authBridge.signOut).mockImplementationOnce(
      () => signOutDeferred.promise,
    );
    act(() => {
      getAccountProps().onSignOut();
      authBridge.emitSession(null);
    });
    expect(getAccountProps().status).toBe("signing-out");
    expect(getHeaderProps().isBackBlocked).toBe(true);

    cachedSession = null;
    await act(async () => {
      signOutDeferred.resolve(undefined);
      await flushMicrotasks();
    });
    expect(getAccountProps().status).toBe("unlinked");
    expect(getSyncRootsProps().roots).toEqual([rootExisting]);
    expect(getHeaderProps().isBackBlocked).toBe(false);

    // 3. AUTH_CANCELLED -> 破壊的エラーアラートを出さず未連携維持
    vi.mocked(authBridge.signIn).mockRejectedValueOnce(
      new GoogleAuthError("AUTH_CANCELLED", "cancelled"),
    );
    await act(async () => {
      await getAccountProps().onSignIn();
    });
    expect(getAccountProps()).toMatchObject({
      status: "unlinked",
      errorMessage: null,
    });

    // 4. AUTH_NETWORK_ERROR / AUTH_REQUIRED / AUTH_FAILED (ya29.* マスク)
    vi.mocked(authBridge.signIn).mockRejectedValueOnce(
      new GoogleAuthError("AUTH_NETWORK_ERROR", "offline"),
    );
    await act(async () => {
      await getAccountProps().onSignIn();
    });
    expect(getAccountProps().errorMessage).toContain("通信に失敗しました");

    vi.mocked(authBridge.signIn).mockRejectedValueOnce(
      new GoogleAuthError("AUTH_REQUIRED", "reauth"),
    );
    await act(async () => {
      await getAccountProps().onSignIn();
    });
    expect(getAccountProps().errorMessage).toContain("再認証が必要です");

    vi.mocked(authBridge.signIn).mockRejectedValueOnce(
      new Error("OAuth failed with Bearer ya29.secret-auth-token-999"),
    );
    await act(async () => {
      await getAccountProps().onSignIn();
    });
    expect(getAccountProps().errorMessage).toContain("Bearer [REDACTED]");
    expect(getAccountProps().errorMessage).not.toContain("ya29.");

    // 5. signOut 失敗時のキャッシュ残存 / 消失分岐
    vi.mocked(authBridge.signIn).mockResolvedValueOnce({
      email: "reader@example.com",
      accessToken: "ya29.re",
      expiresAt: Date.now() + 3_600_000,
    });
    await act(async () => {
      await getAccountProps().onSignIn();
    });

    // キャッシュありで signOut 失敗 -> connected 維持 + エラー表示
    cachedSession = {
      email: "reader@example.com",
      accessToken: "ya29.still",
      expiresAt: Date.now() + 3_600_000,
    };
    vi.mocked(authBridge.signOut).mockRejectedValueOnce(
      new Error("signOut failed while cached"),
    );
    await act(async () => {
      await getAccountProps().onSignOut();
    });
    expect(getAccountProps()).toMatchObject({
      status: "connected",
      email: "reader@example.com",
      errorMessage: "signOut failed while cached",
    });

    // キャッシュ消失で signOut 失敗 -> unlinked + エラー表示
    cachedSession = null;
    vi.mocked(authBridge.signOut).mockRejectedValueOnce(
      new Error("signOut failed cleared"),
    );
    await act(async () => {
      await getAccountProps().onSignOut();
    });
    expect(getAccountProps()).toMatchObject({
      status: "unlinked",
      email: null,
      errorMessage: "signOut failed cleared",
    });

    // 6. アンマウント時の signIn/signOut 完了無視と setBackBlocked(false) 復元
    const pendingSignIn = createDeferred<GoogleAuthSession>();
    vi.mocked(authBridge.signIn).mockImplementationOnce(
      () => pendingSignIn.promise,
    );
    act(() => {
      getAccountProps().onSignIn();
    });
    expect(blockedStates.at(-1)).toBe(true);

    function KeepRouterObserver() {
      const { isBackBlocked } = useRouter();
      blockedStates.push(isBackBlocked);
      return null;
    }
    rerender(
      <ServiceProvider
        googleAuthBridge={authBridge}
        driveSyncRootsRepo={syncRootsRepo}
        driveFolderClient={createMockDriveFolderClient()}
      >
        <RouterProvider initialPath="/settings">
          <KeepRouterObserver />
        </RouterProvider>
      </ServiceProvider>,
    );
    expect(blockedStates.at(-1)).toBe(false);

    await act(async () => {
      pendingSignIn.reject(new Error("after unmount"));
      await flushMicrotasks();
    });

    // signOut 実行中アンマウント後の resolve / reject 無視
    const auth2 = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => ({
        email: "u@example.com",
        accessToken: "ya29.u",
        expiresAt: Date.now() + 3_600_000,
      })),
    });
    const pendingSignOut = createDeferred<void>();
    vi.mocked(auth2.signOut).mockImplementationOnce(
      () => pendingSignOut.promise,
    );
    const { unmount: u2 } = await renderSettings({ authBridge: auth2 });
    act(() => {
      getAccountProps().onSignOut();
    });
    u2();
    await act(async () => {
      pendingSignOut.resolve(undefined);
      await flushMicrotasks();
    });

    const pendingSignOutErr = createDeferred<void>();
    vi.mocked(auth2.signOut).mockImplementationOnce(
      () => pendingSignOutErr.promise,
    );
    const { unmount: u3 } = await renderSettings({ authBridge: auth2 });
    act(() => {
      getAccountProps().onSignOut();
    });
    u3();
    await act(async () => {
      pendingSignOutErr.reject(new Error("signout after unmount"));
      await flushMicrotasks();
    });
  });

  it("URL/ID直接登録（root拒否・検証・保存・全DriveApiError変換・中断）・有効/無効切替・削除とロールバックが動作すること (AC-ST-03, AC-ST-04, AC-ST-06)", async () => {
    const session: GoogleAuthSession = {
      email: "reader@example.com",
      accessToken: "ya29.ok",
      expiresAt: Date.now() + 3_600_000,
    };
    let activeRoots: DriveSyncRootRecord[] = [];
    const syncRootsRepo = createMockSyncRootsRepo({
      listActive: vi.fn(async () => [...activeRoots]),
      upsertRoot: vi.fn(async (input) => {
        const rec = createSampleRoot({
          folderId: input.folderId,
          folderName: input.folderName,
        });
        activeRoots = [rec];
        return rec;
      }),
      setEnabled: vi.fn(async (folderId, enabled) => {
        activeRoots = activeRoots.map((r) =>
          r.folderId === folderId ? { ...r, enabled: enabled ? 1 : 0 } : r,
        );
        return activeRoots[0] ?? null;
      }),
      removeRoot: vi.fn(async (folderId) => {
        activeRoots = activeRoots.filter((r) => r.folderId !== folderId);
      }),
    });
    const folderClient = createMockDriveFolderClient({
      resolveFolderById: vi.fn(async (folderId) => ({
        id: folderId,
        name: "My Manga Root",
      })),
    });
    const logger = createDiagnosticLogger(30);

    // 未連携中は直接追加・ピッカー起動をブロック
    const unlinkedAuth = createMockGoogleAuthBridge();
    const { unmount: uUnlinked } = await renderSettings({
      authBridge: unlinkedAuth,
      syncRootsRepo,
      folderClient,
    });
    act(() => {
      getSyncRootsProps().onChangeFolderInput("validFolderId123");
    });
    await act(async () => {
      await getSyncRootsProps().onAddFolderByInput();
      getSyncRootsProps().onOpenFolderPicker();
    });
    expect(folderClient.resolveFolderById).not.toHaveBeenCalled();
    expect(getPickerProps().isOpen).toBe(false);
    uUnlinked();

    const authBridge = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => session),
    });
    const { unmount } = await renderSettings(
      { authBridge, syncRootsRepo, folderClient },
      { logger },
    );

    // 1. 予約語 "root" や不正入力の拒否
    act(() => {
      getSyncRootsProps().onChangeFolderInput("root");
    });
    await act(async () => {
      await getSyncRootsProps().onAddFolderByInput();
    });
    expect(folderClient.resolveFolderById).not.toHaveBeenCalled();
    expect(getSyncRootsProps().errorMessage).toContain("マイドライブ直下");

    // 2. 有効 URL 追加成功 + Single-Flight + isBackBlocked=true 中のブロック
    const resolveDeferred = createDeferred<{ id: string; name: string }>();
    vi.mocked(folderClient.resolveFolderById).mockImplementationOnce(
      () => resolveDeferred.promise,
    );
    act(() => {
      getSyncRootsProps().onChangeFolderInput(
        "https://drive.google.com/drive/folders/folder-123?usp=sharing",
      );
    });
    let addPromise!: Promise<void>;
    act(() => {
      addPromise =
        getSyncRootsProps().onAddFolderByInput() as unknown as Promise<void>;
      void getSyncRootsProps().onAddFolderByInput();
    });
    expect(folderClient.resolveFolderById).toHaveBeenCalledTimes(1);
    expect(getSyncRootsProps().isSubmitting).toBe(true);
    expect(getHeaderProps().isBackBlocked).toBe(true);

    await act(async () => {
      resolveDeferred.resolve({ id: "folder-123", name: "My Manga Root" });
      await addPromise;
    });
    expect(getSyncRootsProps().isSubmitting).toBe(false);
    expect(getSyncRootsProps().folderInput).toBe("");
    expect(getSyncRootsProps().roots).toEqual([
      expect.objectContaining({
        folderId: "folder-123",
        folderName: "My Manga Root",
        enabled: 1,
      }),
    ]);

    // 3. 全 DriveApiErrorCode + 非DriveApiError のエラーメッセージ検証
    const errorCases: readonly [DriveApiErrorCode, string][] = [
      ["UNAUTHORIZED", "再認証が必要です"],
      ["FORBIDDEN", "権限がありません"],
      ["NOT_FOUND", "見つかりませんでした"],
      ["NOT_A_FOLDER", "フォルダではありません"],
      ["FOLDER_TRASHED", "ゴミ箱内のフォルダは登録できません"],
      ["RATE_LIMITED", "アクセス上限に達しました"],
      ["NETWORK_ERROR", "通信に失敗しました"],
    ];
    for (const [code, expectedText] of errorCases) {
      vi.mocked(folderClient.resolveFolderById).mockRejectedValueOnce(
        new DriveApiError(code, `err-${code}`),
      );
      act(() => {
        getSyncRootsProps().onChangeFolderInput("valid-folder-id");
      });
      await act(async () => {
        await getSyncRootsProps().onAddFolderByInput();
      });
      expect(getSyncRootsProps().errorMessage).toContain(expectedText);
    }

    vi.mocked(folderClient.resolveFolderById).mockRejectedValueOnce(
      new Error("unexpected resolve fail"),
    );
    await act(async () => {
      await getSyncRootsProps().onAddFolderByInput();
    });
    expect(getSyncRootsProps().errorMessage).toBe("unexpected resolve fail");

    // 4. トグル成功・失敗ロールバック、削除成功・失敗ロールバック
    await act(async () => {
      await getSyncRootsProps().onToggleRootEnabled("folder-123", false);
    });
    expect(getSyncRootsProps().roots[0]?.enabled).toBe(0);

    vi.mocked(syncRootsRepo.setEnabled).mockRejectedValueOnce(
      new Error("toggle db fail"),
    );
    await act(async () => {
      await getSyncRootsProps().onToggleRootEnabled("folder-123", true);
    });
    expect(getSyncRootsProps().roots[0]?.enabled).toBe(0);
    expect(getSyncRootsProps().errorMessage).toContain("有効状態更新に失敗");

    vi.mocked(syncRootsRepo.removeRoot).mockRejectedValueOnce(
      new Error("remove db fail"),
    );
    await act(async () => {
      await getSyncRootsProps().onRemoveRoot("folder-123");
    });
    expect(getSyncRootsProps().roots).toHaveLength(1);
    expect(getSyncRootsProps().errorMessage).toContain("削除に失敗");

    await act(async () => {
      await getSyncRootsProps().onRemoveRoot("folder-123");
    });
    expect(getSyncRootsProps().roots).toEqual([]);

    // 5. toggle / remove の競合世代 & アンマウントガード
    const toggleDeferred = createDeferred<DriveSyncRootRecord | null>();
    vi.mocked(syncRootsRepo.setEnabled).mockImplementationOnce(
      () => toggleDeferred.promise,
    );
    act(() => {
      void getSyncRootsProps().onToggleRootEnabled("folder-123", true);
      void getSyncRootsProps().onRemoveRoot("folder-123"); // mutationSeq を進める
    });
    await act(async () => {
      toggleDeferred.resolve(createSampleRoot({ folderId: "folder-123" }));
      await flushMicrotasks();
    });

    // 6. アンマウント時に進行中 resolveFolderById を abort し、以後の解決・AbortError・通常エラーを無視
    let capturedSignal: AbortSignal | undefined;
    const pendingResolve = createDeferred<{ id: string; name: string }>();
    vi.mocked(folderClient.resolveFolderById).mockImplementationOnce(
      (_id, signal) => {
        capturedSignal = signal;
        return pendingResolve.promise;
      },
    );
    act(() => {
      getSyncRootsProps().onChangeFolderInput("folder-abort");
    });
    act(() => {
      void getSyncRootsProps().onAddFolderByInput();
    });
    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
    await act(async () => {
      pendingResolve.reject(new DOMException("aborted", "AbortError"));
      await flushMicrotasks();
    });

    // resolveFolderById 自体のアンマウント後 resolve 無視
    const lateResolve = createDeferred<{ id: string; name: string }>();
    const repoOk2 = createMockSyncRootsRepo({
      listActive: vi.fn(async () => []),
    });
    const fcLate = createMockDriveFolderClient({
      resolveFolderById: vi.fn(() => lateResolve.promise),
    });
    const { unmount: uStep1 } = await renderSettings({
      authBridge,
      syncRootsRepo: repoOk2,
      folderClient: fcLate,
    });
    act(() => {
      getSyncRootsProps().onChangeFolderInput("folder-step1");
    });
    act(() => {
      void getSyncRootsProps().onAddFolderByInput();
    });
    uStep1();
    await act(async () => {
      lateResolve.resolve({ id: "folder-step1", name: "Step1" });
      await flushMicrotasks();
    });

    // resolveFolderById 後の upsertRoot 中アンマウント、および upsertRoot 後 listActive 中アンマウント
    const upsertDeferred = createDeferred<DriveSyncRootRecord>();
    const listDeferred = createDeferred<readonly DriveSyncRootRecord[]>();
    const repoStale = createMockSyncRootsRepo({
      listActive: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockImplementationOnce(() => listDeferred.promise),
      upsertRoot: vi.fn(() => upsertDeferred.promise),
    });
    const { unmount: uStep2 } = await renderSettings({
      authBridge,
      syncRootsRepo: repoStale,
      folderClient,
    });
    act(() => {
      getSyncRootsProps().onChangeFolderInput("folder-step2");
    });
    act(() => {
      void getSyncRootsProps().onAddFolderByInput();
    });
    await act(async () => {
      await flushMicrotasks();
    });
    uStep2();
    await act(async () => {
      upsertDeferred.resolve(createSampleRoot());
      await flushMicrotasks();
    });

    const listAfterUpsertDeferred =
      createDeferred<readonly DriveSyncRootRecord[]>();
    const repoStep3 = createMockSyncRootsRepo({
      listActive: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockImplementationOnce(() => listAfterUpsertDeferred.promise),
      upsertRoot: vi.fn(async () => createSampleRoot()),
    });
    const { unmount: uStep3 } = await renderSettings({
      authBridge,
      syncRootsRepo: repoStep3,
      folderClient,
    });
    act(() => {
      getSyncRootsProps().onChangeFolderInput("folder-step3");
    });
    act(() => {
      void getSyncRootsProps().onAddFolderByInput();
    });
    await act(async () => {
      await flushMicrotasks();
    });
    uStep3();
    await act(async () => {
      listAfterUpsertDeferred.resolve([createSampleRoot()]);
      await flushMicrotasks();
    });

    // toggle (2件中の片側非一致分岐 + listActive 中アンマウント) / remove (アンマウント後 resolve)
    const toggleListDeferred = createDeferred<readonly DriveSyncRootRecord[]>();
    const repoToggleUnmount = createMockSyncRootsRepo({
      listActive: vi
        .fn()
        .mockResolvedValueOnce([
          createSampleRoot({ folderId: "folder-comics" }),
          createSampleRoot({ folderId: "folder-other", folderName: "Other" }),
        ])
        .mockImplementationOnce(() => toggleListDeferred.promise),
      setEnabled: vi.fn(async () => createSampleRoot()),
    });
    const { unmount: uToggleList } = await renderSettings({
      authBridge,
      syncRootsRepo: repoToggleUnmount,
      folderClient,
    });
    act(() => {
      void getSyncRootsProps().onToggleRootEnabled("folder-comics", false);
    });
    await act(async () => {
      await flushMicrotasks();
    });
    uToggleList();
    await act(async () => {
      toggleListDeferred.resolve([]);
      await flushMicrotasks();
    });

    const resolveRemoveOnly = createDeferred<void>();
    const repoRemoveStep1 = createMockSyncRootsRepo({
      listActive: vi.fn(async () => [createSampleRoot()]),
      removeRoot: vi.fn(() => resolveRemoveOnly.promise),
    });
    const { unmount: uRemove1 } = await renderSettings({
      authBridge,
      syncRootsRepo: repoRemoveStep1,
      folderClient,
    });
    act(() => {
      void getSyncRootsProps().onRemoveRoot("folder-comics");
    });
    uRemove1();
    await act(async () => {
      resolveRemoveOnly.resolve(undefined);
      await flushMicrotasks();
    });

    const listAfterRemoveDeferred =
      createDeferred<readonly DriveSyncRootRecord[]>();
    const repoRemoveStep2 = createMockSyncRootsRepo({
      listActive: vi
        .fn()
        .mockResolvedValueOnce([createSampleRoot()])
        .mockImplementationOnce(() => listAfterRemoveDeferred.promise),
      removeRoot: vi.fn(async () => undefined),
    });
    const { unmount: uRemove2 } = await renderSettings({
      authBridge,
      syncRootsRepo: repoRemoveStep2,
      folderClient,
    });
    act(() => {
      void getSyncRootsProps().onRemoveRoot("folder-comics");
    });
    await act(async () => {
      await flushMicrotasks();
    });
    uRemove2();
    await act(async () => {
      listAfterRemoveDeferred.resolve([]);
      await flushMicrotasks();
    });

    // toggle / remove のアンマウント後 reject 無視
    const rejectToggle = createDeferred<DriveSyncRootRecord | null>();
    const rejectRemove = createDeferred<void>();
    const repoStale2 = createMockSyncRootsRepo({
      listActive: vi.fn(async () => [createSampleRoot()]),
      setEnabled: vi.fn(() => rejectToggle.promise),
      removeRoot: vi.fn(() => rejectRemove.promise),
    });
    const { unmount: uStaleToggle } = await renderSettings({
      authBridge,
      syncRootsRepo: repoStale2,
      folderClient,
    });
    act(() => {
      void getSyncRootsProps().onToggleRootEnabled("folder-comics", false);
      void getSyncRootsProps().onRemoveRoot("folder-comics");
    });
    uStaleToggle();
    await act(async () => {
      rejectToggle.reject(new Error("late toggle err"));
      rejectRemove.reject(new Error("late remove err"));
      await flushMicrotasks();
    });
  });

  it("DriveFolderPickerModalの階層移動・パンくず・ページネーション・保存・エラー・Escape/戻る優先度2制御が動作すること (AC-ST-02, AC-ST-06)", async () => {
    const session: GoogleAuthSession = {
      email: "reader@example.com",
      accessToken: "ya29.ok",
      expiresAt: Date.now() + 3_600_000,
    };
    const authBridge = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => session),
    });
    let activeRoots: DriveSyncRootRecord[] = [];
    const syncRootsRepo = createMockSyncRootsRepo({
      listActive: vi.fn(async () => [...activeRoots]),
      upsertRoot: vi.fn(async (input) => {
        const rec = createSampleRoot({
          folderId: input.folderId,
          folderName: input.folderName,
        });
        activeRoots = [...activeRoots, rec];
        return rec;
      }),
    });
    const folderClient = createMockDriveFolderClient({
      listChildFolders: vi.fn(async (parentId, options) => {
        if (parentId === "root") {
          return options?.pageToken === "page-2"
            ? {
                folders: [{ id: "f-manga", name: "自炊マンガ" }],
                nextPageToken: null,
              }
            : {
                folders: [{ id: "f-comics", name: "Comics" }],
                nextPageToken: "page-2",
              };
        }
        return {
          folders: [{ id: "f-action", name: "アクション" }],
          nextPageToken: null,
        };
      }),
    });

    let registeredModalBack: (() => void) | null = null;
    const onRegisterModalBack = vi.fn((fn: (() => void) | null) => {
      registeredModalBack = fn;
    });

    const { unmount } = await renderSettings(
      { authBridge, syncRootsRepo, folderClient },
      { onRegisterModalBack },
    );

    expect(registeredModalBack).toBeNull();

    // 1. モーダルを開く -> root 読込 + onRegisterModalBack 登録
    await act(async () => {
      getSyncRootsProps().onOpenFolderPicker();
      await flushMicrotasks();
    });
    expect(getPickerProps().isOpen).toBe(true);
    expect(getPickerProps().folders).toEqual([
      { id: "f-comics", name: "Comics" },
    ]);
    expect(getPickerProps().nextPageToken).toBe("page-2");
    expect(registeredModalBack).toEqual(expect.any(Function));

    // 2. さらに読み込む (page-2)
    await act(async () => {
      getPickerProps().onLoadMore();
      await flushMicrotasks();
    });
    expect(getPickerProps().folders).toEqual([
      { id: "f-comics", name: "Comics" },
      { id: "f-manga", name: "自炊マンガ" },
    ]);
    expect(getPickerProps().nextPageToken).toBeNull();
    // nextPageToken=null 時の onLoadMore はノーオペ
    const callCountAfterLoadMore = vi.mocked(folderClient.listChildFolders).mock
      .calls.length;
    await act(async () => {
      getPickerProps().onLoadMore();
    });
    expect(folderClient.listChildFolders).toHaveBeenCalledTimes(
      callCountAfterLoadMore,
    );

    // 3. サブフォルダへドリルダウン & パンくず戻り (無効インデックス/末尾インデックスは無視)
    await act(async () => {
      getPickerProps().onOpenFolder({ id: "f-comics", name: "Comics" });
      await flushMicrotasks();
    });
    expect(getPickerProps().breadcrumbs).toEqual([
      { id: "root", name: "マイドライブ" },
      { id: "f-comics", name: "Comics" },
    ]);
    expect(getPickerProps().folders).toEqual([
      { id: "f-action", name: "アクション" },
    ]);

    act(() => {
      getPickerProps().onNavigateBreadcrumb(-1);
      getPickerProps().onNavigateBreadcrumb(1); // 現在階層
    });
    expect(getPickerProps().breadcrumbs).toHaveLength(2);

    await act(async () => {
      getPickerProps().onNavigateBreadcrumb(0);
      await flushMicrotasks();
    });
    expect(getPickerProps().breadcrumbs).toEqual([
      { id: "root", name: "マイドライブ" },
    ]);

    // 4. root 階層での onConfirmCurrentFolder は保存抑止（防御ガード）
    await act(async () => {
      await getPickerProps().onConfirmCurrentFolder();
    });
    expect(syncRootsRepo.upsertRoot).not.toHaveBeenCalled();

    // 5. サブ階層で「このフォルダを追加」確定保存（保存中閉鎖抑止＋Escape無視＋isBackBlocked）
    await act(async () => {
      getPickerProps().onOpenFolder({ id: "f-comics", name: "Comics" });
      await flushMicrotasks();
    });
    const upsertDeferred = createDeferred<DriveSyncRootRecord>();
    vi.mocked(syncRootsRepo.upsertRoot).mockImplementationOnce(
      async (input) => {
        const rec = await upsertDeferred.promise;
        activeRoots = [
          ...activeRoots,
          createSampleRoot({
            folderId: input.folderId,
            folderName: input.folderName,
          }),
        ];
        return rec;
      },
    );
    act(() => {
      void getPickerProps().onConfirmCurrentFolder();
      void getPickerProps().onSelectFolder({
        id: "f-action",
        name: "アクション",
      });
    });
    expect(getPickerProps().isSaving).toBe(true);
    expect(getHeaderProps().isBackBlocked).toBe(true);

    // 保存中は Escape / onClose / onOpenFolder / onNavigateBreadcrumb / onLoadMore をブロック
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => {
      getPickerProps().onClose();
      getPickerProps().onNavigateBreadcrumb(0);
      getPickerProps().onOpenFolder({ id: "f-action", name: "アクション" });
      getPickerProps().onLoadMore();
    });
    expect(getPickerProps().isOpen).toBe(true);

    await act(async () => {
      upsertDeferred.resolve(createSampleRoot({ folderId: "f-comics" }));
      await flushMicrotasks();
    });
    expect(getPickerProps().isOpen).toBe(false);
    expect(registeredModalBack).toBeNull();
    expect(getSyncRootsProps().roots).toHaveLength(1);

    // 6. 保存失敗時はモーダルを開いたままエラー表示、onSelectFolder で再追加成功
    await act(async () => {
      getSyncRootsProps().onOpenFolderPicker();
      await flushMicrotasks();
    });
    vi.mocked(syncRootsRepo.upsertRoot).mockRejectedValueOnce(
      new Error("picker save failed"),
    );
    await act(async () => {
      await getPickerProps().onSelectFolder({ id: "f-comics", name: "Comics" });
    });
    expect(getPickerProps().isOpen).toBe(true);
    expect(getPickerProps().errorMessage).toContain("保存に失敗");

    // 7. Escape キーおよび登録済み onRegisterModalBack でモーダルのみ閉鎖
    fireEvent.keyDown(window, { key: "Escape" });
    expect(getPickerProps().isOpen).toBe(false);

    await act(async () => {
      getSyncRootsProps().onOpenFolderPicker();
      await flushMicrotasks();
    });
    expect(getPickerProps().isOpen).toBe(true);
    act(() => {
      registeredModalBack?.();
    });
    expect(getPickerProps().isOpen).toBe(false);

    // 8. listChildFolders 失敗時・読込中閉鎖による Abort / 古い応答破棄
    const delayedList = createDeferred<DriveFolderPage>();
    vi.mocked(folderClient.listChildFolders)
      .mockRejectedValueOnce(new DriveApiError("FORBIDDEN", "forbidden"))
      .mockImplementationOnce(() => delayedList.promise);

    await act(async () => {
      getSyncRootsProps().onOpenFolderPicker();
      await flushMicrotasks();
    });
    expect(getPickerProps().errorMessage).toContain("権限がありません");
    act(() => {
      getPickerProps().onClose();
    });

    act(() => {
      getSyncRootsProps().onOpenFolderPicker();
    });
    act(() => {
      getPickerProps().onClose();
    });
    await act(async () => {
      delayedList.reject(new DOMException("aborted", "AbortError"));
      await flushMicrotasks();
    });

    // 読込中の階層移動(前リクエストabort)と読込中フォルダ確定(savePickedFolder側abort)
    let firstListSignal: AbortSignal | undefined;
    let secondListSignal: AbortSignal | undefined;
    const firstListDeferred = createDeferred<DriveFolderPage>();
    const secondListDeferred = createDeferred<DriveFolderPage>();
    vi.mocked(folderClient.listChildFolders)
      .mockImplementationOnce((_id, options) => {
        firstListSignal = options?.signal;
        return firstListDeferred.promise;
      })
      .mockImplementationOnce((_id, options) => {
        secondListSignal = options?.signal;
        return secondListDeferred.promise;
      });
    act(() => {
      getSyncRootsProps().onOpenFolderPicker();
    });
    expect(firstListSignal?.aborted).toBe(false);
    act(() => {
      getPickerProps().onOpenFolder({ id: "f-race", name: "Race" });
    });
    expect(firstListSignal?.aborted).toBe(true);
    expect(secondListSignal?.aborted).toBe(false);
    await act(async () => {
      await getPickerProps().onSelectFolder({ id: "f-race", name: "Race" });
    });
    expect(secondListSignal?.aborted).toBe(true);
    expect(getPickerProps().isOpen).toBe(false);
    expect(getPickerProps().isLoading).toBe(false);
    expect(getPickerProps().isLoadingMore).toBe(false);

    // onLoadMore 待機中に別フォルダ移動・パンくず移動・選択保存しても isLoadingMore が固着しないこと (PR #82 P2)
    const staleLoadMoreDeferred = createDeferred<DriveFolderPage>();
    const staleLoadMoreForSave = createDeferred<DriveFolderPage>();
    vi.mocked(folderClient.listChildFolders)
      .mockResolvedValueOnce({
        folders: [{ id: "f-comics", name: "Comics" }],
        nextPageToken: "page-2",
      })
      .mockImplementationOnce(() => staleLoadMoreDeferred.promise)
      .mockResolvedValueOnce({
        folders: [{ id: "f-sub", name: "Sub" }],
        nextPageToken: "sub-p2",
      })
      .mockImplementationOnce(() => staleLoadMoreForSave.promise)
      .mockResolvedValueOnce({
        folders: [{ id: "f-reopen", name: "Reopened" }],
        nextPageToken: null,
      });

    await act(async () => {
      getSyncRootsProps().onOpenFolderPicker();
      await flushMicrotasks();
    });
    expect(getPickerProps().nextPageToken).toBe("page-2");

    act(() => {
      getPickerProps().onLoadMore();
    });
    expect(getPickerProps().isLoadingMore).toBe(true);

    // 1. loadMore 待機中に別階層へ移動すると即座に isLoadingMore が解除され、読込完了後も再操作可能
    act(() => {
      getPickerProps().onOpenFolder({ id: "f-comics", name: "Comics" });
    });
    expect(getPickerProps().isLoadingMore).toBe(false);
    await act(async () => {
      await flushMicrotasks();
    });
    expect(getPickerProps().isLoading).toBe(false);
    expect(getPickerProps().isLoadingMore).toBe(false);
    expect(getPickerProps().nextPageToken).toBe("sub-p2");
    await act(async () => {
      staleLoadMoreDeferred.reject(new DOMException("aborted", "AbortError"));
      await flushMicrotasks();
    });

    // 2. loadMore 待機中にフォルダを選択確定して閉じると、isLoadingMore/isLoading が確実に解除される
    act(() => {
      getPickerProps().onLoadMore();
    });
    expect(getPickerProps().isLoadingMore).toBe(true);
    await act(async () => {
      await getPickerProps().onSelectFolder({ id: "f-sub", name: "Sub" });
    });
    expect(getPickerProps().isOpen).toBe(false);
    expect(getPickerProps().isLoading).toBe(false);
    expect(getPickerProps().isLoadingMore).toBe(false);
    await act(async () => {
      staleLoadMoreForSave.reject(new DOMException("aborted", "AbortError"));
      await flushMicrotasks();
    });

    await act(async () => {
      getSyncRootsProps().onOpenFolderPicker();
      await flushMicrotasks();
    });
    expect(getPickerProps().isLoadingMore).toBe(false);
    act(() => {
      getPickerProps().onClose();
    });

    // 読込中のアンマウント後の resolve 無視
    const pendingListForUnmount = createDeferred<DriveFolderPage>();
    vi.mocked(folderClient.listChildFolders).mockImplementationOnce(
      () => pendingListForUnmount.promise,
    );
    act(() => {
      getSyncRootsProps().onOpenFolderPicker();
    });
    unmount();
    expect(registeredModalBack).toBeNull();
    await act(async () => {
      pendingListForUnmount.resolve({ folders: [], nextPageToken: null });
      await flushMicrotasks();
    });

    // savePickedFolder の upsertRoot / listActive / catch アンマウント後無視
    const pickerUpsertOk = createDeferred<DriveSyncRootRecord>();
    const repoPickerU1 = createMockSyncRootsRepo({
      listActive: vi.fn(async () => []),
      upsertRoot: vi.fn(() => pickerUpsertOk.promise),
    });
    const { unmount: uPicker1 } = await renderSettings({
      authBridge,
      syncRootsRepo: repoPickerU1,
      folderClient,
    });
    await act(async () => {
      getSyncRootsProps().onOpenFolderPicker();
      await flushMicrotasks();
    });
    act(() => {
      void getPickerProps().onSelectFolder({ id: "f-u1", name: "U1" });
    });
    uPicker1();
    await act(async () => {
      pickerUpsertOk.resolve(createSampleRoot());
      await flushMicrotasks();
    });

    const pickerListOk = createDeferred<readonly DriveSyncRootRecord[]>();
    const repoPickerU2 = createMockSyncRootsRepo({
      listActive: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockImplementationOnce(() => pickerListOk.promise),
      upsertRoot: vi.fn(async () => createSampleRoot()),
    });
    const { unmount: uPicker2 } = await renderSettings({
      authBridge,
      syncRootsRepo: repoPickerU2,
      folderClient,
    });
    await act(async () => {
      getSyncRootsProps().onOpenFolderPicker();
      await flushMicrotasks();
    });
    act(() => {
      void getPickerProps().onSelectFolder({ id: "f-u2", name: "U2" });
    });
    await act(async () => {
      await flushMicrotasks();
    });
    uPicker2();
    await act(async () => {
      pickerListOk.resolve([createSampleRoot()]);
      await flushMicrotasks();
    });

    const pickerUpsertErr = createDeferred<DriveSyncRootRecord>();
    const repoPickerU3 = createMockSyncRootsRepo({
      listActive: vi.fn(async () => []),
      upsertRoot: vi.fn(() => pickerUpsertErr.promise),
    });
    const { unmount: uPicker3 } = await renderSettings({
      authBridge,
      syncRootsRepo: repoPickerU3,
      folderClient,
    });
    await act(async () => {
      getSyncRootsProps().onOpenFolderPicker();
      await flushMicrotasks();
    });
    act(() => {
      void getPickerProps().onSelectFolder({ id: "f-u3", name: "U3" });
    });
    uPicker3();
    await act(async () => {
      pickerUpsertErr.reject(new Error("late picker save fail"));
      await flushMicrotasks();
    });
  });

  it("DiagnosticsSectionへの一覧供給・クリップボードコピー(成功/不在/拒否)・クリアが動作すること (AC-ST-05)", async () => {
    const logger = createDiagnosticLogger(20);
    logger.info("app", "init");
    logger.warn("oauth", "token leaked", "Bearer ya29.secret-abc");

    const writeTextMock = vi.fn<(text: string) => Promise<void>>(
      async () => undefined,
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    await renderSettings({}, { logger });
    expect(getDiagnosticsProps().entries).toHaveLength(2);
    expect(getDiagnosticsProps().copyStatus).toBe("idle");

    // 1. コピー成功
    await act(async () => {
      await getDiagnosticsProps().onCopyDiagnostics();
    });
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock.mock.calls[0]?.[0]).toContain("Bearer [REDACTED]");
    expect(writeTextMock.mock.calls[0]?.[0]).not.toContain("ya29.secret-abc");
    expect(getDiagnosticsProps().copyStatus).toBe("copied");

    // 2. ログクリア
    act(() => {
      getDiagnosticsProps().onClearDiagnostics();
    });
    expect(getDiagnosticsProps().entries).toEqual([]);
    expect(getDiagnosticsProps().copyStatus).toBe("idle");

    // 3. writeText 拒否 -> failed
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("clipboard denied");
        }),
      },
    });
    await act(async () => {
      await getDiagnosticsProps().onCopyDiagnostics();
    });
    expect(getDiagnosticsProps().copyStatus).toBe("failed");

    // 4. clipboard 不在 -> failed
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    await act(async () => {
      await getDiagnosticsProps().onCopyDiagnostics();
    });
    expect(getDiagnosticsProps().copyStatus).toBe("failed");
  });

  it("Syncingストーリーおよび通常マウント時のDrive手動同期実行・排他保護・TR-09非ブロック継続を検証すること (AC-ST-08)", async () => {
    // 1. Syncing ストーリー: isSyncing=true が Account/Roots へ伝播しつつ isBackBlocked=false を維持
    const { unmount: unmountSyncing } = await renderAndFlush(<Syncing />);
    expect(getHeaderProps().isBackBlocked).toBe(false);
    expect(getAccountProps().isSyncing).toBe(true);
    expect(getSyncRootsProps().isSyncing).toBe(true);
    expect(getSyncExecProps()).toMatchObject({
      authStatus: "connected",
      enabledRootCount: 1,
      syncPhase: "syncing",
      activeMode: "incremental",
      isBackBlocked: false,
    });
    unmountSyncing();

    // 2. 通常マウント時: hydrateLastSyncedAt が呼ばれ、差分同期・強制フルスキャンが実行できること
    const syncDeferred = createDeferred<{
      mode: "incremental";
      scannedRoots: number;
      upsertedVolumes: number;
      trashedVolumes: number;
      invalidatedZipCaches: number;
      syncedAt: number;
    }>();
    const syncEngine = createMockDriveSyncEngine({
      sync: vi
        .fn()
        .mockImplementationOnce(() => syncDeferred.promise)
        .mockResolvedValueOnce({
          mode: "full",
          scannedRoots: 1,
          upsertedVolumes: 5,
          trashedVolumes: 0,
          invalidatedZipCaches: 0,
          syncedAt: Date.UTC(2026, 10, 25, 13, 0, 0),
        }),
    });
    const syncMetaRepo = createMockDriveSyncMetaRepo({
      getSyncState: vi.fn(async () => ({
        startPageToken: "tok-1",
        lastDriveSyncAt: Date.UTC(2026, 10, 25, 11, 0, 0),
        syncedRootFolderIds: ["folder-comics"],
      })),
    });
    const authBridge = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => ({
        email: "reader@example.com",
        accessToken: "ya29.ok",
        expiresAt: Date.now() + 3_600_000,
      })),
    });
    const syncRootsRepo = createMockSyncRootsRepo({
      listActive: vi.fn(async () => [
        createSampleRoot({ folderId: "folder-comics", enabled: 1 }),
        createSampleRoot({ folderId: "folder-disabled", enabled: 0 }),
      ]),
    });

    let lastBackBlocked = false;
    await renderSettings({
      authBridge,
      syncRootsRepo,
      syncMetaRepo,
      syncEngine,
      routerProbe: (blocked) => {
        lastBackBlocked = blocked;
      },
    });

    expect(syncMetaRepo.getSyncState).toHaveBeenCalledTimes(1);
    expect(getSyncExecProps()).toMatchObject({
      authStatus: "connected",
      enabledRootCount: 1,
      syncPhase: "idle",
      lastSyncedAt: Date.UTC(2026, 10, 25, 11, 0, 0),
      isBackBlocked: false,
    });

    // 差分同期開始 -> syncing 中は isBackBlocked=false のままログアウト・ルート変更がガードされること
    act(() => {
      getSyncExecProps().onRunIncrementalSync();
    });
    expect(getSyncExecProps().syncPhase).toBe("syncing");
    expect(getAccountProps().isSyncing).toBe(true);
    expect(getSyncRootsProps().isSyncing).toBe(true);
    expect(lastBackBlocked).toBe(false);

    // 同期実行中の排他ガード確認（直接ハンドラ呼び出しでも通信・DB更新しないこと）
    await act(async () => {
      getAccountProps().onSignOut();
      getSyncRootsProps().onOpenFolderPicker();
      getSyncRootsProps().onAddFolderByInput();
      getSyncRootsProps().onToggleRootEnabled("folder-comics", false);
      getSyncRootsProps().onRemoveRoot("folder-comics");
      await flushMicrotasks();
    });
    expect(authBridge.signOut).not.toHaveBeenCalled();
    expect(syncRootsRepo.setEnabled).not.toHaveBeenCalled();
    expect(syncRootsRepo.removeRoot).not.toHaveBeenCalled();

    // 差分同期完了
    await act(async () => {
      syncDeferred.resolve({
        mode: "incremental",
        scannedRoots: 1,
        upsertedVolumes: 2,
        trashedVolumes: 0,
        invalidatedZipCaches: 0,
        syncedAt: Date.UTC(2026, 10, 25, 12, 0, 0),
      });
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(syncEngine.sync).toHaveBeenNthCalledWith(1, {
      forceFullScan: false,
    });
    expect(useDriveSyncStateStore.getState().phase).toBe("completed");

    // 強制フルスキャン実行
    await act(async () => {
      getSyncExecProps().onRunFullScan();
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(syncEngine.sync).toHaveBeenNthCalledWith(2, { forceFullScan: true });
    expect(getSyncExecProps().lastResult?.mode).toBe("full");
  });

  it("CoverExtractionSectionへストアおよびinitialSnapshotの表紙抽出状態を配線し、再試行操作とルート変更時のsyncQueue呼び出しを連携すること (AC-ST-04, AC-ST-09)", async () => {
    // 1. ConnectedWithRoots ストーリー: initialSnapshot.coverExtractionState が渡ること
    const { unmount: u1 } = await renderAndFlush(<ConnectedWithRoots />);
    expect(getCoverExtractionProps()).toMatchObject({
      authStatus: "connected",
      enabledRootCount: 1,
      syncPhase: "completed",
      isBackBlocked: false,
      extractionState: {
        phase: "running",
        totalCount: 12,
        readyCount: 8,
        pendingCount: 3,
        errorCount: 1,
      },
    });
    u1();

    // 2. Unlinked ストーリー: initialSnapshot.coverExtractionState 省略時は既定スナップショットへフォールバック
    const { unmount: u2 } = await renderAndFlush(<Unlinked />);
    expect(getCoverExtractionProps().extractionState).toEqual(
      INITIAL_COVER_EXTRACTION_SNAPSHOT,
    );
    u2();

    // 3. 通常マウント時: useCoverExtractionStateStore 参照・retryFailedCovers 呼出・ルート追加/切替/削除時の syncQueue 呼出
    const initialCoverSnapshot = {
      phase: "idle" as const,
      totalCount: 10,
      readyCount: 7,
      pendingCount: 0,
      errorCount: 3,
      activeVolumeId: null,
      pauseReasons: [],
    };
    const coverExtractionScheduler = createMockCoverExtractionScheduler({
      getSnapshot: vi.fn(() => initialCoverSnapshot),
    });
    const authBridge = createMockGoogleAuthBridge({
      getCachedSession: vi.fn(() => ({
        email: "reader@example.com",
        accessToken: "ya29.ok",
        expiresAt: Date.now() + 3_600_000,
      })),
    });
    const syncRootsRepo = createMockSyncRootsRepo({
      listActive: vi
        .fn()
        .mockResolvedValueOnce([
          createSampleRoot({ folderId: "folder-a", enabled: 1 }),
        ])
        .mockResolvedValueOnce([
          createSampleRoot({ folderId: "folder-a", enabled: 1 }),
          createSampleRoot({ folderId: "folder-b", enabled: 1 }),
        ])
        .mockResolvedValueOnce([
          createSampleRoot({ folderId: "folder-a", enabled: 1 }),
          createSampleRoot({ folderId: "folder-b", enabled: 1 }),
          createSampleRoot({ folderId: "folder-c", enabled: 1 }),
        ])
        .mockResolvedValueOnce([
          createSampleRoot({ folderId: "folder-a", enabled: 0 }),
          createSampleRoot({ folderId: "folder-b", enabled: 1 }),
          createSampleRoot({ folderId: "folder-c", enabled: 1 }),
        ])
        .mockResolvedValueOnce([
          createSampleRoot({ folderId: "folder-b", enabled: 1 }),
          createSampleRoot({ folderId: "folder-c", enabled: 1 }),
        ]),
    });

    await renderSettings({
      authBridge,
      syncRootsRepo,
      coverExtractionScheduler,
    });

    expect(getCoverExtractionProps()).toMatchObject({
      authStatus: "connected",
      enabledRootCount: 1,
      extractionState: {
        phase: "idle",
        totalCount: 10,
        readyCount: 7,
        pendingCount: 0,
        errorCount: 3,
      },
    });

    // 再試行ボタンコールバック
    act(() => {
      getCoverExtractionProps().onRetryFailedCovers();
    });
    expect(coverExtractionScheduler.retryFailedCovers).toHaveBeenCalledTimes(1);

    const syncQueueMock = vi.mocked(coverExtractionScheduler.syncQueue);
    syncQueueMock.mockClear();

    // URL/ID によるルート追加 -> syncQueue
    act(() => {
      getSyncRootsProps().onChangeFolderInput("folder-b");
    });
    await act(async () => {
      getSyncRootsProps().onAddFolderByInput();
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(syncQueueMock).toHaveBeenCalledTimes(1);

    // ピッカー確定によるルート追加 -> syncQueue
    await act(async () => {
      getPickerProps().onSelectFolder({ id: "folder-c", name: "Folder C" });
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(syncQueueMock).toHaveBeenCalledTimes(2);

    // 有効/無効トグル -> syncQueue
    await act(async () => {
      getSyncRootsProps().onToggleRootEnabled("folder-a", false);
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(syncQueueMock).toHaveBeenCalledTimes(3);

    // ルート登録解除 -> syncQueue
    await act(async () => {
      getSyncRootsProps().onRemoveRoot("folder-a");
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(syncQueueMock).toHaveBeenCalledTimes(4);
  });
});
