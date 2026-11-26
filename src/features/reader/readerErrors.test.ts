import { describe, expect, it } from "vitest";
import { ZipArchiveError } from "../../engine/zip/errors";
import { WebGLInitError } from "../../webgl/WebGLRendererCore";
import {
  extractReaderError,
  getReaderErrorMessage,
  type ReaderFatalErrorCode,
} from "./readerErrors";

describe("readerErrors", () => {
  it("getReaderErrorMessageがDrive巻事前検証エラー3種とDECODE_FAILEDを含む全11種のエラーコードに対し仕様通りの日本語文言を返すこと (AC-RD-06, AC-RD-07, AC-RD-19)", () => {
    const expectedEntries: Array<readonly [ReaderFatalErrorCode, string]> = [
      ["VOLUME_NOT_FOUND", "指定された巻データが見つかりませんでした"],
      [
        "VOLUME_UNAVAILABLE",
        "この巻はゴミ箱に移動されたか、同期対象外のフォルダにあります",
      ],
      [
        "AUTH_REQUIRED",
        "Google アカウントにログインしていないため開けませんでした。設定画面から連携してください",
      ],
      ["CORRUPT_ZIP", "ZIP ファイルが破損しているため開けませんでした"],
      [
        "EMPTY_ARCHIVE",
        "表示できる画像ファイル（JPEG / PNG / WebP / AVIF）が見つかりませんでした",
      ],
      [
        "ENCRYPTED_ZIP",
        "パスワード保護（暗号化）された ZIP ファイルには対応していません",
      ],
      [
        "UNSUPPORTED_COMPRESSION",
        "未対応の圧縮方式が含まれているため開けませんでした",
      ],
      [
        "READ_ERROR",
        "ファイルの読み込みに失敗しました（アクセス権限またはストレージ状態を確認してください）",
      ],
      ["WEBGL_UNSUPPORTED", "WebGL2 描画の初期化に失敗しました"],
      ["WEBGL_INIT_FAILED", "WebGL2 描画の初期化に失敗しました"],
      ["DECODE_FAILED", "ページの画像デコードに失敗しました"],
    ];

    expect(expectedEntries).toHaveLength(11);
    for (const [code, expectedMessage] of expectedEntries) {
      expect(getReaderErrorMessage(code)).toBe(expectedMessage);
    }
  });

  it("extractReaderErrorがZipArchiveError・WebGLInitError・Comlink経由のcodeオブジェクトを正しく変換すること (AC-RD-06, AC-RD-19)", () => {
    expect(
      extractReaderError(new ZipArchiveError("ENCRYPTED_ZIP", "encrypted")),
    ).toEqual({
      code: "ENCRYPTED_ZIP",
      message:
        "パスワード保護（暗号化）された ZIP ファイルには対応していません",
    });

    expect(extractReaderError(new WebGLInitError("compile failed"))).toEqual({
      code: "WEBGL_INIT_FAILED",
      message: "WebGL2 描画の初期化に失敗しました",
    });

    expect(
      extractReaderError({
        name: "ZipArchiveError",
        code: "CORRUPT_ZIP",
        message: "corrupt zip",
      }),
    ).toEqual({
      code: "CORRUPT_ZIP",
      message: "ZIP ファイルが破損しているため開けませんでした",
    });

    expect(extractReaderError({ code: "WEBGL_UNSUPPORTED" })).toEqual({
      code: "WEBGL_UNSUPPORTED",
      message: "WebGL2 描画の初期化に失敗しました",
    });

    expect(extractReaderError({ code: "DECODE_FAILED" })).toEqual({
      code: "DECODE_FAILED",
      message: "ページの画像デコードに失敗しました",
    });

    expect(extractReaderError({ code: "AUTH_REQUIRED" })).toEqual({
      code: "AUTH_REQUIRED",
      message:
        "Google アカウントにログインしていないため開けませんでした。設定画面から連携してください",
    });
  });

  it("extractReaderErrorが未知コード・一般Error・非Error値をREAD_ERRORへフォールバック変換すること", () => {
    const expectedFallback = {
      code: "READ_ERROR",
      message:
        "ファイルの読み込みに失敗しました（アクセス権限またはストレージ状態を確認してください）",
    };

    expect(extractReaderError(new Error("generic io failure"))).toEqual(
      expectedFallback,
    );
    expect(extractReaderError({ code: "UNKNOWN_CODE" })).toEqual(
      expectedFallback,
    );
    expect(extractReaderError({ code: "ZIP64_NOT_SUPPORTED" })).toEqual(
      expectedFallback,
    );
    expect(extractReaderError({ code: 404 })).toEqual(expectedFallback);
    expect(extractReaderError({})).toEqual(expectedFallback);
    expect(extractReaderError(null)).toEqual(expectedFallback);
    expect(extractReaderError(undefined)).toEqual(expectedFallback);
    expect(extractReaderError("raw error string")).toEqual(expectedFallback);
    expect(extractReaderError(42)).toEqual(expectedFallback);
  });
});
