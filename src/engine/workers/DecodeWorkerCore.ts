import { inflateSync } from "fflate";
import type { DecodeWorkerApi, ZipCompressionMethod } from "../types";
import { ZipArchiveError } from "../zip/errors";

export interface DecodeWorkerDeps {
  readonly createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
  readonly createDecompressionStream?:
    ((format: "deflate-raw") => DecompressionStream) | null;
}

async function readAllStreamChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    totalLength += value.byteLength;
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

export class DecodeWorkerCore implements DecodeWorkerApi {
  private readonly decodeBitmap: (blob: Blob) => Promise<ImageBitmap>;
  private readonly createDecompressionStream:
    ((format: "deflate-raw") => DecompressionStream) | null;

  constructor(deps: DecodeWorkerDeps = {}) {
    this.decodeBitmap =
      deps.createImageBitmap ?? ((blob) => createImageBitmap(blob));
    this.createDecompressionStream =
      deps.createDecompressionStream !== undefined
        ? deps.createDecompressionStream
        : typeof DecompressionStream !== "undefined"
          ? (format) => new DecompressionStream(format)
          : null;
  }

  private async decompressDeflate(
    compressedData: Uint8Array,
  ): Promise<Uint8Array> {
    if (this.createDecompressionStream !== null) {
      try {
        const stream = this.createDecompressionStream("deflate-raw");
        const writer = stream.writable.getWriter();
        const reader = stream.readable.getReader();
        const writePromise = writer
          .write(compressedData as Uint8Array<ArrayBuffer>)
          .then(() => writer.close());
        const readPromise = readAllStreamChunks(reader);
        const [, rawBytes] = await Promise.all([writePromise, readPromise]);
        return rawBytes;
      } catch {
        // DecompressionStream 非対応環境・実行失敗時は fflate.inflateSync へフォールバックする
      }
    }

    return inflateSync(compressedData);
  }

  async decodePageSlice(
    compressedData: Uint8Array,
    compressionMethod: ZipCompressionMethod,
  ): Promise<{
    bitmap: ImageBitmap;
    width: number;
    height: number;
  }> {
    try {
      const rawBytes =
        compressionMethod === 0
          ? compressedData
          : await this.decompressDeflate(compressedData);
      const blob = new Blob([rawBytes as Uint8Array<ArrayBuffer>]);
      const bitmap = await this.decodeBitmap(blob);

      return {
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
      };
    } catch (error) {
      throw new ZipArchiveError(
        "DECODE_FAILED",
        "画像ページの伸長またはデコードに失敗しました",
        error,
      );
    }
  }
}
