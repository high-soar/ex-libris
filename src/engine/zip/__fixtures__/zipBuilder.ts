import { deflateSync } from "fflate";
import type { RandomAccessReader } from "../../types";

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface SyntheticZipEntryInput {
  readonly name: string | Uint8Array;
  readonly data?: Uint8Array;
  readonly compressionMethod?: number;
  readonly compressedData?: Uint8Array;
  readonly flags?: number;
  readonly lfhExtra?: Uint8Array;
  readonly cdhExtra?: Uint8Array;
  readonly cdhComment?: Uint8Array;
  readonly externalAttributes?: number;
  readonly dataDescriptor?: boolean;
  readonly overrideCdhCompressedSize?: number;
  readonly overrideCdhUncompressedSize?: number;
  readonly overrideCdhLocalHeaderOffset?: number;
  readonly overrideLfhSignature?: number;
  readonly overrideCdhSignature?: number;
  readonly overrideLfhFileNameLength?: number;
  readonly overrideLfhExtraLength?: number;
}

export interface SyntheticZipArchiveOptions {
  readonly entries: readonly SyntheticZipEntryInput[];
  readonly comment?: string | Uint8Array;
  readonly preambleBytes?: Uint8Array;
  readonly prependZip64Locator?: boolean;
  readonly omitEocd?: boolean;
  readonly reorderCdhOrder?: readonly number[];
  readonly overrideEocd?: {
    readonly diskNumber?: number;
    readonly cdDiskNumber?: number;
    readonly diskEntries?: number;
    readonly totalEntries?: number;
    readonly cdSize?: number;
    readonly cdOffset?: number;
  };
}

