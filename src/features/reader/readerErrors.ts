import type { ZipErrorCode } from "../../engine/types";
import type { WebGLFatalErrorCode } from "../../webgl/ReaderCanvas";

export type ReaderFatalErrorCode = ZipErrorCode | WebGLFatalErrorCode;

export interface ExtractedReaderError {
  readonly code: ReaderFatalErrorCode;
  readonly message: string;
}

export function getReaderErrorMessage(_code: ReaderFatalErrorCode): string {
  return "";
}

export function extractReaderError(_error: unknown): ExtractedReaderError {
  return {
    code: "READ_ERROR",
    message: "",
  };
}
