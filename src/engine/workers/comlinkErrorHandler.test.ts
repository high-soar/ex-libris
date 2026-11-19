import * as Comlink from "comlink";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZipErrorCode } from "../types";
import { ZipArchiveError, isAbortError } from "../zip/errors";
import {
  registerZipArchiveErrorTransferHandler,
  type ComlinkTransferHandlers,
} from "./comlinkErrorHandler";

interface ErrorThrowingRpcApi {
  throwZipArchiveError(code: ZipErrorCode, message: string): never;
  throwPlainError(message: string): never;
  throwAbortError(): never;
  throwNonError(value: unknown): never;
}

const originalThrowHandler = Comlink.transferHandlers.get("throw");

function requireOriginalThrowHandler(): Comlink.TransferHandler<
  unknown,
  unknown
> {
  if (!originalThrowHandler) {
    throw new Error("Comlink の標準 throw ハンドラが存在しません");
  }
  return originalThrowHandler;
}

async function withComlinkChannel(
  run: (remote: Comlink.Remote<ErrorThrowingRpcApi>) => Promise<void>,
): Promise<void> {
  const api: ErrorThrowingRpcApi = {
    throwZipArchiveError(code, message) {
      throw new ZipArchiveError(code, message);
    },
    throwPlainError(message) {
      throw new Error(message);
    },
    throwAbortError() {
      throw new DOMException("Aborted", "AbortError");
    },
    throwNonError(value) {
      throw value;
    },
  };

  const { port1, port2 } = new MessageChannel();
  Comlink.expose(api, port1);
  const remote = Comlink.wrap<ErrorThrowingRpcApi>(port2);

  try {
    await run(remote);
  } finally {
    remote[Comlink.releaseProxy]();
    port1.close();
    port2.close();
  }
}

function captureRejectedValue(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("例外が送出されるべきでしたが正常終了しました");
}

