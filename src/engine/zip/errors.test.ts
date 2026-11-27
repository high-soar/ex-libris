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
    expect(error.httpStatus).toBeUndefined();
    expect(error.isRateLimited).toBeUndefined();
    expect(error.isUnauthorized).toBeUndefined();
  });

  it("メタデータ(httpStatus/isRateLimited/isUnauthorized)が指定された場合はプロパティとして保持すること (AC-COV-06)", () => {
    const rateLimited = new ZipArchiveError(
      "READ_ERROR",
      "Rate limit",
      undefined,
      { httpStatus: 429, isRateLimited: true },
    );
    expect(rateLimited.httpStatus).toBe(429);
    expect(rateLimited.isRateLimited).toBe(true);
    expect(rateLimited.isUnauthorized).toBeUndefined();

    const unauthorized = new ZipArchiveError(
      "READ_ERROR",
      "Unauthorized",
      undefined,
      { httpStatus: 401, isUnauthorized: true },
    );
    expect(unauthorized.httpStatus).toBe(401);
    expect(unauthorized.isUnauthorized).toBe(true);
    expect(unauthorized.isRateLimited).toBeUndefined();
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
