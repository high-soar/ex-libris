import { inflateSync } from "fflate";
import type { ZipCompressionMethod } from "../types";

export interface DecompressZipSliceDeps {
  readonly createDecompressionStream?:
    ((format: "deflate-raw") => DecompressionStream) | null;
  readonly maxUncompressedBytes?: number;
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

export async function decompressZipSlice(
  compressedData: Uint8Array,
  compressionMethod: ZipCompressionMethod,
  deps: DecompressZipSliceDeps = {},
): Promise<Uint8Array> {
  if (compressionMethod === 0) {
    return compressedData;
  }

  const createDecompressionStream =
    deps.createDecompressionStream !== undefined
      ? deps.createDecompressionStream
      : typeof DecompressionStream !== "undefined"
        ? (format: "deflate-raw") => new DecompressionStream(format)
        : null;

  if (createDecompressionStream !== null) {
    try {
      const stream = createDecompressionStream("deflate-raw");
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
