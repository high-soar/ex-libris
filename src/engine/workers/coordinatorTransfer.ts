import type { DecodedPageFrame } from "../types";

/**
 * Decode Worker への圧縮画像スライス転送ペイロード。
 */
export interface PreparedDecodeTransfer {
  readonly data: Uint8Array;
  readonly transferables: [ArrayBuffer];
}

/**
 * 圧縮画像スライスを Decode Worker へ Zero-Copy 転送するための `Transferable` を準備する。
 *
 * `byteOffset === 0 && byteLength === buffer.byteLength && buffer instanceof ArrayBuffer` の場合は
 * 元 `ArrayBuffer` をそのまま `Comlink.transfer` 対象としてデタッチするため、
 * 将来 `v0.1` で `L2ByteCache` 等の共有キャッシュ由来スライスを渡す際は
 * 事前にコピー（または共有フラグ導入）して元キャッシュを破壊しないこと。
 */
export function prepareDecodeTransfer(
  compressedData: Uint8Array,
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
