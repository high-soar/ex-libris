import type { DecodeWorkerApi, ZipCompressionMethod } from "../types";
import { ZipArchiveError } from "../zip/errors";

export interface DecodeWorkerHandle {
  readonly api: DecodeWorkerApi;
  readonly terminate?: () => void;
  readonly subscribeError?: (listener: (event: unknown) => void) => () => void;
}

interface DecodeSliceResult {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

interface WorkerSlot {
  readonly handle: DecodeWorkerHandle;
  activeCount: number;
  broken: boolean;
  unsubscribeError?: () => void;
  readonly pendingRejects: Set<(error: ZipArchiveError) => void>;
}

export class DecodeWorkerPool implements DecodeWorkerApi {
  private readonly slots: WorkerSlot[];
  private nextIndex = 0;
  private disposed = false;

  constructor(handles: readonly DecodeWorkerHandle[]) {
    if (handles.length === 0) {
      throw new Error("DecodeWorkerPool requires at least one worker handle");
    }
    this.slots = handles.map((handle) => {
      const slot: WorkerSlot = {
        handle,
        activeCount: 0,
        broken: false,
        pendingRejects: new Set(),
      };
      if (handle.subscribeError) {
        slot.unsubscribeError = handle.subscribeError(() => {
          this.handleSlotError(slot);
        });
      }
      return slot;
    });
  }

  private cleanupSlotSubscription(slot: WorkerSlot): void {
    const unsubscribe = slot.unsubscribeError;
    if (unsubscribe) {
      slot.unsubscribeError = undefined;
      unsubscribe();
    }
  }

  private handleSlotError(slot: WorkerSlot): void {
    if (this.disposed || slot.broken) {
      return;
    }
    slot.broken = true;
    slot.activeCount = 0;
    this.cleanupSlotSubscription(slot);
    const error = new ZipArchiveError(
      "DECODE_FAILED",
      "Decode Workerが異常終了しました",
    );
    for (const rejectPending of [...slot.pendingRejects]) {
      rejectPending(error);
    }
    slot.pendingRejects.clear();
  }

  decodePageSlice(
    compressedData: Uint8Array,
    compressionMethod: ZipCompressionMethod,
  ): Promise<DecodeSliceResult> {
    if (this.disposed) {
      return Promise.reject(
        new ZipArchiveError(
          "DECODE_FAILED",
          "DecodeWorkerPoolは破棄されています",
        ),
      );
    }

    let chosenIndex = -1;
    let lowestActive = Number.POSITIVE_INFINITY;
    for (let offset = 0; offset < this.slots.length; offset += 1) {
      const candidateIndex = (this.nextIndex + offset) % this.slots.length;
      const candidate = this.slots[candidateIndex];
      if (candidate.broken) {
        continue;
      }
      if (candidate.activeCount < lowestActive) {
        chosenIndex = candidateIndex;
        lowestActive = candidate.activeCount;
      }
    }

    if (chosenIndex < 0) {
      return Promise.reject(
        new ZipArchiveError(
          "DECODE_FAILED",
          "利用可能なDecode Workerが存在しません",
        ),
      );
    }

    this.nextIndex = (chosenIndex + 1) % this.slots.length;
    const slot = this.slots[chosenIndex];
    slot.activeCount += 1;

    return new Promise<DecodeSliceResult>((resolve, reject) => {
      let settled = false;
      const rejectPending = (error: ZipArchiveError) => {
        settled = true;
        slot.pendingRejects.delete(rejectPending);
        reject(error);
      };
      slot.pendingRejects.add(rejectPending);

      let rpcPromise: Promise<DecodeSliceResult>;
      try {
        rpcPromise = slot.handle.api.decodePageSlice(
          compressedData,
          compressionMethod,
        );
      } catch (syncError) {
        settled = true;
        slot.pendingRejects.delete(rejectPending);
        slot.activeCount -= 1;
        reject(syncError);
        return;
      }

      rpcPromise.then(
        (result) => {
          if (!settled) {
            settled = true;
            slot.pendingRejects.delete(rejectPending);
            slot.activeCount -= 1;
            resolve(result);
          }
        },
        (error) => {
          if (!settled) {
            settled = true;
            slot.pendingRejects.delete(rejectPending);
            slot.activeCount -= 1;
            reject(error);
          }
        },
      );
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const disposedError = new ZipArchiveError(
      "DECODE_FAILED",
      "DecodeWorkerPoolは破棄されています",
    );
    for (const slot of this.slots) {
      this.cleanupSlotSubscription(slot);
      slot.activeCount = 0;
      for (const rejectPending of [...slot.pendingRejects]) {
        rejectPending(disposedError);
      }
      slot.pendingRejects.clear();
      slot.handle.terminate?.();
    }
  }
}
