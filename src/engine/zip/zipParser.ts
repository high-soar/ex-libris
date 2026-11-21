import { ENGINE_BUDGETS } from "../constants";
import type {
  RandomAccessReader,
  ZipCompressionMethod,
  ZipPageEntry,
} from "../types";
import { ZipArchiveError } from "./errors";

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_EXTRA_HEADER_ID = 0x0001;
const CDH_SIGNATURE = 0x02014b50;
const LFH_SIGNATURE = 0x04034b50;

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const JUNK_BASENAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

const utf8NonStrictDecoder = new TextDecoder("utf-8", { fatal: false });
const utf8StrictDecoder = new TextDecoder("utf-8", { fatal: true });
const sjisDecoder = new TextDecoder("shift-jis", { fatal: false });

interface EocdInfo {
  readonly totalEntries: number;
  readonly cdSize: number;
  readonly cdOffset: number;
}

interface Zip64EocdLookupContext {
  readonly reader: RandomAccessReader;
  readonly tailBuf: Uint8Array;
  readonly tailStart: number;
  readonly tailView: DataView;
  readonly eocdRelOffset: number;
  readonly eocdAbsoluteOffset: number;
  readonly diskNumber: number;
  readonly cdDiskNumber: number;
  readonly diskEntries: number;
  readonly totalEntries: number;
  readonly signal?: AbortSignal;
}

interface Zip64CdhRawFields {
  readonly cdView: DataView;
  readonly extraStart: number;
  readonly extraFieldLength: number;
  readonly rawCompressedSize: number;
  readonly rawUncompressedSize: number;
  readonly rawLocalHeaderOffset: number;
  readonly rawDiskStartNumber: number;
  readonly entryName: string;
}

interface ResolvedZip64CdhFields {
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

interface ParsedCandidate {
  readonly entryName: string;
  readonly entryNameByteLength: number;
  readonly compressionMethod: ZipCompressionMethod;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly crc32: number;
}

interface ParsedCentralDirectoryResult {
  readonly candidates: ParsedCandidate[];
  readonly physicalOffsets: number[];
}

function createDataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readSafeUint64(view: DataView, offset: number, label: string): number {
  const value = view.getBigUint64(offset, true);
  if (value > MAX_SAFE_BIGINT) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      `${label}がJavaScriptの安全整数範囲を超過しています`,
    );
  }
  return Number(value);
}

function readZip64ExtraUint64(
  view: DataView,
  cursor: number,
  dataEnd: number,
  label: string,
): number {
  if (cursor + 8 > dataEnd) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      `ZIP64 Extra Fieldの${label}が不足しています`,
    );
  }
  return readSafeUint64(view, cursor, `ZIP64 ${label}`);
}

function decodeEntryName(nameBytes: Uint8Array, flags: number): string {
  if ((flags & 0x0800) !== 0) {
    return utf8NonStrictDecoder.decode(nameBytes);
  }
  try {
    return utf8StrictDecoder.decode(nameBytes);
  } catch {
    return sjisDecoder.decode(nameBytes);
  }
}

function isJunkOrNonImageEntry(
  entryName: string,
  externalAttributes: number,
): boolean {
  if (
    entryName.endsWith("/") ||
    entryName.endsWith("\\") ||
    (externalAttributes & 0x10) !== 0 ||
    ((externalAttributes >>> 16) & 0o170000) === 0o040000
  ) {
    return true;
  }

  const segments = entryName.split(/[\\/]/);
  if (segments.some((segment) => segment === "__MACOSX")) {
    return true;
  }

  const baseName = segments[segments.length - 1];
  if (baseName.startsWith("._")) {
    return true;
  }

  const lowerBaseName = baseName.toLowerCase();
  if (JUNK_BASENAMES.has(lowerBaseName)) {
    return true;
  }

  const dotIndex = lowerBaseName.lastIndexOf(".");
  if (dotIndex < 0) {
    return true;
  }

  return !IMAGE_EXTENSIONS.has(lowerBaseName.slice(dotIndex));
}

