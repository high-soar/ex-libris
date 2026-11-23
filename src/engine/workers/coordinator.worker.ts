import * as Comlink from "comlink";
import { ENGINE_BUDGETS } from "../constants";
import type { CoordinatorWorkerApi, DecodeWorkerApi } from "../types";
import { CoordinatorCore } from "./CoordinatorCore";
import { DecodeWorkerPool, type DecodeWorkerHandle } from "./DecodeWorkerPool";
import { registerZipArchiveErrorTransferHandler } from "./comlinkErrorHandler";
import {
  prepareDecodeTransfer,
  transferDecodedFrames,
} from "./coordinatorTransfer";

registerZipArchiveErrorTransferHandler();

const workerHandles: DecodeWorkerHandle[] = Array.from(
  { length: ENGINE_BUDGETS.DECODE_WORKER_POOL_SIZE },
  () => {
    const worker = new Worker(new URL("./decode.worker.ts", import.meta.url), {
      type: "module",
    });
    const remote = Comlink.wrap<DecodeWorkerApi>(worker);
    return {
      api: {
        decodePageSlice(compressedData, compressionMethod) {
          const { data, transferables } = prepareDecodeTransfer(compressedData);
          return remote.decodePageSlice(
            Comlink.transfer(data, transferables),
            compressionMethod,
          );
        },
      },
      subscribeError: (listener) => {
        worker.addEventListener("error", listener);
        worker.addEventListener("messageerror", listener);
        return () => {
          worker.removeEventListener("error", listener);
          worker.removeEventListener("messageerror", listener);
        };
      },
      terminate: () => worker.terminate(),
    };
  },
);

const decodePool = new DecodeWorkerPool(workerHandles);
const core = new CoordinatorCore({ decodePool });

const api: CoordinatorWorkerApi = {
  openArchive: (source, cachedEntries, epoch) =>
    core.openArchive(source, cachedEntries, epoch),
  async requestVisiblePages(pageIndices, prefetchIndices, epoch, options) {
    const frames = await core.requestVisiblePages(
      pageIndices,
      prefetchIndices,
      epoch,
      options,
    );
    return transferDecodedFrames(frames);
  },
  updateAccessToken: (accessToken) => core.updateAccessToken(accessToken),
  setHostCallbacks: (callbacks) => core.setHostCallbacks(callbacks),
  cancelEpochBelow: (minActiveEpoch) => core.cancelEpochBelow(minActiveEpoch),
  closeArchive: () => core.closeArchive(),
};

Comlink.expose(api);
