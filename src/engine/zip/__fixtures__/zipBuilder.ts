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

export interface SyntheticZip64ExtraInput {
  readonly uncompressedSize?: bigint;
  readonly compressedSize?: bigint;
  readonly localHeaderOffset?: bigint;
  readonly diskStartNumber?: number;
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
  readonly overrideCdhDiskStartNumber?: number;
  readonly overrideLfhSignature?: number;
  readonly overrideCdhSignature?: number;
  readonly overrideLfhFileNameLength?: number;
  readonly overrideLfhExtraLength?: number;
  readonly zip64Extra?: SyntheticZip64ExtraInput;
  readonly cdhExtraPrefix?: Uint8Array;
}

export interface SyntheticZipArchiveOptions {
  readonly entries: readonly SyntheticZipEntryInput[];
  readonly comment?: string | Uint8Array;
  readonly preambleBytes?: Uint8Array;
  readonly prependZip64Locator?: boolean;
  readonly zip64?: boolean;
  readonly saturateStandardEocd?: boolean;
  readonly virtualOffsetShift?: number;
  readonly zip64EocdExtensibleData?: Uint8Array;
  readonly betweenZip64EocdAndLocatorBytes?: number;
  readonly omitZip64Eocd?: boolean;
  readonly omitZip64Locator?: boolean;
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
  readonly overrideZip64Locator?: {
    readonly signature?: number;
    readonly locatorDiskNumber?: number;
    readonly zip64EocdOffset?: bigint;
    readonly totalDisks?: number;
  };
  readonly overrideZip64Eocd?: {
    readonly signature?: number;
    readonly sizeOfZip64Eocd?: bigint;
    readonly diskNumber?: number;
    readonly cdDiskNumber?: number;
    readonly diskEntries?: bigint;
    readonly totalEntries?: bigint;
    readonly cdSize?: bigint;
    readonly cdOffset?: bigint;
  };
}

export function buildTlvBlock(
  headerId: number,
  payload: Uint8Array,
): Uint8Array {
  const block = new Uint8Array(4 + payload.byteLength);
  const view = new DataView(block.buffer);
  view.setUint16(0, headerId, true);
  view.setUint16(2, payload.byteLength, true);
  block.set(payload, 4);
  return block;
}

