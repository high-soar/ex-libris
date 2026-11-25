import { describe, expect, it } from "vitest";
import { DriveApiError } from "./driveApiErrors";
import type { DriveApiErrorCode } from "./types";

describe("DriveApiError", () => {
  it("全DriveApiErrorCodeとstatus・causeオプションを保持してErrorを継承すること", () => {
    const cause = new Error("root cause");
    const codes: readonly DriveApiErrorCode[] = [
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "NOT_A_FOLDER",
      "FOLDER_TRASHED",
      "RATE_LIMITED",
      "TOKEN_EXPIRED",
      "NETWORK_ERROR",
    ];

    for (const code of codes) {
      const error = new DriveApiError(code, `message:${code}`, {
        status: 503,
        cause,
      });
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DriveApiError);
      expect(error.name).toBe("DriveApiError");
      expect(error.code).toBe(code);
      expect(error.message).toBe(`message:${code}`);
      expect(error.status).toBe(503);
      expect(error.cause).toBe(cause);
    }

    const minimal = new DriveApiError("NOT_FOUND", "not found");
    expect(minimal.status).toBeUndefined();
    expect(minimal.cause).toBeUndefined();
  });
});
