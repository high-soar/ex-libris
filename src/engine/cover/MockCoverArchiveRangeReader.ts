import type { RandomAccessReader } from "../types";
import { ZipArchiveError } from "../zip/errors";

// 1x1 単色 RGB PNG（67 bytes、標準 CRC 準拠）
const MINIMAL_1X1_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
  0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44,
  0x41, 0x54, 0x08, 0xd7, 0x63, 0x60, 0xa8, 0xc8, 0x00, 0x00, 0x00, 0x82, 0x00,
  0x81, 0x7e, 0x2d, 0x3b, 0x11, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

const COVER_ENTRY_NAME = new TextEncoder().encode("cover.png");

function buildSingleEntryStoreZip(
  entryNameBytes: Uint8Array,
  payload: Uint8Array,
): Uint8Array {
  const lfhSize = 30 + entryNameBytes.byteLength;
  const cdhOffset = lfhSize + payload.byteLength;
  const cdhSize = 46 + entryNameBytes.byteLength;
  const eocdOffset = cdhOffset + cdhSize;
  const totalSize = eocdOffset + 22;

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  // Local File Header
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint32(18, payload.byteLength, true);
  view.setUint32(22, payload.byteLength, true);
  view.setUint16(26, entryNameBytes.byteLength, true);
  view.setUint16(28, 0, true);
  buffer.set(entryNameBytes, 30);
  buffer.set(payload, lfhSize);

  // Central Directory Header
  view.setUint32(cdhOffset, 0x02014b50, true);
  view.setUint16(cdhOffset + 4, 20, true);
  view.setUint16(cdhOffset + 6, 20, true);
  view.setUint16(cdhOffset + 8, 0x0800, true);
  view.setUint16(cdhOffset + 10, 0, true);
  view.setUint32(cdhOffset + 20, payload.byteLength, true);
  view.setUint32(cdhOffset + 24, payload.byteLength, true);
  view.setUint16(cdhOffset + 28, entryNameBytes.byteLength, true);
  view.setUint32(cdhOffset + 42, 0, true);
  buffer.set(entryNameBytes, cdhOffset + 46);

  // End of Central Directory Record
  view.setUint32(eocdOffset, 0x06054b50, true);
  view.setUint16(eocdOffset + 8, 1, true);
  view.setUint16(eocdOffset + 10, 1, true);
  view.setUint32(eocdOffset + 12, cdhSize, true);
  view.setUint32(eocdOffset + 16, cdhOffset, true);

  return buffer;
}

const SYNTHETIC_COVER_ZIP_BYTES = buildSingleEntryStoreZip(
  COVER_ENTRY_NAME,
  MINIMAL_1X1_PNG,
);

export class MockCoverArchiveRangeReader implements RandomAccessReader {
  readonly sourceId: string;
  readonly totalSize: number;

  constructor(volumeId: string) {
    this.sourceId = `mock-cover:${volumeId}`;
    this.totalSize = SYNTHETIC_COVER_ZIP_BYTES.byteLength;
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
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
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
    return SYNTHETIC_COVER_ZIP_BYTES.slice(offset, end);
  }
}
