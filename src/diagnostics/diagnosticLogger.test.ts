import { beforeEach, describe, expect, it } from "vitest";
import { APP_VERSION } from "../shared/constants/app";
import {
  createDiagnosticLogger,
  diagnosticLogger,
  redactSensitiveText,
} from "./diagnosticLogger";

describe("diagnosticLogger", () => {
  beforeEach(() => {
    diagnosticLogger.clear();
  });

  it("Bearerトークン・クエリパラメータ・JSONフィールドの機密値をマスクすること", () => {
    const raw = [
      "Authorization: Bearer ya29.a0AfH6SMBxSecretToken123==",
      "https://www.googleapis.com/drive/v3/files?access_token=abc123xyz&key=AIzaSySecretKey",
      '{"refresh_token":"1//0gSecretRefresh","api_key":"rk_live_999"}',
    ].join(" ");

    const sanitized = redactSensitiveText(raw);

    expect(sanitized).toContain("Bearer [REDACTED]");
    expect(sanitized).toContain("access_token=[REDACTED]");
    expect(sanitized).toContain("key=[REDACTED]");
    expect(sanitized).toContain('"refresh_token":"[REDACTED]"');
    expect(sanitized).toContain('"api_key":"[REDACTED]"');
    expect(sanitized).not.toContain("ya29.a0AfH6SMBxSecretToken123");
    expect(sanitized).not.toContain("abc123xyz");
    expect(sanitized).not.toContain("AIzaSySecretKey");
    expect(sanitized).not.toContain("1//0gSecretRefresh");
    expect(sanitized).not.toContain("rk_live_999");
  });

  it("単体で混入したya29.*生アクセストークンも[REDACTED]へ置換すること (AC-GD-05)", () => {
    const raw =
      'Unexpected OAuth failure for ya29.a0AfH6SMBx-Raw_Token.~+/== and "ya29.secondToken123"';

    const sanitized = redactSensitiveText(raw);

    expect(sanitized).toBe(
      'Unexpected OAuth failure for [REDACTED] and "[REDACTED]"',
    );
    expect(sanitized).not.toContain("ya29.");

    const logger = createDiagnosticLogger(10);
    const entry = logger.error(
      "oauth:ya29.scopeSecretToken",
      "認証失敗 ya29.msgSecretToken_123==",
      "stack trace containing ya29.detailSecretToken~",
    );
    expect(entry.scope).toBe("oauth:[REDACTED]");
    expect(entry.message).toBe("認証失敗 [REDACTED]");
    expect(entry.detail).toBe("stack trace containing [REDACTED]");
  });

  it("info・warn・errorの各レベルを記録しリングバッファ上限超過時に古いログから破棄すること", () => {
    const logger = createDiagnosticLogger(2);

    logger.info("boot", "初期化開始");
    logger.warn("drive", "再試行を実行", "token=tempSecret");
    logger.error("zip", "Range取得失敗", "Bearer secretBearerToken");

    const entries = logger.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.level).toBe("warn");
    expect(entries[0]?.detail).toBe("token=[REDACTED]");
    expect(entries[1]?.level).toBe("error");
    expect(entries[1]?.detail).toBe("Bearer [REDACTED]");
  });

  it("ログが空の場合と存在する場合の双方で診断レポート文字列を整形できること", () => {
    const fixedNow = new Date("2026-04-19T00:00:00.000Z");

    const emptyReport = diagnosticLogger.formatReport(fixedNow);
    expect(emptyReport).toContain("# ExLibris Diagnostic Report");
    expect(emptyReport).toContain(`version: v${APP_VERSION}`);
    expect(emptyReport).toContain("generatedAt: 2026-04-19T00:00:00.000Z");
    expect(emptyReport).toContain("(no diagnostic entries)");

    diagnosticLogger.info("app", "起動完了");
    diagnosticLogger.error("sync", "通信失敗", "api_key=secretValue");

    const populatedReport = diagnosticLogger.formatReport();
    expect(populatedReport).toContain("entries: 2");
    expect(populatedReport).toContain("[INFO] [app] 起動完了");
    expect(populatedReport).toContain(
      "[ERROR] [sync] 通信失敗 | api_key=[REDACTED]",
    );

    diagnosticLogger.clear();
    expect(diagnosticLogger.getEntries()).toEqual([]);
  });
});
