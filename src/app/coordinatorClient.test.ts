import * as Comlink from "comlink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import type {
  ArchiveSourceDescriptor,
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
    session.api.cancelEpochBelow(1);
    expect(rawApi.updateAccessToken).toHaveBeenCalledWith("token-1");
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
    session.api.cancelEpochBelow(2);
    expect(rawApi.updateAccessToken).toHaveBeenCalledTimes(1);
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
});
