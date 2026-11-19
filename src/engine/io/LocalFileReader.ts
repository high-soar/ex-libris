import type { RandomAccessReader } from "../types";
import { ZipArchiveError } from "../zip/errors";

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    error.name === "AbortError"
  );
}

export class LocalFileReader implements RandomAccessReader {
  readonly sourceId: string;
  readonly totalSize: number;

  constructor(private readonly file: File) {
    this.sourceId = `local:${file.name}:${file.size}`;
    this.totalSize = file.size;
  }

  async readRange(
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    if (
      !Number.isInteger(offset) ||
      !Number.isInteger(length) ||
      offset < 0 ||
      length < 0
    ) {
      throw new ZipArchiveError(
        "READ_ERROR",
        `不正な読込範囲です: offset=${offset}, length=${length}`,
      );
    }

    if (length === 0 || offset >= this.totalSize) {
      return new Uint8Array(0);
    }

    const end = Math.min(offset + length, this.totalSize);
    let buffer: ArrayBuffer;
    try {
      buffer = await this.file.slice(offset, end).arrayBuffer();
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      throw new ZipArchiveError(
        "READ_ERROR",
        `ローカルファイルの読込に失敗しました: ${this.file.name} [${offset}, ${end})`,
        error,
      );
    }

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    return new Uint8Array(buffer);
  }
}