function findEocdOffset(tailView: DataView, byteLength: number): number {
  for (let i = byteLength - 22; i >= 0; i -= 1) {
    if (tailView.getUint32(i, true) === EOCD_SIGNATURE) {
      const commentLength = tailView.getUint16(i + 20, true);
      if (i + 22 + commentLength === byteLength) {
        return i;
      }
    }
  }
  return -1;
}

async function readZip64EocdInfo(
  ctx: Zip64EocdLookupContext,
): Promise<EocdInfo> {
  if (
    (ctx.diskNumber !== 0xffff && ctx.diskNumber !== 0) ||
    (ctx.cdDiskNumber !== 0xffff && ctx.cdDiskNumber !== 0) ||
    ctx.diskEntries !== ctx.totalEntries
  ) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "マルチディスクZIP64アーカイブには対応していません",
    );
  }

  const locatorRelOffset = ctx.eocdRelOffset - 20;
  const locatorDiskNumber = ctx.tailView.getUint32(locatorRelOffset + 4, true);
  const totalDisks = ctx.tailView.getUint32(locatorRelOffset + 16, true);
  if (locatorDiskNumber !== 0 || totalDisks !== 1) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "マルチディスクZIP64 Locatorには対応していません",
    );
  }

  const zip64EocdOffset = readSafeUint64(
    ctx.tailView,
    locatorRelOffset + 8,
    "ZIP64 EOCDオフセット",
  );
  const locatorAbsoluteOffset = ctx.eocdAbsoluteOffset - 20;
  if (zip64EocdOffset > locatorAbsoluteOffset - 56) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "ZIP64 EOCDレコード位置がLocator境界を超過しています",
    );
  }

  let z64Buf: Uint8Array;
  if (zip64EocdOffset >= ctx.tailStart) {
    const z64RelOffset = zip64EocdOffset - ctx.tailStart;
    z64Buf = ctx.tailBuf.subarray(z64RelOffset, z64RelOffset + 56);
  } else {
    z64Buf = await ctx.reader.readRange(zip64EocdOffset, 56, ctx.signal);
    if (z64Buf.byteLength !== 56) {
      throw new ZipArchiveError(
        "CORRUPT_ZIP",
        "ZIP64 EOCDレコードの読込サイズが不足しています",
      );
    }
  }

  const z64View = createDataView(z64Buf);
  if (z64View.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "不正なZIP64 EOCDシグネチャを検出しました",
    );
  }

  const sizeOfZip64Eocd = readSafeUint64(
    z64View,
    4,
    "ZIP64 EOCDレコードサイズ",
  );
  if (sizeOfZip64Eocd < 44) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "ZIP64 EOCDレコードサイズが最小長(44B)未満です",
    );
  }

  const z64DiskNumber = z64View.getUint32(16, true);
  const z64CdDiskNumber = z64View.getUint32(20, true);
  const z64DiskEntries = readSafeUint64(
    z64View,
    24,
    "ZIP64 EOCDディスクエントリ数",
  );
  const z64TotalEntries = readSafeUint64(z64View, 32, "ZIP64 EOCD総エントリ数");
  if (
    z64DiskNumber !== 0 ||
    z64CdDiskNumber !== 0 ||
    z64DiskEntries !== z64TotalEntries
  ) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "マルチディスクZIP64 EOCDレコードには対応していません",
    );
  }

  const cdSize = readSafeUint64(z64View, 40, "ZIP64 Central Directoryサイズ");
  const cdOffset = readSafeUint64(
    z64View,
    48,
    "ZIP64 Central Directoryオフセット",
  );
  if (cdSize > zip64EocdOffset - cdOffset) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "ZIP64 Central Directoryの範囲がZIP64 EOCD境界を超過しています",
    );
  }

  if (BigInt(z64TotalEntries) * 46n > BigInt(cdSize)) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "ZIP64 Central Directoryのエントリ数が領域サイズと不整合です",
    );
  }

  return {
    totalEntries: z64TotalEntries,
    cdSize,
    cdOffset,
  };
}

