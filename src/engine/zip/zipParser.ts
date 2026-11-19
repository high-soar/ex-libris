import type { RandomAccessReader, ZipPageEntry } from "../types";

export async function parseZipDirectory(
  reader: RandomAccessReader,
  signal?: AbortSignal,
): Promise<ZipPageEntry[]> {
  void reader;
  void signal;
  throw new Error("Not implemented");
}

export async function readCompressedPageSlice(
  reader: RandomAccessReader,
  entry: ZipPageEntry,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  void reader;
  void entry;
  void signal;
  throw new Error("Not implemented");
}
