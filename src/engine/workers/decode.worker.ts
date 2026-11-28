import * as Comlink from "comlink";
import type { DecodeWorkerApi, ZipCompressionMethod } from "../types";
import { DecodeWorkerCore } from "./DecodeWorkerCore";
import { registerZipArchiveErrorTransferHandler } from "./comlinkErrorHandler";

registerZipArchiveErrorTransferHandler();

const core = new DecodeWorkerCore();

const api: DecodeWorkerApi = {
  async decodePageSlice(
    compressedData: Uint8Array,
    compressionMethod: ZipCompressionMethod,
    expectedUncompressedSize?: number,
  ) {
    const result = await core.decodePageSlice(
      compressedData,
      compressionMethod,
      expectedUncompressedSize,
    );
    return Comlink.transfer(result, [result.bitmap]);
  },
};

Comlink.expose(api);