async function readEocdInfo(
  reader: RandomAccessReader,
  tailBuf: Uint8Array,
  tailStart: number,
  signal?: AbortSignal,
): Promise<EocdInfo> {
  const tailView = createDataView(tailBuf);
  const eocdRelOffset = findEocdOffset(tailView, tailBuf.byteLength);

  if (eocdRelOffset < 0) {
    throw new ZipArchiveError("CORRUPT_ZIP", "EOCDシグネチャが見つかりません");
  }

  const diskNumber = tailView.getUint16(eocdRelOffset + 4, true);
  const cdDiskNumber = tailView.getUint16(eocdRelOffset + 6, true);
  const diskEntries = tailView.getUint16(eocdRelOffset + 8, true);
  const totalEntries = tailView.getUint16(eocdRelOffset + 10, true);
  const cdSize = tailView.getUint32(eocdRelOffset + 12, true);
  const cdOffset = tailView.getUint32(eocdRelOffset + 16, true);
  const eocdAbsoluteOffset = tailStart + eocdRelOffset;

  const hasLocator =
    eocdRelOffset >= 20 &&
    tailView.getUint32(eocdRelOffset - 20, true) === ZIP64_LOCATOR_SIGNATURE;

  if (hasLocator) {
    return readZip64EocdInfo({
      reader,
      tailBuf,
      tailStart,
      tailView,
      eocdRelOffset,
      eocdAbsoluteOffset,
      diskNumber,
      cdDiskNumber,
      diskEntries,
      totalEntries,
      signal,
    });
  }

  if (diskNumber !== 0 || cdDiskNumber !== 0 || diskEntries !== totalEntries) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "マルチディスクZIPには対応していません",
    );
  }

  if (
    diskEntries === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "ZIP64 EOCD Locator不在の飽和EOCD値が含まれています",
    );
  }

  if (cdSize > eocdAbsoluteOffset - cdOffset) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "Central Directoryの範囲がEOCD境界を超過しています",
    );
  }

  if (BigInt(totalEntries) * 46n > BigInt(cdSize)) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "Central Directoryのエントリ数が領域サイズと不整合です",
    );
  }

  return { totalEntries, cdSize, cdOffset };
}

async function readCentralDirectoryBuffer(
  reader: RandomAccessReader,
  eocd: EocdInfo,
  tailBuf: Uint8Array,
  tailStart: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (eocd.cdOffset >= tailStart) {
    const cdRelStart = eocd.cdOffset - tailStart;
    return tailBuf.subarray(cdRelStart, cdRelStart + eocd.cdSize);
  }

  const cdBuf = await reader.readRange(eocd.cdOffset, eocd.cdSize, signal);
  if (cdBuf.byteLength !== eocd.cdSize) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "Central Directoryの追加読込サイズが不足しています",
    );
  }
  return cdBuf;
}

