import * as Comlink from "comlink";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AuthSessionListener,
  GoogleAuthBridge,
  GoogleAuthSession,
} from "../bridges/oauth/types";
import {
  createDiagnosticLogger,
  diagnosticLogger,
} from "../diagnostics/diagnosticLogger";
import type {
  ArchiveSourceDescriptor,
  CoordinatorHostCallbacks,
  CoordinatorWorkerApi,
  DecodedPageFrame,
  OpenArchiveResult,
} from "../engine/types";
import { ZipArchiveError } from "../engine/zip/errors";
import { createCoordinatorSession } from "./coordinatorClient";

const originalThrowHandler = Comlink.transferHandlers.get("throw");

function createDummyLocalSource(): ArchiveSourceDescriptor {
  const file = new File(["dummy"], "sample.zip", { type: "application/zip" });
  return {
    kind: "local-session",
    file,
    rawFileName: file.name,
    fileSize: file.size,
    indexCacheKey: `local:${file.name}:${file.size}`,
    progressTargetKey: `local:${file.name}:${file.size}`,
  };
}

describe("coordinatorClient", () => {
  afterEach(() => {
    if (originalThrowHandler) {
      Comlink.transferHandlers.set("throw", originalThrowHandler);
    }
    diagnosticLogger.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("デフォルト実行時にregisterZipArchiveErrorTransferHandler・Worker生成・Comlink.wrap・dispose一式を実行すること", async () => {
    const workerInvocations: Array<{
      url: string | URL;
      options?: WorkerOptions;
    }> = [];
    const terminateSpy = vi.fn();

    class MockChannelWorker {
      private readonly port1: MessagePort;
      private readonly port2: MessagePort;

      constructor(url: string | URL, options?: WorkerOptions) {
        workerInvocations.push({ url, options });
        const channel = new MessageChannel();
        this.port1 = channel.port1;
        this.port2 = channel.port2;
        this.port2.start();

        const remoteImpl: CoordinatorWorkerApi = {
          async openArchive() {
            throw new ZipArchiveError("CORRUPT_ZIP", "壊れたZIPテスト");
          },
          async requestVisiblePages() {
            return [];
          },
          updateAccessToken() {},
          setHostCallbacks() {},
          cancelEpochBelow() {},
          async closeArchive() {},
        };
        Comlink.expose(remoteImpl, this.port1);
      }

      postMessage(message: unknown, transfer: Transferable[] = []): void {
        this.port2.postMessage(message, transfer);
      }

      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ): void {
        this.port2.addEventListener(type, listener);
      }

      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ): void {
        this.port2.removeEventListener(type, listener);
      }

      terminate(): void {
        terminateSpy();
        this.port1.close();
        this.port2.close();
      }
    }

    vi.stubGlobal("Worker", MockChannelWorker);

    const session = createCoordinatorSession();

    expect(workerInvocations).toHaveLength(1);
    expect(String(workerInvocations[0]?.url)).toContain(
      "coordinator.worker.ts",
    );
    expect(workerInvocations[0]?.options).toEqual({ type: "module" });

    // UI スレッド側にも ZipArchiveError TransferHandler が登録されていること
    let caughtError: unknown;
    try {
      await session.api.openArchive(createDummyLocalSource(), null, 1);
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(ZipArchiveError);
    expect((caughtError as ZipArchiveError).code).toBe("CORRUPT_ZIP");

    // dispose() で Comlink.releaseProxy と worker.terminate() が実行され、2回目以降は冪等であること
    session.dispose();
    session.dispose();

    expect(terminateSpy).toHaveBeenCalledTimes(1);
    expect(() => session.api.closeArchive()).toThrow(
      "Proxy has been released and is not useable",
    );
  });

  it("createWorker/wrapWorker/registerErrorHandlerのDI注入時およびreleaseProxy未定義・送出時も確実にterminateされること", () => {
    const callOrder: string[] = [];
    const terminatePlain = vi.fn(() => {
      callOrder.push("terminatePlain");
    });
    const plainApi: CoordinatorWorkerApi = {
      openArchive: vi.fn(),
      requestVisiblePages: vi.fn(),
      updateAccessToken: vi.fn(),
      setHostCallbacks: vi.fn(),
      cancelEpochBelow: vi.fn(),
      closeArchive: vi.fn(),
    };

    const plainSession = createCoordinatorSession({
      registerErrorHandler: () => {
        callOrder.push("register");
      },
      createWorker: () => {
        callOrder.push("createWorker");
        return { terminate: terminatePlain };
      },
      wrapWorker: (worker) => {
        expect(worker.terminate).toBe(terminatePlain);
        callOrder.push("wrapWorker");
        return plainApi;
      },
    });

    expect(callOrder).toEqual(["register", "createWorker", "wrapWorker"]);
    expect(plainSession.api).toBe(plainApi);

    plainSession.dispose();
    plainSession.dispose();
    expect(terminatePlain).toHaveBeenCalledTimes(1);

    // releaseProxy が例外を投げても worker.terminate() が確実に実行されること
    const terminateAfterError = vi.fn();
    const throwingReleaseApi = {
      ...plainApi,
      [Comlink.releaseProxy]: () => {
        throw new Error("release failure");
      },
    };
    const throwingSession = createCoordinatorSession({
      registerErrorHandler: vi.fn(),
      createWorker: () => ({ terminate: terminateAfterError }),
      wrapWorker: () => throwingReleaseApi,
    });

    expect(() => throwingSession.dispose()).toThrow("release failure");
    expect(terminateAfterError).toHaveBeenCalledTimes(1);
    // 2回目の dispose() は disposed 済みのため再送出せずノーオペ
    expect(() => throwingSession.dispose()).not.toThrow();
    expect(terminateAfterError).toHaveBeenCalledTimes(1);

    // wrapWorker が失敗した場合は生成済み Worker を即座に terminate して再送出すること
    const terminateOnWrapFail = vi.fn();
    expect(() =>
      createCoordinatorSession({
        registerErrorHandler: vi.fn(),
        createWorker: () => ({ terminate: terminateOnWrapFail }),
        wrapWorker: () => {
          throw new Error("wrap failure");
        },
      }),
    ).toThrow("wrap failure");
    expect(terminateOnWrapFail).toHaveBeenCalledTimes(1);
  });

  it("Workerのerrorイベント発火時に診断ログ記録・リスナー解除・保留中および以後の非同期RPCを即座にREAD_ERRORでrejectしdispose後の同期フォワードを壊さないこと", async () => {
    const bus = new EventTarget();
    const removeSpy = vi.fn(
      (type: "error" | "messageerror", listener: (event: Event) => void) => {
        bus.removeEventListener(type, listener);
      },
    );
    const terminateSpy = vi.fn();

    let resolvePendingOpen!: (
      val: Awaited<ReturnType<CoordinatorWorkerApi["openArchive"]>>,
    ) => void;
    let rejectPendingPages!: (err: unknown) => void;
    let resolvePendingClose!: () => void;

    const rawApi: CoordinatorWorkerApi & {
      [Comlink.releaseProxy]?: () => void;
    } = {
      openArchive: vi.fn(
        () =>
          new Promise<OpenArchiveResult>((resolve) => {
            resolvePendingOpen = resolve;
          }),
      ),
      requestVisiblePages: vi.fn(
        () =>
          new Promise<DecodedPageFrame[]>((_, reject) => {
            rejectPendingPages = reject;
          }),
      ),
      updateAccessToken: vi.fn(),
      setHostCallbacks: vi.fn(),
      cancelEpochBelow: vi.fn(),
      closeArchive: vi.fn(() => {
        if (disposedFlag) {
          throw new Error("Proxy has been released and is not useable");
        }
        return new Promise<void>((resolve) => {
          resolvePendingClose = resolve;
        });
      }),
      [Comlink.releaseProxy]: vi.fn(),
    };

    let disposedFlag = false;
    const session = createCoordinatorSession({
      registerErrorHandler: vi.fn(),
      createWorker: () => ({
        addEventListener: (type, listener) =>
          bus.addEventListener(type, listener),
        removeEventListener: removeSpy,
        terminate: () => {
          disposedFlag = true;
          terminateSpy();
        },
      }),
      wrapWorker: () => rawApi,
    });

    // 正常系の同期・非同期呼び出し確認
    session.api.updateAccessToken("token-1");
    session.api.setHostCallbacks(null);
    session.api.cancelEpochBelow(1);
    expect(rawApi.updateAccessToken).toHaveBeenCalledWith("token-1");
    expect(rawApi.setHostCallbacks).toHaveBeenCalledWith(null);
    expect(rawApi.cancelEpochBelow).toHaveBeenCalledWith(1);

    const pendingOpen = session.api.openArchive(
      createDummyLocalSource(),
      null,
      1,
    );
    const pendingPages = session.api.requestVisiblePages([0], [], 1);
    const pendingClose = session.api.closeArchive();

    // ErrorEvent 発火
    bus.dispatchEvent(
      new ErrorEvent("error", {
        message: "Failed to load coordinator.worker.ts",
        filename: "coordinator.worker.ts",
        lineno: 42,
        colno: 7,
      }),
    );

    await expect(pendingOpen).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "READ_ERROR",
      message: "Coordinator Workerが異常終了しました",
    });
    await expect(pendingPages).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "READ_ERROR",
      message: "Coordinator Workerが異常終了しました",
    });
    await expect(pendingClose).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "READ_ERROR",
      message: "Coordinator Workerが異常終了しました",
    });

    expect(removeSpy).toHaveBeenCalledWith("error", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith(
      "messageerror",
      expect.any(Function),
    );
    expect(diagnosticLogger.getEntries()).toEqual([
      expect.objectContaining({
        level: "error",
        scope: "engine",
        message: "Coordinator Workerが異常終了しました",
        detail: expect.stringContaining("Failed to load coordinator.worker.ts"),
      }),
    ]);
    expect(diagnosticLogger.getEntries()[0]?.detail).toContain(
      "coordinator.worker.ts:42:7",
    );

    // 異常終了後の非同期RPCは即座に同エラーでrejectされ、同期メソッドは安全に無害化される
    await expect(
      session.api.openArchive(createDummyLocalSource(), null, 2),
    ).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "READ_ERROR",
    });
    await expect(
      session.api.requestVisiblePages([1], [], 2),
    ).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "READ_ERROR",
    });
    await expect(session.api.closeArchive()).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "READ_ERROR",
    });
    expect(rawApi.openArchive).toHaveBeenCalledTimes(1);
    expect(rawApi.requestVisiblePages).toHaveBeenCalledTimes(1);
    expect(rawApi.closeArchive).toHaveBeenCalledTimes(1);

    session.api.updateAccessToken("token-2");
    session.api.setHostCallbacks(null);
    session.api.cancelEpochBelow(2);
    expect(rawApi.updateAccessToken).toHaveBeenCalledTimes(1);
    expect(rawApi.setHostCallbacks).toHaveBeenCalledTimes(1);
    expect(rawApi.cancelEpochBelow).toHaveBeenCalledTimes(1);

    // 元の保留Promiseが後から解決・失敗しても未処理例外にならないこと
    resolvePendingOpen({
      pageCount: 1,
      entries: [],
      fromIndexCache: false,
    });
    rejectPendingPages(new Error("late worker error"));
    resolvePendingClose();
    await Promise.resolve();

    // dispose() 後の closeArchive() は既存通り同期フォワードされること
    session.dispose();
    expect(terminateSpy).toHaveBeenCalledTimes(1);
    expect(() => session.api.closeArchive()).toThrow(
      "Proxy has been released and is not useable",
    );
  });

  it("messageerror発火・wrapWorker例外時のリスナー解除・不完全イベント詳細・重複発火および同期throwを安全に処理すること", async () => {
    // 1. wrapWorker 例外時でも addEventListener したリスナーを漏れなく removeEventListener すること
    const registered = new Map<string, (event: Event) => void>();
    const removeOnWrapFail = vi.fn((type: string) => {
      registered.delete(type);
    });
    const terminateOnWrapFail = vi.fn();

    expect(() =>
      createCoordinatorSession({
        registerErrorHandler: vi.fn(),
        createWorker: () => ({
          addEventListener: (type, listener) => {
            registered.set(type, listener);
          },
          removeEventListener: removeOnWrapFail,
          terminate: terminateOnWrapFail,
        }),
        wrapWorker: () => {
          throw new Error("wrap boom");
        },
      }),
    ).toThrow("wrap boom");
    expect(removeOnWrapFail).toHaveBeenCalledTimes(2);
    expect(registered.size).toBe(0);
    expect(terminateOnWrapFail).toHaveBeenCalledTimes(1);

    // 2. messageerror イベント発火時に安全に detail を構築して reject すること
    const msgBus = new EventTarget();
    const rawMsgApi: CoordinatorWorkerApi = {
      openArchive: vi.fn(() => new Promise<OpenArchiveResult>(() => {})),
      requestVisiblePages: vi.fn(async () => []),
      updateAccessToken: vi.fn(),
      setHostCallbacks: vi.fn(),
      cancelEpochBelow: vi.fn(),
      closeArchive: vi.fn(async () => {}),
    };
    const msgSession = createCoordinatorSession({
      registerErrorHandler: vi.fn(),
      createWorker: () => ({
        addEventListener: (type, listener) =>
          msgBus.addEventListener(type, listener),
        removeEventListener: (type, listener) =>
          msgBus.removeEventListener(type, listener),
        terminate: vi.fn(),
      }),
      wrapWorker: () => rawMsgApi,
    });

    const hangingOpen = msgSession.api.openArchive(
      createDummyLocalSource(),
      null,
      1,
    );
    msgBus.dispatchEvent(new MessageEvent("messageerror"));

    await expect(hangingOpen).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "READ_ERROR",
    });
    expect(diagnosticLogger.getEntries().at(-1)?.detail).toBe(
      "type=messageerror",
    );
    msgSession.dispose();

    // 3. removeEventListener 未定義モック・重複発火・dispose後発火・位置番号欠落イベント・同期throwを安全処理すること
    diagnosticLogger.clear();
    const listeners = new Map<string, (event: Event) => void>();
    const syncThrowApi: CoordinatorWorkerApi = {
      openArchive: vi.fn(() => {
        throw new Error("sync rpc error");
      }),
      requestVisiblePages: vi.fn(async () => []),
      updateAccessToken: vi.fn(),
      setHostCallbacks: vi.fn(),
      cancelEpochBelow: vi.fn(),
      closeArchive: vi.fn(async () => {}),
    };
    const partialSession = createCoordinatorSession({
      registerErrorHandler: vi.fn(),
      createWorker: () => ({
        addEventListener: (type, listener) => {
          listeners.set(type, listener);
        },
        terminate: vi.fn(),
      }),
      wrapWorker: () => syncThrowApi,
    });

    await expect(
      partialSession.api.openArchive(createDummyLocalSource(), null, 1),
    ).rejects.toThrow("sync rpc error");

    // filename あり・lineno/colno 欠落・type 空のイベント + 重複発火
    listeners.get("error")?.({
      type: "",
      message: "",
      filename: "worker-bundle.js",
    } as unknown as Event);
    listeners.get("messageerror")?.(new MessageEvent("messageerror"));
    expect(diagnosticLogger.getEntries()).toHaveLength(1);
    expect(diagnosticLogger.getEntries()[0]?.detail).toBe(
      "type=error, location=worker-bundle.js:0:0",
    );

    partialSession.dispose();
    listeners.get("error")?.(new Event("error"));
    expect(diagnosticLogger.getEntries()).toHaveLength(1);
  });

  it("authBridge指定時にComlink.proxyコールバック登録・getCachedSession初期同期・subscribeSession追従・dispose購読解除とlogger DIを実行すること (AC-ENG-16)", async () => {
    const bus = new EventTarget();
    const removeListenerSpy = vi.fn(
      (type: "error" | "messageerror", listener: (event: Event) => void) => {
        bus.removeEventListener(type, listener);
      },
    );
    const terminateSpy = vi.fn();
    const releaseProxySpy = vi.fn();

    let registeredCallbacks: CoordinatorHostCallbacks | null = null;
    const rawApi: CoordinatorWorkerApi & {
      [Comlink.releaseProxy]?: () => void;
    } = {
      openArchive: vi.fn(),
      requestVisiblePages: vi.fn(),
      updateAccessToken: vi.fn(),
      setHostCallbacks: vi.fn((callbacks) => {
        registeredCallbacks = callbacks;
      }),
      cancelEpochBelow: vi.fn(),
      closeArchive: vi.fn(),
      [Comlink.releaseProxy]: releaseProxySpy,
    };

    let sessionListener: AuthSessionListener | null = null;
    const unsubscribeSpy = vi.fn(() => {
      sessionListener = null;
    });
    const customLogger = createDiagnosticLogger();
    const cachedSession: GoogleAuthSession = {
      email: "reader@example.com",
      accessToken: "ya29.cached-initial",
      expiresAt: Date.now() + 3_600_000,
    };
    const authBridge: GoogleAuthBridge = {
      getCachedSession: vi.fn(() => cachedSession),
      getSession: vi.fn(async () => cachedSession),
      signIn: vi.fn(async () => cachedSession),
      signOut: vi.fn(async () => {}),
      getValidAccessToken: vi.fn(async () => "ya29.refreshed-by-host"),
      subscribeSession: vi.fn((listener) => {
        sessionListener = listener;
        return unsubscribeSpy;
      }),
    };

    const session = createCoordinatorSession({
      registerErrorHandler: vi.fn(),
      createWorker: () => ({
        addEventListener: (type, listener) =>
          bus.addEventListener(type, listener),
        removeEventListener: removeListenerSpy,
        terminate: terminateSpy,
      }),
      wrapWorker: () => rawApi,
      authBridge,
      logger: customLogger,
    });

    // 1. Comlink.proxy 経由で setHostCallbacks が登録され、初期セッションが即時同期されること
    expect(rawApi.setHostCallbacks).toHaveBeenCalledTimes(1);
    expect(registeredCallbacks).not.toBeNull();
    expect(
      (registeredCallbacks as unknown as Record<symbol, unknown>)[
        Comlink.proxyMarker
      ],
    ).toBe(true);
    expect(rawApi.updateAccessToken).toHaveBeenCalledWith(
      "ya29.cached-initial",
    );

    // 2. ホストコールバックが refreshAccessToken と reportDiagnostic を中継すること
    await expect(
      registeredCallbacks!.refreshAccessToken({
        forceRefresh: true,
        failedToken: "ya29.cached-initial",
      }),
    ).resolves.toBe("ya29.refreshed-by-host");
    expect(authBridge.getValidAccessToken).toHaveBeenCalledWith({
      forceRefresh: true,
      failedToken: "ya29.cached-initial",
    });

    registeredCallbacks!.reportDiagnostic(
      "warn",
      "gdrive-range",
      "401検出",
      "range=bytes=0-1",
    );
    registeredCallbacks!.reportDiagnostic("error", "gdrive-range", "500エラー");
    expect(customLogger.getEntries()).toEqual([
      expect.objectContaining({
        level: "warn",
        scope: "gdrive-range",
        message: "401検出",
        detail: "range=bytes=0-1",
      }),
      expect.objectContaining({
        level: "error",
        scope: "gdrive-range",
        message: "500エラー",
      }),
    ]);

    // 3. subscribeSession 経由のトークン更新・サインアウト(null) が同期されること
    sessionListener!({
      email: "reader@example.com",
      accessToken: "ya29.rotated-token",
      expiresAt: Date.now() + 3_600_000,
    });
    sessionListener!(null);
    expect(rawApi.updateAccessToken).toHaveBeenNthCalledWith(
      2,
      "ya29.rotated-token",
    );
    expect(rawApi.updateAccessToken).toHaveBeenNthCalledWith(3, null);

    // 4. Worker crash は注入 logger に記録され、グローバル diagnosticLogger を汚さないこと
    bus.dispatchEvent(new Event("error"));
    expect(customLogger.getEntries().at(-1)).toMatchObject({
      level: "error",
      scope: "engine",
      message: "Coordinator Workerが異常終了しました",
    });
    expect(diagnosticLogger.getEntries()).toEqual([]);

    // 5. dispose() で subscribeSession が解除されること
    session.dispose();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(releaseProxySpy).toHaveBeenCalledTimes(1);
    expect(terminateSpy).toHaveBeenCalledTimes(1);

    // 6. getCachedSession() が null のときは初期 updateAccessToken を呼ばず、setup 失敗時は Worker 後始末すること
    const nullAuthBridge: GoogleAuthBridge = {
      ...authBridge,
      getCachedSession: vi.fn(() => null),
    };
    const updateOnNullCache = vi.fn();
    const sessionNullCache = createCoordinatorSession({
      registerErrorHandler: vi.fn(),
      createWorker: () => ({ terminate: vi.fn() }),
      wrapWorker: () => ({
        ...rawApi,
        updateAccessToken: updateOnNullCache,
        setHostCallbacks: vi.fn(),
      }),
      authBridge: nullAuthBridge,
    });
    expect(updateOnNullCache).not.toHaveBeenCalled();
    sessionNullCache.dispose();

    const failSetupRemove = vi.fn();
    const failSetupTerminate = vi.fn();
    const failSetupRelease = vi.fn();
    expect(() =>
      createCoordinatorSession({
        registerErrorHandler: vi.fn(),
        createWorker: () => ({
          addEventListener: vi.fn(),
          removeEventListener: failSetupRemove,
          terminate: failSetupTerminate,
        }),
        wrapWorker: () => ({
          ...rawApi,
          setHostCallbacks: () => {
            throw new Error("callback setup boom");
          },
          [Comlink.releaseProxy]: failSetupRelease,
        }),
        authBridge: nullAuthBridge,
      }),
    ).toThrow("callback setup boom");
    expect(failSetupRemove).toHaveBeenCalledTimes(2);
    expect(failSetupRelease).toHaveBeenCalledTimes(1);
    expect(failSetupTerminate).toHaveBeenCalledTimes(1);

    // 7. 実 MessageChannel 上で Comlink.proxy(hostCallbacks) が DataCloneError なく双方向 RPC 動作すること
    let channelHostCallbacks: CoordinatorHostCallbacks | null = null;
    const channelTokens: Array<string | null> = [];
    class BidirectionalMockWorker {
      private readonly port1: MessagePort;
      private readonly port2: MessagePort;

      constructor() {
        const channel = new MessageChannel();
        this.port1 = channel.port1;
        this.port2 = channel.port2;
        this.port2.start();

        const remoteImpl: CoordinatorWorkerApi = {
          async openArchive() {
            const refreshed = await channelHostCallbacks!.refreshAccessToken({
              forceRefresh: true,
              failedToken: "ya29.old",
            });
            channelHostCallbacks!.reportDiagnostic(
              "warn",
              "gdrive-range",
              "proxy-warn",
              refreshed,
            );
            return { pageCount: 1, entries: [], fromIndexCache: false };
          },
          async requestVisiblePages() {
            return [];
          },
          updateAccessToken(token) {
            channelTokens.push(token);
          },
          setHostCallbacks(callbacks) {
            channelHostCallbacks = callbacks;
          },
          cancelEpochBelow() {},
          async closeArchive() {},
        };
        Comlink.expose(remoteImpl, this.port1);
      }

      postMessage(message: unknown, transfer: Transferable[] = []): void {
        this.port2.postMessage(message, transfer);
      }

      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ): void {
        this.port2.addEventListener(type, listener);
      }

      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ): void {
        this.port2.removeEventListener(type, listener);
      }

      terminate(): void {
        this.port1.close();
        this.port2.close();
      }
    }

    vi.stubGlobal("Worker", BidirectionalMockWorker);
    const channelLogger = createDiagnosticLogger();
    const channelAuthBridge: GoogleAuthBridge = {
      ...authBridge,
      getCachedSession: vi.fn(() => ({
        email: "reader@example.com",
        accessToken: "ya29.channel-init",
        expiresAt: Date.now() + 3_600_000,
      })),
      getValidAccessToken: vi.fn(async () => "ya29.channel-refreshed"),
    };
    const channelSession = createCoordinatorSession({
      authBridge: channelAuthBridge,
      logger: channelLogger,
    });

    await expect(
      channelSession.api.openArchive(createDummyLocalSource(), null, 1),
    ).resolves.toEqual({ pageCount: 1, entries: [], fromIndexCache: false });
    expect(channelTokens).toEqual(["ya29.channel-init"]);
    expect(channelAuthBridge.getValidAccessToken).toHaveBeenCalledWith({
      forceRefresh: true,
      failedToken: "ya29.old",
    });
    await vi.waitFor(() => {
      expect(channelLogger.getEntries()).toEqual([
        expect.objectContaining({
          level: "warn",
          scope: "gdrive-range",
          message: "proxy-warn",
          detail: "[REDACTED]",
        }),
      ]);
    });
    channelSession.dispose();
  });
});
