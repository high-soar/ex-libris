import type { ZipPageEntry } from "../types";

export function validateZipIndexEntries(
  _entries: unknown,
  _expectedPageCount?: number,
): _entries is readonly ZipPageEntry[] {
  return false;
}
