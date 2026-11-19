import * as Comlink from "comlink";
import { ENGINE_BUDGETS } from "../constants";
import type {
  CoordinatorWorkerApi,
  DecodeWorkerApi,
  DecodedPageFrame,
} from "../types";
import { CoordinatorCore } from "./CoordinatorCore";
import { DecodeWorkerPool, type DecodeWorkerHandle } from "./DecodeWorkerPool";
import { registerZipArchiveErrorTransferHandler } from "./comlinkErrorHandler";

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
          const sliceCopy =
            compressedData.byteOffset === 0 &&
            compressedData.byteLength === compressedData.buffer.byteLength &&
            compressedData.buffer instanceof ArrayBuffer
              ? compressedData
              : compressedData.slice();
          return remote.decodePageSlice(
            Comlink.transfer(sliceCopy, [sliceCopy.buffer as ArrayBuffer]),
            compressionMethod,
          );
        },
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
  async requestVisiblePages(pageIndices, prefetchIndices, epoch) {
    const frames = await core.requestVisiblePages(
      pageIndices,
      prefetchIndices,
      epoch,
    );
    const transferables: Transferable[] = frames
      .filter(
        (frame): frame is Extract<DecodedPageFrame, { status: "ready" }> =>
          frame.status === "ready",
      )
      .map((frame) => frame.bitmap);
    return transferables.length > 0
      ? Comlink.transfer(frames, transferables)
      : frames;
  },
  updateAccessToken: (accessToken) => core.updateAccessToken(accessToken),
  cancelEpochBelow: (minActiveEpoch) => core.cancelEpochBelow(minActiveEpoch),
  closeArchive: () => core.closeArchive(),
};

Comlink.expose(api);
