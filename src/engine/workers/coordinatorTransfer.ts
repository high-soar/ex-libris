import * as Comlink from "comlink";
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

const sharedBuffers = new WeakSet<ArrayBuffer>();

export function markSharedBuffer(buffer: ArrayBufferLike): void {
  if (buffer instanceof ArrayBuffer) {
    sharedBuffers.add(buffer);
  }
}

export function isSharedBuffer(buffer: ArrayBufferLike): boolean {
  return buffer instanceof ArrayBuffer && sharedBuffers.has(buffer);
}

/**
 * 圧縮画像スライスを Decode Worker へ Zero-Copy 転送するための `Transferable` を準備する。
 *
 * `options?.shared === true` または `isSharedBuffer(compressedData.buffer) === true` の場合、
 * あるいは部分ビュー・非 `ArrayBuffer` の場合は元バッファのデタッチ破壊を防ぐため
 * `slice()` で独立 `ArrayBuffer` を複製して返す。
 */
export function prepareDecodeTransfer(
  compressedData: Uint8Array,
  options?: PrepareDecodeTransferOptions,
): PreparedDecodeTransfer {
  const isShared =
    options?.shared === true || isSharedBuffer(compressedData.buffer);
  if (
    !isShared &&
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

export function transferDecodedFrames<T extends readonly DecodedPageFrame[]>(
  frames: T,
  transfer: (obj: T, transfers: Transferable[]) => T = Comlink.transfer,
): T {
  const transferables = collectFrameTransferables(frames);
  return transferables.length > 0 ? transfer(frames, transferables) : frames;
}
