import type { ZipPageEntry } from "../types";

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isValidZipPageEntry(
  entry: unknown,
  expectedPageIndex: number,
): boolean {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }

  const candidate = entry as Record<string, unknown>;
  if (candidate.pageIndex !== expectedPageIndex) {
    return false;
  }
  if (
    typeof candidate.entryName !== "string" ||
    candidate.entryName.length === 0
  ) {
    return false;
  }
  if (
    typeof candidate.entryNameByteLength !== "number" ||
    !Number.isInteger(candidate.entryNameByteLength) ||
    candidate.entryNameByteLength <= 0
  ) {
    return false;
  }
  if (candidate.compressionMethod !== 0 && candidate.compressionMethod !== 8) {
    return false;
  }
  if (
    !isNonNegativeSafeInteger(candidate.compressedSize) ||
    !isNonNegativeSafeInteger(candidate.uncompressedSize) ||
    !isNonNegativeSafeInteger(candidate.localHeaderOffset) ||
    !isNonNegativeSafeInteger(candidate.physicalEnd)
  ) {
    return false;
  }
  if (candidate.physicalEnd <= candidate.localHeaderOffset) {
    return false;
  }
  if (
    typeof candidate.crc32 !== "number" ||
    !Number.isInteger(candidate.crc32) ||
    candidate.crc32 < 0 ||
    candidate.crc32 > 0xffffffff
  ) {
    return false;
  }

  return true;
}

export function validateZipIndexEntries(
  entries: unknown,
  expectedPageCount?: number,
): entries is readonly ZipPageEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    return false;
  }
  if (expectedPageCount !== undefined && entries.length !== expectedPageCount) {
    return false;
  }

  for (let i = 0; i < entries.length; i += 1) {
    if (!isValidZipPageEntry(entries[i], i)) {
      return false;
    }
  }

  return true;
}
