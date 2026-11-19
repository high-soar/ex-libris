import type { DecodeWorkerApi, ZipCompressionMethod } from "../types";

export interface DecodeWorkerHandle {
  readonly api: DecodeWorkerApi;
  readonly terminate?: () => void;
}

export class DecodeWorkerPool implements DecodeWorkerApi {
  constructor(handles: readonly DecodeWorkerHandle[]) {
    void handles;
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

  dispose(): void {
    throw new Error("Not implemented");
  }
}
