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

  private drainSlotPending(slot: WorkerSlot, error: ZipArchiveError): void {
    slot.activeCount = 0;
    this.cleanupSlotSubscription(slot);
    for (const rejectPending of [...slot.pendingRejects]) {
      rejectPending(error);
    }
    slot.pendingRejects.clear();
  }

  private handleSlotError(slot: WorkerSlot): void {
    if (this.disposed || slot.broken) {
      return;
    }
    slot.broken = true;
    this.drainSlotPending(
      slot,
      new ZipArchiveError("DECODE_FAILED", "Decode Workerが異常終了しました"),
    );
  }

  private selectHealthySlot(): WorkerSlot | null {
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
      return null;
    }

    this.nextIndex = (chosenIndex + 1) % this.slots.length;
    return this.slots[chosenIndex];
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

    const slot = this.selectHealthySlot();
    if (slot === null) {
      return Promise.reject(
        new ZipArchiveError(
          "DECODE_FAILED",
          "利用可能なDecode Workerが存在しません",
        ),
      );
    }

    slot.activeCount += 1;

    return new Promise<DecodeSliceResult>((resolve, reject) => {
      let settled = false;
      const rejectPending = (error: ZipArchiveError) => {
        settled = true;
        slot.pendingRejects.delete(rejectPending);
        reject(error);
      };
      const settleFromWorker = (done: () => void) => {
        if (!settled) {
          settled = true;
          slot.pendingRejects.delete(rejectPending);
          slot.activeCount -= 1;
          done();
        }
      };

      slot.pendingRejects.add(rejectPending);

      let rpcPromise: Promise<DecodeSliceResult>;
      try {
        rpcPromise = slot.handle.api.decodePageSlice(
          compressedData,
          compressionMethod,
        );
      } catch (syncError) {
        settleFromWorker(() => reject(syncError));
        return;
      }

      rpcPromise.then(
        (result) => settleFromWorker(() => resolve(result)),
        (error) => settleFromWorker(() => reject(error)),
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
      this.drainSlotPending(slot, disposedError);
      slot.handle.terminate?.();
    }
  }
}
