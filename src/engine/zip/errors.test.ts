import { describe, expect, it } from "vitest";
import { ZipArchiveError, isAbortError } from "./errors";

describe("ZipArchiveError", () => {
  it("エラーコード・メッセージ・Error継承を正しく設定すること", () => {
    const error = new ZipArchiveError("CORRUPT_ZIP", "破損しています");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ZipArchiveError);
    expect(error.name).toBe("ZipArchiveError");
    expect(error.code).toBe("CORRUPT_ZIP");
    expect(error.message).toBe("破損しています");
    expect(error.cause).toBeUndefined();
  });

  it("causeが指定された場合はcauseプロパティを保持すること", () => {
    const rootCause = new TypeError("slice failed");
    const error = new ZipArchiveError("READ_ERROR", "読込失敗", rootCause);

    expect(error.code).toBe("READ_ERROR");
    expect(error.cause).toBe(rootCause);
  });
});

describe("isAbortError", () => {
  it("DOMExceptionおよびErrorのAbortErrorのみtrueを返しそれ以外はfalseを返すこと", () => {
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
    const namedError = new Error("Aborted");
    namedError.name = "AbortError";
    expect(isAbortError(namedError)).toBe(true);

    expect(isAbortError(new DOMException("Denied", "NotAllowedError"))).toBe(
      false,
    );
    expect(isAbortError(new Error("generic"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