function resolveZip64CdhFields(raw: Zip64CdhRawFields): ResolvedZip64CdhFields {
  if (raw.rawDiskStartNumber !== 0 && raw.rawDiskStartNumber !== 0xffff) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      `マルチディスクZIPエントリには対応していません: ${raw.entryName}`,
    );
  }

  const needsUncompressed = raw.rawUncompressedSize === 0xffffffff;
  const needsCompressed = raw.rawCompressedSize === 0xffffffff;
  const needsOffset = raw.rawLocalHeaderOffset === 0xffffffff;
  const needsDisk = raw.rawDiskStartNumber === 0xffff;

  if (!needsUncompressed && !needsCompressed && !needsOffset && !needsDisk) {
    return {
      compressedSize: raw.rawCompressedSize,
      uncompressedSize: raw.rawUncompressedSize,
      localHeaderOffset: raw.rawLocalHeaderOffset,
    };
  }

  let extraPtr = raw.extraStart;
  const extraEnd = raw.extraStart + raw.extraFieldLength;
  while (extraPtr + 4 <= extraEnd) {
    const headerId = raw.cdView.getUint16(extraPtr, true);
    const dataSize = raw.cdView.getUint16(extraPtr + 2, true);
    const dataStart = extraPtr + 4;
    const dataEnd = dataStart + dataSize;
    if (dataEnd > extraEnd) {
      throw new ZipArchiveError(
        "CORRUPT_ZIP",
        `CDH Extra FieldのTLV長が境界を超過しています: ${raw.entryName}`,
      );
    }

    if (headerId === ZIP64_EXTRA_HEADER_ID) {
      let fieldCursor = dataStart;
      let uncompressedSize = raw.rawUncompressedSize;
      let compressedSize = raw.rawCompressedSize;
      let localHeaderOffset = raw.rawLocalHeaderOffset;

      if (needsUncompressed) {
        uncompressedSize = readZip64ExtraUint64(
          raw.cdView,
          fieldCursor,
          dataEnd,
          `非圧縮サイズ(${raw.entryName})`,
        );
        fieldCursor += 8;
      }

      if (needsCompressed) {
        compressedSize = readZip64ExtraUint64(
          raw.cdView,
          fieldCursor,
          dataEnd,
          `圧縮サイズ(${raw.entryName})`,
        );
        fieldCursor += 8;
      }

      if (needsOffset) {
        localHeaderOffset = readZip64ExtraUint64(
          raw.cdView,
          fieldCursor,
          dataEnd,
          `LFHオフセット(${raw.entryName})`,
        );
        fieldCursor += 8;
      }

      if (needsDisk) {
        if (fieldCursor + 4 > dataEnd) {
          throw new ZipArchiveError(
            "CORRUPT_ZIP",
            `ZIP64 Extra Fieldの開始ディスク番号が不足しています: ${raw.entryName}`,
          );
        }
        const diskStart = raw.cdView.getUint32(fieldCursor, true);
        if (diskStart !== 0) {
          throw new ZipArchiveError(
            "CORRUPT_ZIP",
            `マルチディスクZIP64エントリには対応していません: ${raw.entryName}`,
          );
        }
      }

      return {
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      };
    }

    extraPtr = dataEnd;
  }

  throw new ZipArchiveError(
    "CORRUPT_ZIP",
    `ZIP64飽和値に対応する0x0001 Extra Fieldが見つかりません: ${raw.entryName}`,
  );
}

function parseCentralDirectory(
  cdBuf: Uint8Array,
  totalEntries: number,
  cdOffset: number,
): ParsedCentralDirectoryResult {
  const cdView = createDataView(cdBuf);
  const candidates: ParsedCandidate[] = [];
  const physicalOffsets: number[] = [];
  let cursor = 0;

  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > cdBuf.byteLength) {
      throw new ZipArchiveError(
        "CORRUPT_ZIP",
        "CDH固定ヘッダが途中で終端に達しました",
      );
    }
    if (cdView.getUint32(cursor, true) !== CDH_SIGNATURE) {
      throw new ZipArchiveError(
        "CORRUPT_ZIP",
        "不正なCDHシグネチャを検出しました",
      );
    }

    const flags = cdView.getUint16(cursor + 8, true);
    const compressionMethod = cdView.getUint16(cursor + 10, true);
    const crc32 = cdView.getUint32(cursor + 16, true);
    const rawCompressedSize = cdView.getUint32(cursor + 20, true);
    const rawUncompressedSize = cdView.getUint32(cursor + 24, true);
    const fileNameLength = cdView.getUint16(cursor + 28, true);
    const extraFieldLength = cdView.getUint16(cursor + 30, true);
    const fileCommentLength = cdView.getUint16(cursor + 32, true);
    const rawDiskStartNumber = cdView.getUint16(cursor + 34, true);
    const externalAttributes = cdView.getUint32(cursor + 38, true);
    const rawLocalHeaderOffset = cdView.getUint32(cursor + 42, true);

    const nextCursor =
      cursor + 46 + fileNameLength + extraFieldLength + fileCommentLength;
    if (nextCursor > cdBuf.byteLength) {
      throw new ZipArchiveError(
        "CORRUPT_ZIP",
        "CDH可変長フィールドがCentral Directory境界を超過しています",
      );
    }

    const nameBytes = cdBuf.subarray(cursor + 46, cursor + 46 + fileNameLength);
    const entryName = decodeEntryName(nameBytes, flags);
    const extraStart = cursor + 46 + fileNameLength;

    const { compressedSize, uncompressedSize, localHeaderOffset } =
      resolveZip64CdhFields({
        cdView,
        extraStart,
        extraFieldLength,
        rawCompressedSize,
        rawUncompressedSize,
        rawLocalHeaderOffset,
        rawDiskStartNumber,
        entryName,
      });
    cursor = nextCursor;

    if (localHeaderOffset < cdOffset) {
      physicalOffsets.push(localHeaderOffset);
    }

    if (isJunkOrNonImageEntry(entryName, externalAttributes)) {
      continue;
    }

    if ((flags & 0x0001) !== 0) {
      throw new ZipArchiveError(
        "ENCRYPTED_ZIP",
        `暗号化エントリは未対応です: ${entryName}`,
      );
    }

    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new ZipArchiveError(
        "UNSUPPORTED_COMPRESSION",
        `未対応の圧縮方式 (${compressionMethod}) です: ${entryName}`,
      );
    }

    if (localHeaderOffset > cdOffset - 30) {
      throw new ZipArchiveError(
        "CORRUPT_ZIP",
        `LFHオフセットがCentral Directory開始位置を超過しています: ${entryName}`,
      );
    }

    candidates.push({
      entryName,
      entryNameByteLength: fileNameLength,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      crc32,
    });
  }

  return { candidates, physicalOffsets };
}

