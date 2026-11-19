import type { DecodeWorkerApi, ZipCompressionMethod } from "../types";

export interface DecodeWorkerDeps {
  readonly createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
  readonly createDecompressionStream?:
    ((format: "deflate-raw") => DecompressionStream) | null;
}

export class DecodeWorkerCore implements DecodeWorkerApi {
  constructor(deps: DecodeWorkerDeps = {}) {
    void deps;
  }

  async decodePageSlice(
    compressedData: Uint8Array,
    compressionMethod: ZipCompressionMethod,
  ): Promise<{
    bitmap: ImageBitmap;
    width: number;
    height: number;
  }> {
    void compressedData;
    void compressionMethod;
    throw new Error("Not implemented");
  }
}
