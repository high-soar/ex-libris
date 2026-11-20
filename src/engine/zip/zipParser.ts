import { ENGINE_BUDGETS } from "../constants";
import type {
  RandomAccessReader,
  ZipCompressionMethod,
  ZipPageEntry,
} from "../types";
import { ZipArchiveError } from "./errors";

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CDH_SIGNATURE = 0x02014b50;
const LFH_SIGNATURE = 0x04034b50;

const JUNK_BASENAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

interface EocdInfo {
  readonly totalEntries: number;
  readonly cdSize: number;
  readonly cdOffset: number;
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

function readEocdInfo(tailBuf: Uint8Array, tailStart: number): EocdInfo {
  const tailView = createDataView(tailBuf);
  const eocdRelOffset = findEocdOffset(tailView, tailBuf.byteLength);

  if (eocdRelOffset < 0) {
    throw new ZipArchiveError("CORRUPT_ZIP", "EOCDシグネチャが見つかりません");
  }

  if (
    eocdRelOffset >= 20 &&
    tailView.getUint32(eocdRelOffset - 20, true) === ZIP64_LOCATOR_SIGNATURE
  ) {
    throw new ZipArchiveError(
      "ZIP64_NOT_SUPPORTED",
      "ZIP64形式は次期バージョン(v0.1)で対応予定です",
    );
  }

  const diskNumber = tailView.getUint16(eocdRelOffset + 4, true);
  const cdDiskNumber = tailView.getUint16(eocdRelOffset + 6, true);
  const diskEntries = tailView.getUint16(eocdRelOffset + 8, true);
  const totalEntries = tailView.getUint16(eocdRelOffset + 10, true);
  const cdSize = tailView.getUint32(eocdRelOffset + 12, true);
  const cdOffset = tailView.getUint32(eocdRelOffset + 16, true);

  if (
    diskNumber === 0xffff ||
    cdDiskNumber === 0xffff ||
    diskEntries === 0xffff ||
    totalEntries === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    throw new ZipArchiveError(
      "ZIP64_NOT_SUPPORTED",
      "ZIP64飽和値を含むアーカイブは次期バージョン(v0.1)で対応予定です",
    );
  }

  const eocdAbsoluteOffset = tailStart + eocdRelOffset;
  if (cdOffset + cdSize > eocdAbsoluteOffset) {
    throw new ZipArchiveError(
      "CORRUPT_ZIP",
      "Central Directoryの範囲がEOCD境界を超過しています",
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

function parseCentralDirectory(
  cdBuf: Uint8Array,
  totalEntries: number,
  cdOffset: number,
): ParsedCentralDirectoryResult {
  const cdView = createDataView(cdBuf);
  const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
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
    const compressedSize = cdView.getUint32(cursor + 20, true);
    const uncompressedSize = cdView.getUint32(cursor + 24, true);
    const fileNameLength = cdView.getUint16(cursor + 28, true);
    const extraFieldLength = cdView.getUint16(cursor + 30, true);
    const fileCommentLength = cdView.getUint16(cursor + 32, true);
    const externalAttributes = cdView.getUint32(cursor + 38, true);
    const localHeaderOffset = cdView.getUint32(cursor + 42, true);

    const nextCursor =
      cursor + 46 + fileNameLength + extraFieldLength + fileCommentLength;
    if (nextCursor > cdBuf.byteLength) {
      throw new ZipArchiveError(
        "CORRUPT_ZIP",
        "CDH可変長フィールドがCentral Directory境界を超過しています",
      );
    }

    const nameBytes = cdBuf.subarray(cursor + 46, cursor + 46 + fileNameLength);
    const entryName = utf8Decoder.decode(nameBytes);
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

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new ZipArchiveError(
        "ZIP64_NOT_SUPPORTED",
        `ZIP64エントリは次期バージョン(v0.1)で対応予定です: ${entryName}`,
      );
    }

    if (localHeaderOffset + 30 > cdOffset) {
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
    collator.compare(a.entryName, b.entryName),
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

  const eocd = readEocdInfo(tailBuf, tailStart);
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

  const remainingOffset = entry.localHeaderOffset + initialBuf.byteLength;
  const remainingLength = dataEnd - initialBuf.byteLength;
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

  const combined = new Uint8Array(dataEnd);
  combined.set(initialBuf, 0);
  combined.set(tailSlice, initialBuf.byteLength);
  return combined.subarray(dataStart, dataEnd);
}