function findNextPhysicalOffset(
  sortedOffsets: readonly number[],
  localHeaderOffset: number,
  cdOffset: number,
): number {
  let low = 0;
  let high = sortedOffsets.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sortedOffsets[mid] <= localHeaderOffset) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low < sortedOffsets.length ? sortedOffsets[low] : cdOffset;
}

function compareEntryNamesBySegment(
  a: string,
  b: string,
  collator: Intl.Collator,
): number {
  const segsA = a.split(/[\\/]/);
  const segsB = b.split(/[\\/]/);
  const minLength = Math.min(segsA.length, segsB.length);
  for (let i = 0; i < minLength; i += 1) {
    const cmp = collator.compare(segsA[i], segsB[i]);
    if (cmp !== 0) {
      return cmp;
    }
  }
  return segsA.length - segsB.length;
}

function buildLogicalPageEntries(
  parsed: ParsedCentralDirectoryResult,
  cdOffset: number,
): ZipPageEntry[] {
  const sortedOffsets = [...parsed.physicalOffsets].sort((a, b) => a - b);
  for (let i = 1; i < sortedOffsets.length; i += 1) {
    if (sortedOffsets[i] <= sortedOffsets[i - 1]) {
      throw new ZipArchiveError(
        "CORRUPT_ZIP",
        `CDHのLFHオフセットが重複しています: ${sortedOffsets[i]}`,
      );
    }
  }

  if (parsed.candidates.length === 0) {
    throw new ZipArchiveError(
      "EMPTY_ARCHIVE",
      "有効な画像ファイルが見つかりませんでした",
    );
  }

  const collator = new Intl.Collator("ja", {
    numeric: true,
    sensitivity: "base",
  });
  const logicalSorted = [...parsed.candidates].sort((a, b) =>
    compareEntryNamesBySegment(a.entryName, b.entryName, collator),
  );

  return logicalSorted.map((item, pageIndex) => ({
    pageIndex,
    entryName: item.entryName,
    entryNameByteLength: item.entryNameByteLength,
    compressionMethod: item.compressionMethod,
    compressedSize: item.compressedSize,
    uncompressedSize: item.uncompressedSize,
    localHeaderOffset: item.localHeaderOffset,
    physicalEnd: findNextPhysicalOffset(
      sortedOffsets,
      item.localHeaderOffset,
      cdOffset,
    ),
    crc32: item.crc32,
  }));
}

