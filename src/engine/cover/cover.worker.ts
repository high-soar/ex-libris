import * as Comlink from "comlink";
import { registerZipArchiveErrorTransferHandler } from "../workers/comlinkErrorHandler";
import { CoverResizeWorkerCore } from "./CoverResizeWorkerCore";
import type { CoverResizeWorkerApi } from "./types";

registerZipArchiveErrorTransferHandler();

const core = new CoverResizeWorkerCore();

const api: CoverResizeWorkerApi = {
  encodeCoverWebp(compressedData, compressionMethod, options) {
    return core.encodeCoverWebp(compressedData, compressionMethod, options);
  },
};

Comlink.expose(api);
