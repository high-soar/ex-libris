import { describe, expect, it } from "vitest";
import { ZipArchiveError } from "./errors";

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
