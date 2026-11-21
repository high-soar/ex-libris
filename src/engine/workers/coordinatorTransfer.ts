import type { DecodedPageFrame } from "../types";

/**
 * Decode Worker への圧縮画像スライス転送ペイロード。
 */
export interface PreparedDecodeTransfer {
  readonly data: Uint8Array;
  readonly transferables: [ArrayBuffer];
}

export interface PrepareDecodeTransferOptions {
  readonly shared?: boolean;
}

export function markSharedBuffer(_buffer: ArrayBufferLike): void {
  // Red: Greenステップで実装
}

export function isSharedBuffer(_buffer: ArrayBufferLike): boolean {
  return false;
}

/**
 * 圧縮画像スライスを Decode Worker へ Zero-Copy 転送するための `Transferable` を準備する。
 */
export function prepareDecodeTransfer(
  compressedData: Uint8Array,
  _options?: PrepareDecodeTransferOptions,
): PreparedDecodeTransfer {
  if (
    compressedData.byteOffset === 0 &&
    compressedData.byteLength === compressedData.buffer.byteLength &&
    compressedData.buffer instanceof ArrayBuffer
  ) {
    return {
      data: compressedData,
      transferables: [compressedData.buffer],
    };
  }

  const copied = compressedData.slice();
  return {
    data: copied,
    transferables: [copied.buffer],
  };
}

/**
 * `DecodedPageFrame` 配列から `status === "ready"` フレームの `bitmap` のみを
 * `Comlink.transfer` 用の `Transferable[]` として抽出する。
 */
export function collectFrameTransferables(
  frames: readonly DecodedPageFrame[],
): Transferable[] {
  return frames
    .filter(
      (frame): frame is Extract<DecodedPageFrame, { status: "ready" }> =>
        frame.status === "ready",
    )
    .map((frame) => frame.bitmap);
}
