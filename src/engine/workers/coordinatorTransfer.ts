import type { DecodedPageFrame } from "../types";

export interface PreparedDecodeTransfer {
  readonly data: Uint8Array;
  readonly transferables: [ArrayBuffer];
}

export function prepareDecodeTransfer(
  compressedData: Uint8Array,
): PreparedDecodeTransfer {
  void compressedData;
  throw new Error("Not implemented");
}

export function collectFrameTransferables(
  frames: readonly DecodedPageFrame[],
): Transferable[] {
  void frames;
  throw new Error("Not implemented");
}
