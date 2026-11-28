import * as Comlink from "comlink";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagnosticLogger,
  diagnosticLogger,
} from "../diagnostics/diagnosticLogger";
import type {
  CoverResizeWorkerApi,
  EncodeCoverWebpResult,
} from "../engine/cover/types";
import { markSharedBuffer } from "../engine/workers/coordinatorTransfer";
import { ZipArchiveError } from "../engine/zip/errors";
import {
  createCoverWorkerClient,
  type CoverWorkerHandle,
  type CoverWorkerRemoteProxy,
} from "./coverWorkerClient";

const originalThrowHandler = Comlink.transferHandlers.get("throw");

describe("coverWorkerClient", () => {
  afterEach(() => {
    if (originalThrowHandler) {
      Comlink.transferHandlers.set("throw", originalThrowHandler);
    }
    diagnosticLogger.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("デフォルト実行時にregisterZipArchiveErrorTransferHandler・Worker生成・Comlink.wrap・prepareDecodeTransfer・dispose一式を実行すること (AC-COV-01)", async () => {
    const workerInvocations: Array<{
      url: string | URL;
      options?: WorkerOptions;
    }> = [];
    const terminateSpy = vi.fn();
    const expectedBlob = new Blob([new Uint8Array([1, 2, 3])], {
      type: "image/webp",
    });

    class MockChannelWorker {
      private readonly port1: MessagePort;
      private readonly port2: MessagePort;

      constructor(url: string | URL, options?: WorkerOptions) {
        workerInvocations.push({ url, options });
        const channel = new MessageChannel();
        this.port1 = channel.port1;
        this.port2 = channel.port2;
        this.port2.start();

        const remoteImpl: CoverResizeWorkerApi = {
          async encodeCoverWebp(data, method) {
            if (method === 8) {
              throw new ZipArchiveError("DECODE_FAILED", "壊れた画像");
            }
            expect(Array.from(data)).toEqual([9, 8, 7]);
            return { blob: expectedBlob, width: 200, height: 300 };
          },
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

    const client = createCoverWorkerClient();
    expect(client.isBroken()).toBe(false);
    expect(workerInvocations).toHaveLength(1);
    expect(String(workerInvocations[0]?.url)).toContain("cover.worker.ts");
    expect(workerInvocations[0]?.options).toEqual({ type: "module" });

    // 共有バッファ印付きの Uint8Array を渡しても元バッファがデタッチされず転送成功すること
    const shared = new Uint8Array([9, 8, 7]);
    markSharedBuffer(shared.buffer);
    const result = await client.api.encodeCoverWebp(shared, 0, {
      maxLongEdgePx: 350,
    });
    expect(result.width).toBe(200);
    expect(result.height).toBe(300);
    expect(shared.byteLength).toBe(3);

    // Worker 側の ZipArchiveError が型付きのまま復元されること
    await expect(
      client.api.encodeCoverWebp(new Uint8Array([1]), 8),
    ).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "DECODE_FAILED",
    });

    client.dispose();
    client.dispose();
    expect(terminateSpy).toHaveBeenCalledTimes(1);
  });

  it("Workerのerror/messageerror発生時に診断ログ記録・isBroken()=true・保留中および後続RPCの即時DECODE_FAILED rejectを行うこと (AC-COV-01)", async () => {
    const listeners = new Map<string, Set<(event: Event) => void>>();
    const terminate = vi.fn();
    const worker: CoverWorkerHandle = {
      terminate,
      addEventListener: (type, listener) => {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener: (type, listener) => {
        listeners.get(type)?.delete(listener);
      },
    };

    const rawApi: CoverWorkerRemoteProxy = {
      encodeCoverWebp: vi.fn(
        () => new Promise<EncodeCoverWebpResult>(() => undefined),
      ),
      [Comlink.releaseProxy]: vi.fn(),
    };

    const logger = createDiagnosticLogger();
    const client = createCoverWorkerClient({
      createWorker: () => worker,
      wrapWorker: () => rawApi,
      registerErrorHandler: vi.fn(),
      logger,
    });

    const inFlight = client.api.encodeCoverWebp(new Uint8Array([1, 2]), 0);
    expect(client.isBroken()).toBe(false);

    // error イベント発火（詳細フィールド付き）
    const errorEvent = Object.assign(new Event("error"), {
      message: "OOM crash",
      filename: "cover.worker.ts",
      lineno: 12,
      colno: 4,
    });
    for (const listener of [...(listeners.get("error") ?? [])]) {
      listener(errorEvent);
    }
    // 二重発火は無視されること
    for (const listener of [...(listeners.get("messageerror") ?? [])]) {
      listener(new Event("messageerror"));
    }

    await expect(inFlight).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "DECODE_FAILED",
    });
    expect(client.isBroken()).toBe(true);

    // 後続 RPC も即座に DECODE_FAILED で reject
    await expect(
      client.api.encodeCoverWebp(new Uint8Array([3, 4]), 0),
    ).rejects.toMatchObject({
      code: "DECODE_FAILED",
    });

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "error",
      scope: "cover",
    });
    expect(entries[0]?.detail).toContain("OOM crash");
    expect(entries[0]?.detail).toContain("cover.worker.ts:12:4");

    client.dispose();
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("wrapWorker失敗・同期RPC例外・addEventListenerなしWorker・dispose後呼び出しを安全に処理すること", async () => {
    // 1. wrapWorker 例外時は worker.terminate() を実行して再送出
    const failTerminate = vi.fn();
    expect(() =>
      createCoverWorkerClient({
        createWorker: () => ({
          terminate: failTerminate,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
        wrapWorker: () => {
          throw new Error("wrap failed");
        },
        registerErrorHandler: vi.fn(),
      }),
    ).toThrow("wrap failed");
    expect(failTerminate).toHaveBeenCalledTimes(1);

    // 2. addEventListener が存在しない最小 Worker でも動作すること
    const minimalTerminate = vi.fn();
    const minimalBlob = new Blob([new Uint8Array([1])], { type: "image/webp" });
    const minimalClient = createCoverWorkerClient({
      createWorker: () => ({ terminate: minimalTerminate }),
      wrapWorker: () => ({
        encodeCoverWebp: vi.fn(async () => ({
          blob: minimalBlob,
          width: 10,
          height: 10,
        })),
      }),
      registerErrorHandler: vi.fn(),
    });
    expect(
      await minimalClient.api.encodeCoverWebp(new Uint8Array([1]), 0),
    ).toEqual({
      blob: minimalBlob,
      width: 10,
      height: 10,
    });
    minimalClient.dispose();
    expect(minimalTerminate).toHaveBeenCalledTimes(1);

    // 3. 同期例外を投げる rawApi・空 event.type / 非数値 lineno/colno・dispose 後の呼び出し
    const capturedListeners: Array<(event: Event) => void> = [];
    const syncErrRawApi: CoverWorkerRemoteProxy = {
      encodeCoverWebp: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("sync failure");
        })
        .mockResolvedValueOnce({
          blob: minimalBlob,
          width: 5,
          height: 5,
        }),
    };
    const logger = createDiagnosticLogger();
    const syncClient = createCoverWorkerClient({
      createWorker: () => ({
        terminate: vi.fn(),
        addEventListener: (_type, listener) => {
          capturedListeners.push(listener);
        },
        removeEventListener: vi.fn(),
      }),
      wrapWorker: () => syncErrRawApi,
      registerErrorHandler: vi.fn(),
      logger,
    });

    await expect(
      syncClient.api.encodeCoverWebp(new Uint8Array([1]), 0),
    ).rejects.toThrow("sync failure");

    // dispose 後にイベント発火しても無視され、dispose 後の新規 RPC は AbortError で即時 reject される
    syncClient.dispose();
    capturedListeners[0]?.(Object.assign(new Event(""), { filename: "x.ts" }));
    expect(syncClient.isBroken()).toBe(false);
    await expect(
      syncClient.api.encodeCoverWebp(new Uint8Array([1]), 0),
    ).rejects.toMatchObject({
      name: "AbortError",
    });

    // 空 type・filename あり（lineno/colno 未定義）でのクラッシュ詳細フォーマット確認
    const capturedListeners2: Array<(event: Event) => void> = [];
    const client2 = createCoverWorkerClient({
      createWorker: () => ({
        terminate: vi.fn(),
        addEventListener: (_type, listener) => {
          capturedListeners2.push(listener);
        },
        removeEventListener: vi.fn(),
      }),
      wrapWorker: () => ({
        encodeCoverWebp: vi.fn(),
      }),
      registerErrorHandler: vi.fn(),
      logger,
    });
    capturedListeners2[0]?.(Object.assign(new Event(""), { filename: "w.ts" }));
    // 再発火ガード
    capturedListeners2[0]?.(new Event("error"));
    expect(client2.isBroken()).toBe(true);
    expect(logger.getEntries()[0]?.detail).toContain("type=error");
    expect(logger.getEntries()[0]?.detail).toContain("location=w.ts:0:0");
  });

  it("dispose時に保留中encodeCoverWebpをAbortErrorでrejectし、破棄後の新規RPCも即時AbortErrorでrejectすること (R1-10)", async () => {
    const terminate = vi.fn();
    const rawEncode = vi.fn(
      () => new Promise<EncodeCoverWebpResult>(() => undefined),
    );
    const client = createCoverWorkerClient({
      createWorker: () => ({
        terminate,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
      wrapWorker: () => ({
        encodeCoverWebp: rawEncode,
      }),
      registerErrorHandler: vi.fn(),
    });

    const inFlight = client.api.encodeCoverWebp(new Uint8Array([1, 2, 3]), 0);
    client.dispose();

    await expect(inFlight).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      client.api.encodeCoverWebp(new Uint8Array([4, 5]), 0),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(rawEncode).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
