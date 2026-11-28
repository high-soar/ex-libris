import { Inflate } from "fflate";
import type { ZipCompressionMethod } from "../types";
import { ZipArchiveError } from "./errors";

export const MAX_DECOMPRESSED_PAGE_BYTES = 167_772_160; // 160 MiB 絶対上限
export const DECOMPRESS_SIZE_MARGIN_BYTES = 1_024;
const FFLATE_CHUNK_BYTES = 16_384;

export interface DecompressZipSliceDeps {
  readonly createDecompressionStream?:
    ((format: "deflate-raw") => DecompressionStream) | null;
  readonly maxUncompressedBytes?: number;
}

export function computeMaxDecompressedBytes(
  expectedUncompressedSize?: number,
): number {
  if (
    expectedUncompressedSize === undefined ||
    !Number.isFinite(expectedUncompressedSize) ||
    expectedUncompressedSize < 0
  ) {
    return MAX_DECOMPRESSED_PAGE_BYTES;
  }
  return Math.min(
    MAX_DECOMPRESSED_PAGE_BYTES,
    Math.floor(expectedUncompressedSize) + DECOMPRESS_SIZE_MARGIN_BYTES,
  );
}

function createSizeLimitExceededError(
  actualBytes: number,
  maxBytes: number,
): ZipArchiveError {
  return new ZipArchiveError(
    "DECODE_FAILED",
    `伸長後のサイズが上限を超過しました: actual>=${actualBytes}, max=${maxBytes}`,
  );
}

function combineChunks(
  chunks: readonly Uint8Array[],
  totalLength: number,
): Uint8Array {
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function readAllStreamChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalLength += value.byteLength;
    if (totalLength > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw createSizeLimitExceededError(totalLength, maxBytes);
    }
    chunks.push(value);
  }

  return combineChunks(chunks, totalLength);
}

function inflateWithLimit(
  compressedData: Uint8Array,
  maxBytes: number,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  const inflator = new Inflate((chunk) => {
    totalLength += chunk.byteLength;
    if (totalLength > maxBytes) {
      throw createSizeLimitExceededError(totalLength, maxBytes);
    }
    chunks.push(chunk);
  });

  let offset = 0;
  do {
    const end = Math.min(
      offset + FFLATE_CHUNK_BYTES,
      compressedData.byteLength,
    );
    inflator.push(
      compressedData.subarray(offset, end),
      end >= compressedData.byteLength,
    );
    offset = end;
  } while (offset < compressedData.byteLength);

  return combineChunks(chunks, totalLength);
}

export async function decompressZipSlice(
  compressedData: Uint8Array,
  compressionMethod: ZipCompressionMethod,
  deps: DecompressZipSliceDeps = {},
): Promise<Uint8Array> {
  const maxBytes = deps.maxUncompressedBytes ?? MAX_DECOMPRESSED_PAGE_BYTES;

  if (compressionMethod === 0) {
    if (compressedData.byteLength > maxBytes) {
      throw createSizeLimitExceededError(compressedData.byteLength, maxBytes);
    }
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
      const readPromise = readAllStreamChunks(reader, maxBytes);
      // readPromise が上限超過で先行 reject した際の writePromise 未処理 rejection を抑止
      writePromise.catch(() => undefined);
      const rawBytes = await readPromise;
      await writePromise;
      return rawBytes;
    } catch (error) {
      if (error instanceof ZipArchiveError) {
        throw error;
      }
      // DecompressionStream 非対応環境・実行失敗時は fflate へフォールバックする
    }
  }

  return inflateWithLimit(compressedData, maxBytes);
}