describe("comlinkErrorHandler", () => {
  afterEach(() => {
    Comlink.transferHandlers.set("throw", requireOriginalThrowHandler());
    vi.restoreAllMocks();
  });

  it("MessageChannel上のComlink RPCでZipArchiveErrorのcode・message・name・stack・instanceofが保持されること (AC-ENG-04)", async () => {
    registerZipArchiveErrorTransferHandler();

    const codes: readonly ZipErrorCode[] = [
      "CORRUPT_ZIP",
      "EMPTY_ARCHIVE",
      "ENCRYPTED_ZIP",
      "UNSUPPORTED_COMPRESSION",
      "ZIP64_NOT_SUPPORTED",
      "DECODE_FAILED",
      "READ_ERROR",
    ];

    await withComlinkChannel(async (remote) => {
      for (const code of codes) {
        let caught: unknown;
        try {
          await remote.throwZipArchiveError(code, `エラー: ${code}`);
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(Error);
        expect(caught).toBeInstanceOf(ZipArchiveError);
        const zipError = caught as ZipArchiveError;
        expect(zipError.code).toBe(code);
        expect(zipError.name).toBe("ZipArchiveError");
        expect(zipError.message).toBe(`エラー: ${code}`);
        expect(zipError.stack).toContain("throwZipArchiveError");
      }
    });
  });

  it("送信側のみ拡張済み・受信側が標準Comlinkの想定でもObject.assign経由でerr.codeが参照可能なシリアライズ形式であること", async () => {
    const baselineThrowHandler = requireOriginalThrowHandler();
    registerZipArchiveErrorTransferHandler();

    const { port1, port2 } = new MessageChannel();
    Comlink.expose(
      {
        failWithEncryptedZip() {
          throw new ZipArchiveError(
            "ENCRYPTED_ZIP",
            "暗号化ZIPには対応していません",
          );
        },
      },
      port1,
    );

    try {
      const wireMessage = await new Promise<{ value: unknown }>(
        (resolve, reject) => {
          port2.addEventListener(
            "message",
            (event: MessageEvent<{ value: unknown }>) => {
              resolve(event.data);
            },
            { once: true },
          );
          port2.addEventListener("messageerror", reject, { once: true });
          port2.start();
          port2.postMessage({
            id: "compat-check",
            type: "APPLY",
            path: ["failWithEncryptedZip"],
            argumentList: [],
          });
        },
      );

      const caught = captureRejectedValue(() =>
        baselineThrowHandler.deserialize(wireMessage.value),
      );
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).name).toBe("ZipArchiveError");
      expect((caught as Error).message).toBe("暗号化ZIPには対応していません");
      expect((caught as { code?: unknown }).code).toBe("ENCRYPTED_ZIP");
    } finally {
      port1.close();
      port2.close();
    }
  });

  it("MessageChannel上で通常のError・DOMException(AbortError)・非Error値も壊れず転送されること", async () => {
    registerZipArchiveErrorTransferHandler();

    await withComlinkChannel(async (remote) => {
      let caughtPlain: unknown;
      try {
        await remote.throwPlainError("通常の失敗");
      } catch (error) {
        caughtPlain = error;
      }
      expect(caughtPlain).toBeInstanceOf(Error);
      expect(caughtPlain).not.toBeInstanceOf(ZipArchiveError);
      expect((caughtPlain as Error).message).toBe("通常の失敗");

      let caughtAbort: unknown;
      try {
        await remote.throwAbortError();
      } catch (error) {
        caughtAbort = error;
      }
      expect(isAbortError(caughtAbort)).toBe(true);
      expect((caughtAbort as Error).message).toBe("Aborted");

      let caughtString: unknown;
      try {
        await remote.throwNonError("文字列例外");
      } catch (error) {
        caughtString = error;
      }
      expect(caughtString).toBe("文字列例外");
    });
  });

  it("throwハンドラが未登録の場合は何もせず、複数回呼び出しても二重ラップせず冪等であること", () => {
    const emptyHandlers: ComlinkTransferHandlers = new Map();
    registerZipArchiveErrorTransferHandler(emptyHandlers);
    expect(emptyHandlers.size).toBe(0);

    const baselineThrowHandler = requireOriginalThrowHandler();
    const handlers: ComlinkTransferHandlers = new Map([
      ["throw", baselineThrowHandler],
    ]);

    registerZipArchiveErrorTransferHandler(handlers);
    const firstWrapped = handlers.get("throw");
    expect(firstWrapped).toBeDefined();
    expect(firstWrapped).not.toBe(baselineThrowHandler);

    registerZipArchiveErrorTransferHandler(handlers);
    expect(handlers.get("throw")).toBe(firstWrapped);
  });

  it("DIしたMap上でcanHandle・serialize・deserializeの全境界分岐が正しく動作すること", () => {
    const baselineThrowHandler = requireOriginalThrowHandler();
    const handlers: ComlinkTransferHandlers = new Map([
      ["throw", baselineThrowHandler],
    ]);
    registerZipArchiveErrorTransferHandler(handlers);

    const handler = handlers.get("throw");
    expect(handler).toBeDefined();
    if (!handler) {
      return;
    }

    // canHandle はベースハンドラへ委譲されること
    expect(handler.canHandle(null)).toBe(false);
    expect(handler.canHandle({ value: "plain" })).toBe(false);
    const spyCanHandle = vi
      .spyOn(baselineThrowHandler, "canHandle")
      .mockReturnValueOnce(true);
    expect(handler.canHandle({ dummy: true })).toBe(true);
    expect(spyCanHandle).toHaveBeenCalledTimes(1);

    // serialize: ZipArchiveError のみ code を付与し、通常 Error / 非Error / 非オブジェクト入力も壊さないこと
    const [zipSerialized, zipTransfers] = handler.serialize({
      value: new ZipArchiveError("DECODE_FAILED", "デコード失敗"),
    });
    expect(zipTransfers).toEqual([]);
    expect(zipSerialized).toMatchObject({
      isError: true,
      value: {
        name: "ZipArchiveError",
        message: "デコード失敗",
        code: "DECODE_FAILED",
      },
    });

    const [plainSerialized] = handler.serialize({
      value: Object.assign(new Error("通常エラー"), { code: "ENOENT" }),
    });
    expect(plainSerialized).toMatchObject({
      isError: true,
      value: {
        name: "Error",
        message: "通常エラー",
      },
    });
    expect(
      (plainSerialized as { value: Record<string, unknown> }).value,
    ).not.toHaveProperty("code");

    const [primitiveSerialized] = handler.serialize("non-object-wrapper");
    expect(primitiveSerialized).toEqual({
      isError: false,
      value: undefined,
    });

    // deserialize: stack あり/なしの ZipArchiveError 復元
    const restoredWithStack = captureRejectedValue(() =>
      handler.deserialize({
        isError: true,
        value: {
          name: "ZipArchiveError",
          message: "破損ZIP",
          code: "CORRUPT_ZIP",
          stack: "CustomWorkerStack:line1",
        },
      }),
    );
    expect(restoredWithStack).toBeInstanceOf(ZipArchiveError);
    expect((restoredWithStack as ZipArchiveError).code).toBe("CORRUPT_ZIP");
    expect((restoredWithStack as ZipArchiveError).stack).toBe(
      "CustomWorkerStack:line1",
    );

    const restoredWithoutStack = captureRejectedValue(() =>
      handler.deserialize({
        isError: true,
        value: {
          name: "ZipArchiveError",
          message: "空アーカイブ",
          code: "EMPTY_ARCHIVE",
        },
      }),
    );
    expect(restoredWithoutStack).toBeInstanceOf(ZipArchiveError);
    expect((restoredWithoutStack as ZipArchiveError).code).toBe(
      "EMPTY_ARCHIVE",
    );
    expect(typeof (restoredWithoutStack as ZipArchiveError).stack).toBe(
      "string",
    );

    // deserialize: 無効 ZipErrorCode や不正形式はベースハンドラへフォールバックすること
    const invalidCodeCases: readonly unknown[] = [
      {
        isError: true,
        value: {
          name: "ZipArchiveError",
          message: "未知コード",
          code: "INVALID_CODE",
        },
      },
      {
        isError: true,
        value: {
          name: "ZipArchiveError",
          message: "数値コード",
          code: 999,
        },
      },
      {
        isError: true,
        value: {
          name: "ZipArchiveError",
          message: 123,
          code: "READ_ERROR",
        },
      },
      {
        isError: true,
        value: {
          name: "Error",
          message: "別エラー名",
          code: "READ_ERROR",
        },
      },
      {
        isError: true,
        value: "not-an-object",
      },
      {
        isError: false,
        value: "non-error-throw",
      },
    ];

    for (const payload of invalidCodeCases) {
      const fallbackError = captureRejectedValue(() =>
        handler.deserialize(payload),
      );
      expect(fallbackError).not.toBeInstanceOf(ZipArchiveError);
    }

    // deserialize: serialized が null の場合もベースハンドラにフォールバックすること
    const nullFallback = captureRejectedValue(() => handler.deserialize(null));
    expect(nullFallback).toBeInstanceOf(TypeError);
  });
});