export async function parseZipDirectory(
  reader: RandomAccessReader,
  signal?: AbortSignal,
): Promise<ZipPageEntry[]> {
  const tailLength = Math.min(
    reader.totalSize,
    ENGINE_BUDGETS.INITIAL_TAIL_READ_BYTES,
  );
  const tailStart = reader.totalSize - tailLength;
  const tailBuf = await reader.readRange(tailStart, tailLength, signal);

  if (tailBuf.byteLength !== tailLength || tailBuf.byteLength < 22) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "ZIP末尾のEOCD領域を読み取れません",
    );
  }

  const eocd = await readEocdInfo(reader, tailBuf, tailStart, signal);
  const cdBuf = await readCentralDirectoryBuffer(
    reader,
    eocd,
    tailBuf,
    tailStart,
    signal,
  );
  const parsed = parseCentralDirectory(cdBuf, eocd.totalEntries, eocd.cdOffset);

  return buildLogicalPageEntries(parsed, eocd.cdOffset);
}

export function computeEntryFetchSpan(_entry: ZipPageEntry): number {
  return 0;
}

export async function extractCompressedSliceFromBuffer(
  _reader: RandomAccessReader,
  _entry: ZipPageEntry,
  _initialBuf: Uint8Array,
  _signal?: AbortSignal,
): Promise<Uint8Array> {
  return new Uint8Array(0);
}

export async function readCompressedPageSlice(
  reader: RandomAccessReader,
  entry: ZipPageEntry,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const maxSpan = entry.physicalEnd - entry.localHeaderOffset;
  if (entry.localHeaderOffset < 0 || maxSpan < 30) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      `LFHの物理範囲が不正です: ${entry.entryName}`,
    );
  }

  const fetchLength = Math.min(
    maxSpan,
    30 +
      entry.entryNameByteLength +
      entry.compressedSize +
      ENGINE_BUDGETS.LFH_EXTRA_MARGIN_BYTES,
  );
  const initialBuf = await reader.readRange(
    entry.localHeaderOffset,
    fetchLength,
    signal,
  );

  if (initialBuf.byteLength < 30) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      `LFHヘッダ長が不足しています: ${entry.entryName}`,
    );
  }

  const lfhView = createDataView(initialBuf);
  if (lfhView.getUint32(0, true) !== LFH_SIGNATURE) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      `不正なLFHシグネチャを検出しました: ${entry.entryName}`,
    );
  }

  const lfhFileNameLength = lfhView.getUint16(26, true);
  const lfhExtraFieldLength = lfhView.getUint16(28, true);
  const dataStart = 30 + lfhFileNameLength + lfhExtraFieldLength;
  const dataEnd = dataStart + entry.compressedSize;

  if (dataEnd > maxSpan) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      `圧縮データ終端が物理境界を超過しています: ${entry.entryName}`,
    );
  }

  if (dataEnd <= initialBuf.byteLength) {
    return initialBuf.subarray(dataStart, dataEnd);
  }

  if (dataStart >= initialBuf.byteLength) {
    const directSlice = await reader.readRange(
      entry.localHeaderOffset + dataStart,
      entry.compressedSize,
      signal,
    );
    if (directSlice.byteLength !== entry.compressedSize) {
      throw new ZipArchiveError(
        "CORRUPT_ZIP",
        `LFH超過分の直接読込サイズが不足しています: ${entry.entryName}`,
      );
    }
    return directSlice;
  }

  const headSlice = initialBuf.subarray(dataStart);
  const remainingOffset = entry.localHeaderOffset + initialBuf.byteLength;
  const remainingLength = entry.compressedSize - headSlice.byteLength;
  const tailSlice = await reader.readRange(
    remainingOffset,
    remainingLength,
    signal,
  );
  if (tailSlice.byteLength !== remainingLength) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      `LFH超過分の追加読込サイズが不足しています: ${entry.entryName}`,
    );
  }

  const combined = new Uint8Array(entry.compressedSize);
  combined.set(headSlice, 0);
  combined.set(tailSlice, headSlice.byteLength);
  return combined;
}
