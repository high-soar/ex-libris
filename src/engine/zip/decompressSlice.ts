import type { ZipCompressionMethod } from "../types";

export interface DecompressZipSliceDeps {
  readonly createDecompressionStream?:
    ((format: "deflate-raw") => DecompressionStream) | null;
}

export async function decompressZipSlice(
  _compressedData: Uint8Array,
  _compressionMethod: ZipCompressionMethod,
  _deps: DecompressZipSliceDeps = {},
): Promise<Uint8Array> {
  void _compressedData;
  void _compressionMethod;
  void _deps;
  throw new Error("Not implemented");
}
