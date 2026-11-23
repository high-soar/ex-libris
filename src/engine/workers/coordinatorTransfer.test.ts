import * as Comlink from "comlink";
import { describe, expect, it, vi } from "vitest";
import type { DecodedPageFrame } from "../types";
import {
  collectFrameTransferables,
  isSharedBuffer,
  markSharedBuffer,
  prepareDecodeTransfer,
  transferDecodedFrames,
} from "./coordinatorTransfer";

function createFakeBitmap(width = 800, height = 1200): ImageBitmap {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

describe("coordinatorTransfer", () => {
  it("単独所有のArrayBuffer全体を指すUint8ArrayはコピーせずZero-CopyでTransferableを返しstructuredCloneで元バッファがデタッチされること (AC-ENG-14, AC-ENG-08)", () => {
    const standalone = new Uint8Array([10, 20, 30, 40]);

    const prepared = prepareDecodeTransfer(standalone, { shared: false });

    expect(prepared.data).toBe(standalone);
    expect(prepared.transferables).toEqual([standalone.buffer]);
    expect(prepared.transferables[0]).toBe(standalone.buffer);

    const cloned = structuredClone(prepared.data, {
      transfer: prepared.transferables,
    });
    expect(Array.from(cloned)).toEqual([10, 20, 30, 40]);
    expect(standalone.byteLength).toBe(0);
  });

  it("markSharedBufferで印付けされたArrayBufferおよびoptions.shared=trueは全体ビューでも複製しstructuredClone後も元バッファをデタッチ破壊しないこと (AC-ENG-14)", () => {
    const cached = new Uint8Array([11, 22, 33, 44]);
    expect(isSharedBuffer(cached.buffer)).toBe(false);

    markSharedBuffer(cached.buffer);
    expect(isSharedBuffer(cached.buffer)).toBe(true);

    const preparedFromMarked = prepareDecodeTransfer(cached);
    expect(preparedFromMarked.data).not.toBe(cached);
    expect(preparedFromMarked.data.buffer).not.toBe(cached.buffer);
    expect(preparedFromMarked.transferables).toEqual([
      preparedFromMarked.data.buffer,
    ]);

    const clonedMarked = structuredClone(preparedFromMarked.data, {
      transfer: preparedFromMarked.transferables,
    });
    expect(Array.from(clonedMarked)).toEqual([11, 22, 33, 44]);
    expect(cached.byteLength).toBe(4);
    expect(cached).toEqual(new Uint8Array([11, 22, 33, 44]));

    const explicitShared = new Uint8Array([55, 66, 77, 88]);
    expect(isSharedBuffer(explicitShared.buffer)).toBe(false);

    const preparedFromOption = prepareDecodeTransfer(explicitShared, {
      shared: true,
    });
    expect(preparedFromOption.data).not.toBe(explicitShared);
    expect(preparedFromOption.data.buffer).not.toBe(explicitShared.buffer);

    const clonedExplicit = structuredClone(preparedFromOption.data, {
      transfer: preparedFromOption.transferables,
    });
    expect(Array.from(clonedExplicit)).toEqual([55, 66, 77, 88]);
    expect(explicitShared.byteLength).toBe(4);
    expect(explicitShared).toEqual(new Uint8Array([55, 66, 77, 88]));
  });

  it("SharedArrayBufferに対してmarkSharedBuffer・isSharedBufferが安全に動作すること (AC-ENG-14)", () => {
    const sab = new SharedArrayBuffer(4);
    markSharedBuffer(sab);
    expect(isSharedBuffer(sab)).toBe(false);
  });

  it("byteOffset>0または部分長subarrayの場合は元バッファを保護するためsliceコピーしてTransferableを返すこと (AC-ENG-14, AC-ENG-08)", () => {
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

  it("SharedArrayBuffer由来のUint8Arrayは全体ビューでも新規ArrayBufferへコピーしてTransferableを返すこと (AC-ENG-14, AC-ENG-08)", () => {
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

  it("transferDecodedFramesがreadyビットマップ有無に応じてtransfer呼び出し有無を分岐しデフォルトComlink.transferでも実動作すること (AC-ENG-14, AC-ENG-08)", async () => {
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
    const errorOnlyFrames: DecodedPageFrame[] = [
      {
        status: "error",
        pageIndex: 0,
        epoch: 1,
        errorCode: "CORRUPT_ZIP",
        message: "破損ページ",
      },
    ];
    const emptyFrames: DecodedPageFrame[] = [];

    const transferSpy = vi.fn((frames: DecodedPageFrame[]) => frames);

    expect(transferDecodedFrames(mixedFrames, transferSpy)).toBe(mixedFrames);
    expect(transferSpy).toHaveBeenCalledTimes(1);
    expect(transferSpy).toHaveBeenCalledWith(mixedFrames, [bitmap0, bitmap2]);

    transferSpy.mockClear();
    expect(transferDecodedFrames(errorOnlyFrames, transferSpy)).toBe(
      errorOnlyFrames,
    );
    expect(transferDecodedFrames(emptyFrames, transferSpy)).toBe(emptyFrames);
    expect(transferSpy).not.toHaveBeenCalled();

    // デフォルト引数(Comlink.transfer)で Comlink.expose の postMessage へ Transferable が渡されること
    const workerBus = new EventTarget();
    const clientBus = new EventTarget();
    const sentTransfers: Transferable[][] = [];

    const serverEndpoint: Comlink.Endpoint = {
      postMessage(message, transfer = []) {
        sentTransfers.push([...transfer]);
        clientBus.dispatchEvent(new MessageEvent("message", { data: message }));
      },
      addEventListener: workerBus.addEventListener.bind(workerBus),
      removeEventListener: workerBus.removeEventListener.bind(workerBus),
    };
    const clientEndpoint: Comlink.Endpoint = {
      postMessage(message) {
        workerBus.dispatchEvent(new MessageEvent("message", { data: message }));
      },
      addEventListener: clientBus.addEventListener.bind(clientBus),
      removeEventListener: clientBus.removeEventListener.bind(clientBus),
    };

    const exposedApi = {
      getMixed: () => transferDecodedFrames(mixedFrames),
      getErrorOnly: () => transferDecodedFrames(errorOnlyFrames),
    };
    Comlink.expose(exposedApi, serverEndpoint);
    const remote = Comlink.wrap<typeof exposedApi>(clientEndpoint);

    const receivedMixed = await remote.getMixed();
    expect(receivedMixed).toBe(mixedFrames);
    expect(sentTransfers[0]).toEqual([bitmap0, bitmap2]);

    const receivedErrorOnly = await remote.getErrorOnly();
    expect(receivedErrorOnly).toBe(errorOnlyFrames);
    expect(sentTransfers[1]).toEqual([]);

    remote[Comlink.releaseProxy]();
  });
});