export function buildZip64ExtraField(
  fields: SyntheticZip64ExtraInput,
): Uint8Array {
  let payloadSize = 0;
  if (fields.uncompressedSize !== undefined) payloadSize += 8;
  if (fields.compressedSize !== undefined) payloadSize += 8;
  if (fields.localHeaderOffset !== undefined) payloadSize += 8;
  if (fields.diskStartNumber !== undefined) payloadSize += 4;

  const payload = new Uint8Array(payloadSize);
  const view = new DataView(payload.buffer);
  let ptr = 0;
  if (fields.uncompressedSize !== undefined) {
    view.setBigUint64(ptr, fields.uncompressedSize, true);
    ptr += 8;
  }
  if (fields.compressedSize !== undefined) {
    view.setBigUint64(ptr, fields.compressedSize, true);
    ptr += 8;
  }
  if (fields.localHeaderOffset !== undefined) {
    view.setBigUint64(ptr, fields.localHeaderOffset, true);
    ptr += 8;
  }
  if (fields.diskStartNumber !== undefined) {
    view.setUint32(ptr, fields.diskStartNumber, true);
  }
  return buildTlvBlock(0x0001, payload);
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
  const virtualShift = options.virtualOffsetShift ?? 0;
  const isZip64 = options.zip64 === true || virtualShift > 0;
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
    readonly diskStartNumber: number;
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
    const cdhComment = entry.cdhComment ?? new Uint8Array(0);
    const crc32 = computeCrc32(rawData);
    const useDataDescriptor = entry.dataDescriptor === true;
    const flags =
      (entry.flags ?? (typeof entry.name === "string" ? 0x0800 : 0)) |
      (useDataDescriptor ? 0x0008 : 0);

    const localHeaderOffset = currentOffset;
    const shiftedLocalHeaderOffset = localHeaderOffset + virtualShift;
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

    let cdhCompressedSize =
      entry.overrideCdhCompressedSize ?? compressedData.byteLength;
    let cdhUncompressedSize =
      entry.overrideCdhUncompressedSize ?? rawData.byteLength;
    let cdhLocalHeaderOffset =
      entry.overrideCdhLocalHeaderOffset ?? shiftedLocalHeaderOffset;
    let cdhDiskStartNumber = entry.overrideCdhDiskStartNumber ?? 0;

    let cdhExtra: Uint8Array;
    if (entry.cdhExtra !== undefined) {
      cdhExtra = entry.cdhExtra;
    } else if (
      entry.zip64Extra !== undefined ||
      shiftedLocalHeaderOffset >= 0xffffffff
    ) {
      const z64Fields: {
        uncompressedSize?: bigint;
        compressedSize?: bigint;
        localHeaderOffset?: bigint;
        diskStartNumber?: number;
      } = {};
      if (entry.zip64Extra?.uncompressedSize !== undefined) {
        cdhUncompressedSize = entry.overrideCdhUncompressedSize ?? 0xffffffff;
        z64Fields.uncompressedSize = entry.zip64Extra.uncompressedSize;
      }
      if (entry.zip64Extra?.compressedSize !== undefined) {
        cdhCompressedSize = entry.overrideCdhCompressedSize ?? 0xffffffff;
        z64Fields.compressedSize = entry.zip64Extra.compressedSize;
      }
      if (
        entry.zip64Extra?.localHeaderOffset !== undefined ||
        shiftedLocalHeaderOffset >= 0xffffffff
      ) {
        cdhLocalHeaderOffset = entry.overrideCdhLocalHeaderOffset ?? 0xffffffff;
        z64Fields.localHeaderOffset =
          entry.zip64Extra?.localHeaderOffset ??
          BigInt(shiftedLocalHeaderOffset);
      }
      if (entry.zip64Extra?.diskStartNumber !== undefined) {
        cdhDiskStartNumber = entry.overrideCdhDiskStartNumber ?? 0xffff;
        z64Fields.diskStartNumber = entry.zip64Extra.diskStartNumber;
      }
      const z64Block = buildZip64ExtraField(z64Fields);
      cdhExtra = entry.cdhExtraPrefix
        ? concatChunks([entry.cdhExtraPrefix, z64Block])
        : z64Block;
    } else {
      cdhExtra = entry.cdhExtraPrefix ?? new Uint8Array(0);
    }

    records.push({
      nameBytes,
      flags,
      compressionMethod,
      crc32,
      compressedSize: cdhCompressedSize,
      uncompressedSize: cdhUncompressedSize,
      diskStartNumber: cdhDiskStartNumber,
      externalAttributes: entry.externalAttributes ?? 0,
      localHeaderOffset: cdhLocalHeaderOffset,
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
    cdhView.setUint16(6, isZip64 ? 45 : 20, true);
    cdhView.setUint16(8, rec.flags, true);
    cdhView.setUint16(10, rec.compressionMethod, true);
    cdhView.setUint16(12, 0, true);
    cdhView.setUint16(14, 0, true);
    cdhView.setUint32(16, rec.crc32, true);
    cdhView.setUint32(20, rec.compressedSize, true);
    cdhView.setUint32(24, rec.uncompressedSize, true);
    cdhView.setUint16(28, rec.nameBytes.byteLength, true);
    cdhView.setUint16(30, rec.cdhExtra.byteLength, true);
    cdhView.setUint16(32, rec.cdhComment.byteLength, true);
    cdhView.setUint16(34, rec.diskStartNumber, true);
    cdhView.setUint16(36, 0, true);
    cdhView.setUint32(38, rec.externalAttributes, true);
    cdhView.setUint32(42, rec.localHeaderOffset, true);

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

  if (isZip64) {
    const zip64EocdOffset = currentOffset + virtualShift;
    if (!options.omitZip64Eocd) {
      const extensible = options.zip64EocdExtensibleData ?? new Uint8Array(0);
      const z64Eocd = new Uint8Array(56 + extensible.byteLength);
      const z64View = new DataView(z64Eocd.buffer);
      const z64Override = options.overrideZip64Eocd ?? {};

      z64View.setUint32(0, z64Override.signature ?? 0x06064b50, true);
      z64View.setBigUint64(
        4,
        z64Override.sizeOfZip64Eocd ?? BigInt(44 + extensible.byteLength),
        true,
      );
      z64View.setUint16(12, 0x032d, true);
      z64View.setUint16(14, 45, true);
      z64View.setUint32(16, z64Override.diskNumber ?? 0, true);
      z64View.setUint32(20, z64Override.cdDiskNumber ?? 0, true);
      z64View.setBigUint64(
        24,
        z64Override.diskEntries ?? BigInt(cdOrder.length),
        true,
      );
      z64View.setBigUint64(
        32,
        z64Override.totalEntries ?? BigInt(cdOrder.length),
        true,
      );
      z64View.setBigUint64(40, z64Override.cdSize ?? BigInt(cdSize), true);
      z64View.setBigUint64(
        48,
        z64Override.cdOffset ?? BigInt(cdOffset + virtualShift),
        true,
      );
      if (extensible.byteLength > 0) {
        z64Eocd.set(extensible, 56);
      }
      chunks.push(z64Eocd);
      currentOffset += z64Eocd.byteLength;
    }

    if (
      options.betweenZip64EocdAndLocatorBytes !== undefined &&
      options.betweenZip64EocdAndLocatorBytes > 0
    ) {
      const pad = new Uint8Array(options.betweenZip64EocdAndLocatorBytes);
      chunks.push(pad);
      currentOffset += pad.byteLength;
    }

    if (!options.omitZip64Locator) {
      const locOverride = options.overrideZip64Locator ?? {};
      const locator = new Uint8Array(20);
      const locView = new DataView(locator.buffer);
      locView.setUint32(0, locOverride.signature ?? 0x07064b50, true);
      locView.setUint32(4, locOverride.locatorDiskNumber ?? 0, true);
      locView.setBigUint64(
        8,
        locOverride.zip64EocdOffset ?? BigInt(zip64EocdOffset),
        true,
      );
      locView.setUint32(16, locOverride.totalDisks ?? 1, true);
      chunks.push(locator);
      currentOffset += locator.byteLength;
    }
  } else if (options.prependZip64Locator) {
    const locOverride = options.overrideZip64Locator ?? {};
    const locator = new Uint8Array(20);
    const locView = new DataView(locator.buffer);
    locView.setUint32(0, locOverride.signature ?? 0x07064b50, true);
    locView.setUint32(4, locOverride.locatorDiskNumber ?? 0, true);
    locView.setBigUint64(
      8,
      locOverride.zip64EocdOffset ?? BigInt(currentOffset + virtualShift),
      true,
    );
    locView.setUint32(16, locOverride.totalDisks ?? 1, true);
    chunks.push(locator);
    currentOffset += locator.byteLength;
  }

  if (!options.omitEocd) {
    const commentBytes =
      options.comment !== undefined
        ? encodeName(options.comment)
        : new Uint8Array(0);
    const eocd = new Uint8Array(22 + commentBytes.byteLength);
    const eocdView = new DataView(eocd.buffer);
    const eocdOverride = options.overrideEocd ?? {};
    const shouldSaturate = isZip64 && options.saturateStandardEocd !== false;

    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(
      4,
      eocdOverride.diskNumber ?? (shouldSaturate ? 0xffff : 0),
      true,
    );
    eocdView.setUint16(
      6,
      eocdOverride.cdDiskNumber ?? (shouldSaturate ? 0xffff : 0),
      true,
    );
    eocdView.setUint16(
      8,
      eocdOverride.diskEntries ?? (shouldSaturate ? 0xffff : cdOrder.length),
      true,
    );
    eocdView.setUint16(
      10,
      eocdOverride.totalEntries ?? (shouldSaturate ? 0xffff : cdOrder.length),
      true,
    );
    eocdView.setUint32(
      12,
      eocdOverride.cdSize ?? (shouldSaturate ? 0xffffffff : cdSize),
      true,
    );
    eocdView.setUint32(
      16,
      eocdOverride.cdOffset ??
        (shouldSaturate ? 0xffffffff : cdOffset + virtualShift),
      true,
    );
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

export function createVirtualOffsetReader(
  bytes: Uint8Array,
  virtualOffsetShift: number,
  sourceId = "virtual-zip64:test.zip",
): SpyMemoryReader {
  const reads: RecordedRangeRead[] = [];
  const totalSize = virtualOffsetShift + bytes.byteLength;
  return {
    sourceId,
    totalSize,
    reads,
    async readRange(offset: number, length: number, signal?: AbortSignal) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      reads.push({ offset, length });
      const end = Math.min(offset + length, totalSize);
      if (length === 0 || offset >= totalSize || end <= offset) {
        return new Uint8Array(0);
      }
      const out = new Uint8Array(end - offset);
      if (end > virtualOffsetShift) {
        const srcStart = Math.max(0, offset - virtualOffsetShift);
        const srcEnd = end - virtualOffsetShift;
        const destOffset = Math.max(0, virtualOffsetShift - offset);
        out.set(bytes.subarray(srcStart, srcEnd), destOffset);
      }
      return out;
    },
  };
}