function encodeName(name: string | Uint8Array): Uint8Array {
  if (typeof name === "string") {
    return new TextEncoder().encode(name);
  }
  return name;
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function buildSyntheticZip(
  options: SyntheticZipArchiveOptions,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let currentOffset = 0;

  if (options.preambleBytes && options.preambleBytes.byteLength > 0) {
    chunks.push(options.preambleBytes);
    currentOffset += options.preambleBytes.byteLength;
  }

  interface BuiltRecord {
    readonly nameBytes: Uint8Array;
    readonly flags: number;
    readonly compressionMethod: number;
    readonly crc32: number;
    readonly compressedSize: number;
    readonly uncompressedSize: number;
    readonly externalAttributes: number;
    readonly localHeaderOffset: number;
    readonly cdhExtra: Uint8Array;
    readonly cdhComment: Uint8Array;
    readonly entry: SyntheticZipEntryInput;
  }

  const records: BuiltRecord[] = [];

  for (const entry of options.entries) {
    const rawData = entry.data ?? new Uint8Array(0);
    const compressionMethod = entry.compressionMethod ?? 0;
    const compressedData =
      entry.compressedData ??
      (compressionMethod === 8 ? deflateSync(rawData) : rawData);
    const nameBytes = encodeName(entry.name);
    const lfhExtra = entry.lfhExtra ?? new Uint8Array(0);
    const cdhExtra = entry.cdhExtra ?? new Uint8Array(0);
    const cdhComment = entry.cdhComment ?? new Uint8Array(0);
    const crc32 = computeCrc32(rawData);
    const useDataDescriptor = entry.dataDescriptor === true;
    const flags =
      (entry.flags ?? (typeof entry.name === "string" ? 0x0800 : 0)) |
      (useDataDescriptor ? 0x0008 : 0);

    const localHeaderOffset = currentOffset;
    const lfh = new Uint8Array(30 + nameBytes.byteLength + lfhExtra.byteLength);
    const lfhView = new DataView(lfh.buffer);

    lfhView.setUint32(0, entry.overrideLfhSignature ?? 0x04034b50, true);
    lfhView.setUint16(4, 20, true);
    lfhView.setUint16(6, flags, true);
    lfhView.setUint16(8, compressionMethod, true);
    lfhView.setUint16(10, 0, true);
    lfhView.setUint16(12, 0, true);
    lfhView.setUint32(14, useDataDescriptor ? 0 : crc32, true);
    lfhView.setUint32(
      18,
      useDataDescriptor ? 0 : compressedData.byteLength,
      true,
    );
    lfhView.setUint32(22, useDataDescriptor ? 0 : rawData.byteLength, true);
    lfhView.setUint16(
      26,
      entry.overrideLfhFileNameLength ?? nameBytes.byteLength,
      true,
    );
    lfhView.setUint16(
      28,
      entry.overrideLfhExtraLength ?? lfhExtra.byteLength,
      true,
    );
    lfh.set(nameBytes, 30);
    lfh.set(lfhExtra, 30 + nameBytes.byteLength);

    chunks.push(lfh, compressedData);
    currentOffset += lfh.byteLength + compressedData.byteLength;

    if (useDataDescriptor) {
      const dd = new Uint8Array(16);
      const ddView = new DataView(dd.buffer);
      ddView.setUint32(0, 0x08074b50, true);
      ddView.setUint32(4, crc32, true);
      ddView.setUint32(8, compressedData.byteLength, true);
      ddView.setUint32(12, rawData.byteLength, true);
      chunks.push(dd);
      currentOffset += dd.byteLength;
    }

    records.push({
      nameBytes,
      flags,
      compressionMethod,
      crc32,
      compressedSize: compressedData.byteLength,
      uncompressedSize: rawData.byteLength,
      externalAttributes: entry.externalAttributes ?? 0,
      localHeaderOffset,
      cdhExtra,
      cdhComment,
      entry,
    });
  }

  const cdOffset = currentOffset;
  const cdOrder = options.reorderCdhOrder ?? records.map((_, index) => index);
  let cdSize = 0;

  for (const recordIdx of cdOrder) {
    const rec = records[recordIdx];
    const cdh = new Uint8Array(
      46 +
        rec.nameBytes.byteLength +
        rec.cdhExtra.byteLength +
        rec.cdhComment.byteLength,
    );
    const cdhView = new DataView(cdh.buffer);

    cdhView.setUint32(0, rec.entry.overrideCdhSignature ?? 0x02014b50, true);
    cdhView.setUint16(4, 0x0314, true);
    cdhView.setUint16(6, 20, true);
    cdhView.setUint16(8, rec.flags, true);
    cdhView.setUint16(10, rec.compressionMethod, true);
    cdhView.setUint16(12, 0, true);
    cdhView.setUint16(14, 0, true);
    cdhView.setUint32(16, rec.crc32, true);
    cdhView.setUint32(
      20,
      rec.entry.overrideCdhCompressedSize ?? rec.compressedSize,
      true,
    );
    cdhView.setUint32(
      24,
      rec.entry.overrideCdhUncompressedSize ?? rec.uncompressedSize,
      true,
    );
    cdhView.setUint16(28, rec.nameBytes.byteLength, true);
    cdhView.setUint16(30, rec.cdhExtra.byteLength, true);
    cdhView.setUint16(32, rec.cdhComment.byteLength, true);
    cdhView.setUint16(34, 0, true);
    cdhView.setUint16(36, 0, true);
    cdhView.setUint32(38, rec.externalAttributes, true);
    cdhView.setUint32(
      42,
      rec.entry.overrideCdhLocalHeaderOffset ?? rec.localHeaderOffset,
      true,
    );

    let ptr = 46;
    cdh.set(rec.nameBytes, ptr);
    ptr += rec.nameBytes.byteLength;
    cdh.set(rec.cdhExtra, ptr);
    ptr += rec.cdhExtra.byteLength;
    cdh.set(rec.cdhComment, ptr);

    chunks.push(cdh);
    cdSize += cdh.byteLength;
    currentOffset += cdh.byteLength;
  }

  if (options.prependZip64Locator) {
    const locator = new Uint8Array(20);
    const locView = new DataView(locator.buffer);
    locView.setUint32(0, 0x07064b50, true);
    locView.setUint32(4, 0, true);
    locView.setBigUint64(8, BigInt(currentOffset), true);
    locView.setUint32(16, 1, true);
    chunks.push(locator);
  }

  if (!options.omitEocd) {
    const commentBytes =
      options.comment !== undefined
        ? encodeName(options.comment)
        : new Uint8Array(0);
    const eocd = new Uint8Array(22 + commentBytes.byteLength);
    const eocdView = new DataView(eocd.buffer);
    const eocdOverride = options.overrideEocd ?? {};

    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, eocdOverride.diskNumber ?? 0, true);
    eocdView.setUint16(6, eocdOverride.cdDiskNumber ?? 0, true);
    eocdView.setUint16(8, eocdOverride.diskEntries ?? cdOrder.length, true);
    eocdView.setUint16(10, eocdOverride.totalEntries ?? cdOrder.length, true);
    eocdView.setUint32(12, eocdOverride.cdSize ?? cdSize, true);
    eocdView.setUint32(16, eocdOverride.cdOffset ?? cdOffset, true);
    eocdView.setUint16(20, commentBytes.byteLength, true);
    eocd.set(commentBytes, 22);
    chunks.push(eocd);
  }

  return concatChunks(chunks);
}

export interface RecordedRangeRead {
  readonly offset: number;
  readonly length: number;
}

export interface SpyMemoryReader extends RandomAccessReader {
  readonly reads: RecordedRangeRead[];
}

export function createMemoryReader(
  bytes: Uint8Array,
  sourceId = "memory:test.zip",
): SpyMemoryReader {
  const reads: RecordedRangeRead[] = [];
  return {
    sourceId,
    totalSize: bytes.byteLength,
    reads,
    async readRange(offset: number, length: number, signal?: AbortSignal) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      reads.push({ offset, length });
      const end = Math.min(offset + length, bytes.byteLength);
      if (length === 0 || offset >= bytes.byteLength) {
        return new Uint8Array(0);
      }
      return bytes.slice(offset, end);
    },
  };
}
