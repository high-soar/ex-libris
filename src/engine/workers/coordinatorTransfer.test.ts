import { describe, expect, it, vi } from "vitest";
import type { DecodedPageFrame } from "../types";
import {
  collectFrameTransferables,
  prepareDecodeTransfer,
} from "./coordinatorTransfer";

function createFakeBitmap(width = 800, height = 1200): ImageBitmap {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

describe("coordinatorTransfer", () => {
  it("単独所有のArrayBuffer全体を指すUint8ArrayはコピーせずZero-CopyでTransferableを返すこと (AC-ENG-06, AC-ENG-08)", () => {
    const standalone = new Uint8Array([10, 20, 30, 40]);

    const prepared = prepareDecodeTransfer(standalone);

    expect(prepared.data).toBe(standalone);
    expect(prepared.transferables).toEqual([standalone.buffer]);
    expect(prepared.transferables[0]).toBe(standalone.buffer);
  });

  it("byteOffset>0または部分長subarrayの場合は元バッファを保護するためsliceコピーしてTransferableを返すこと (AC-ENG-06, AC-ENG-08)", () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6]);

    // 1. byteOffset > 0 かつ末尾まで
    const offsetSlice = backing.subarray(2);
    const preparedOffset = prepareDecodeTransfer(offsetSlice);
    expect(preparedOffset.data).not.toBe(offsetSlice);
    expect(preparedOffset.data.buffer).not.toBe(backing.buffer);
    expect(preparedOffset.data).toEqual(new Uint8Array([3, 4, 5, 6]));
    expect(preparedOffset.transferables).toEqual([preparedOffset.data.buffer]);

    // 2. byteOffset === 0 かつ byteLength < buffer.byteLength
    const headSlice = backing.subarray(0, 3);
    const preparedHead = prepareDecodeTransfer(headSlice);
    expect(preparedHead.data).not.toBe(headSlice);
    expect(preparedHead.data.buffer).not.toBe(backing.buffer);
    expect(preparedHead.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(preparedHead.transferables).toEqual([preparedHead.data.buffer]);
  });

  it("SharedArrayBuffer由来のUint8Arrayは全体ビューでも新規ArrayBufferへコピーしてTransferableを返すこと (AC-ENG-06, AC-ENG-08)", () => {
    const sab = new SharedArrayBuffer(4);
    const sharedView = new Uint8Array(sab);
    sharedView.set([7, 8, 9, 10]);

    const prepared = prepareDecodeTransfer(sharedView);

    expect(prepared.data).not.toBe(sharedView);
    expect(prepared.data.buffer).toBeInstanceOf(ArrayBuffer);
    expect(prepared.data.buffer).not.toBe(sab);
    expect(prepared.data).toEqual(new Uint8Array([7, 8, 9, 10]));
    expect(prepared.transferables).toEqual([prepared.data.buffer]);
  });

  it("DecodedPageFrame配列からreadyフレームのbitmapのみをTransferable配列として抽出すること (AC-ENG-08)", () => {
    const bitmap0 = createFakeBitmap(100, 200);
    const bitmap2 = createFakeBitmap(300, 400);

    const mixedFrames: DecodedPageFrame[] = [
      {
        status: "ready",
        pageIndex: 0,
        epoch: 1,
        width: 100,
        height: 200,
        bitmap: bitmap0,
      },
      {
        status: "error",
        pageIndex: 1,
        epoch: 1,
        errorCode: "DECODE_FAILED",
        message: "デコード失敗",
      },
      {
        status: "ready",
        pageIndex: 2,
        epoch: 1,
        width: 300,
        height: 400,
        bitmap: bitmap2,
      },
    ];

    expect(collectFrameTransferables(mixedFrames)).toEqual([bitmap0, bitmap2]);

    const errorOnlyFrames: DecodedPageFrame[] = [
      {
        status: "error",
        pageIndex: 0,
        epoch: 1,
        errorCode: "CORRUPT_ZIP",
        message: "破損ページ",
      },
    ];
    expect(collectFrameTransferables(errorOnlyFrames)).toEqual([]);
    expect(collectFrameTransferables([])).toEqual([]);
  });
});
