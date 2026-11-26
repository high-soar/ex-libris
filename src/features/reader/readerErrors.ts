import type { ZipErrorCode } from "../../engine/types";
import { ZipArchiveError } from "../../engine/zip/errors";
import type { WebGLFatalErrorCode } from "../../webgl/ReaderCanvas";

export type DriveVolumeErrorCode =
  "VOLUME_NOT_FOUND" | "VOLUME_UNAVAILABLE" | "AUTH_REQUIRED";

export type ReaderFatalErrorCode =
  ZipErrorCode | WebGLFatalErrorCode | DriveVolumeErrorCode;

export interface ExtractedReaderError {
  readonly code: ReaderFatalErrorCode;
  readonly message: string;
}

const READER_ERROR_MESSAGES: Record<ReaderFatalErrorCode, string> = {
  VOLUME_NOT_FOUND: "",
  VOLUME_UNAVAILABLE: "",
  AUTH_REQUIRED: "",
  CORRUPT_ZIP: "ZIP ファイルが破損しているため開けませんでした",
  EMPTY_ARCHIVE:
    "表示できる画像ファイル（JPEG / PNG / WebP / AVIF）が見つかりませんでした",
  ENCRYPTED_ZIP:
    "パスワード保護（暗号化）された ZIP ファイルには対応していません",
  UNSUPPORTED_COMPRESSION: "未対応の圧縮方式が含まれているため開けませんでした",
  DECODE_FAILED: "ページの画像デコードに失敗しました",
  READ_ERROR:
    "ファイルの読み込みに失敗しました（アクセス権限またはストレージ状態を確認してください）",
  WEBGL_UNSUPPORTED: "WebGL2 描画の初期化に失敗しました",
  WEBGL_INIT_FAILED: "WebGL2 描画の初期化に失敗しました",
};

function isReaderFatalErrorCode(value: unknown): value is ReaderFatalErrorCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(READER_ERROR_MESSAGES, value)
  );
}

export function getReaderErrorMessage(code: ReaderFatalErrorCode): string {
  return READER_ERROR_MESSAGES[code];
}

export function extractReaderError(error: unknown): ExtractedReaderError {
  if (error instanceof ZipArchiveError) {
    return {
      code: error.code,
      message: getReaderErrorMessage(error.code),
    };
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    isReaderFatalErrorCode(error.code)
  ) {
    return {
      code: error.code,
      message: getReaderErrorMessage(error.code),
    };
  }

  return {
    code: "READ_ERROR",
    message: getReaderErrorMessage("READ_ERROR"),
  };
}
