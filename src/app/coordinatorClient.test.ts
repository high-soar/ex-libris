import * as Comlink from "comlink";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ArchiveSourceDescriptor,
  CoordinatorWorkerApi,
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
  });
});
