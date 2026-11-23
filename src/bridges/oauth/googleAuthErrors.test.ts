import { describe, expect, it } from "vitest";
import { GoogleAuthError, toGoogleAuthError } from "./googleAuthErrors";

describe("GoogleAuthError / toGoogleAuthError", () => {
  it("GoogleAuthErrorがError継承・コード・メッセージ・causeを正しく保持すること", () => {
    const cause = new Error("native failure");
    const err = new GoogleAuthError(
      "AUTH_NETWORK_ERROR",
      "オフラインのため認証できません",
      cause,
    );

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GoogleAuthError);
    expect(err.name).toBe("GoogleAuthError");
    expect(err.code).toBe("AUTH_NETWORK_ERROR");
    expect(err.message).toBe("オフラインのため認証できません");
    expect(err.cause).toBe(cause);

    const noCause = new GoogleAuthError("AUTH_CANCELLED", "キャンセル");
    expect(noCause.cause).toBeUndefined();
  });

  it("toGoogleAuthErrorが既存のGoogleAuthError・ネイティブコード付きエラー・不明例外を安全に変換し秘匿マスクすること (AC-GD-05)", () => {
    const existing = new GoogleAuthError("AUTH_REQUIRED", "再認証が必要です");
    expect(toGoogleAuthError(existing)).toBe(existing);

    const nativeCodes = [
      "AUTH_CANCELLED",
      "AUTH_REQUIRED",
      "AUTH_NETWORK_ERROR",
      "AUTH_FAILED",
    ] as const;
    for (const code of nativeCodes) {
      const converted = toGoogleAuthError({
        code,
        message: "失敗 token=secretBearer ya29.secretNativeToken",
      });
      expect(converted).toBeInstanceOf(GoogleAuthError);
      expect(converted.code).toBe(code);
      expect(converted.message).toContain("token=[REDACTED]");
      expect(converted.message).toContain("[REDACTED]");
      expect(converted.message).not.toContain("ya29.secretNativeToken");
    }

    const unknownCodeObj = toGoogleAuthError({
      code: "UNIMPLEMENTED",
      message: "   ",
    });
    expect(unknownCodeObj.code).toBe("AUTH_FAILED");
    expect(unknownCodeObj.message).toBe("Google認証エラーが発生しました");

    const plainError = toGoogleAuthError(
      new Error("Bearer ya29.rawErrorLeakToken"),
      "カスタムフォールバック",
    );
    expect(plainError.code).toBe("AUTH_FAILED");
    expect(plainError.message).toBe("Bearer [REDACTED]");
    expect(plainError.cause).toBeInstanceOf(Error);

    const primitiveError = toGoogleAuthError(
      null,
      "プリミティブフォールバック",
    );
    expect(primitiveError.code).toBe("AUTH_FAILED");
    expect(primitiveError.message).toBe("プリミティブフォールバック");
  });
});
