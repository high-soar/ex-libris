import type { DecodeWorkerApi, ZipCompressionMethod } from "../types";
import { ZipArchiveError } from "../zip/errors";

export interface DecodeWorkerHandle {
  readonly api: DecodeWorkerApi;
  readonly terminate?: () => void;
}

interface WorkerSlot {
  readonly handle: DecodeWorkerHandle;
  activeCount: number;
}

export class DecodeWorkerPool implements DecodeWorkerApi {
  private readonly slots: WorkerSlot[];
  private nextIndex = 0;
  private disposed = false;

  constructor(handles: readonly DecodeWorkerHandle[]) {
    if (handles.length === 0) {
      throw new Error("DecodeWorkerPool requires at least one worker handle");
    }
    this.slots = handles.map((handle) => ({
      handle,
      activeCount: 0,
    }));
  }

  async decodePageSlice(
    compressedData: Uint8Array,
    compressionMethod: ZipCompressionMethod,
  ): Promise<{
    bitmap: ImageBitmap;
    width: number;
    height: number;
  }> {
    if (this.disposed) {
      throw new ZipArchiveError(
        "DECODE_FAILED",
        "DecodeWorkerPoolは破棄されています",
      );
    }

    let chosenIndex = this.nextIndex;
    let lowestActive = this.slots[chosenIndex].activeCount;
    for (let offset = 1; offset < this.slots.length; offset += 1) {
      const candidateIndex = (this.nextIndex + offset) % this.slots.length;
      const candidateActive = this.slots[candidateIndex].activeCount;
      if (candidateActive < lowestActive) {
        chosenIndex = candidateIndex;
        lowestActive = candidateActive;
      }
    }

    this.nextIndex = (chosenIndex + 1) % this.slots.length;
    const slot = this.slots[chosenIndex];
    slot.activeCount += 1;

    try {
      return await slot.handle.api.decodePageSlice(
        compressedData,
        compressionMethod,
      );
    } finally {
      slot.activeCount -= 1;
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const slot of this.slots) {
      slot.handle.terminate?.();
    }
  }
}
