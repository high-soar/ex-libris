import { deflateSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZipArchiveError } from "../zip/errors";
import {
  CoverResizeWorkerCore,
  type CoverCanvas2DContextLike,
  type CoverOffscreenCanvasLike,
} from "./CoverResizeWorkerCore";

function createFakeBitmap(width: number, height: number) {
  const close = vi.fn();
  const bitmap = {
    width,
    height,
    close,
  } as unknown as ImageBitmap;
  return { bitmap, close };
}

function createFakeCanvas(
  blob: Blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
) {
  const drawImage = vi.fn();
  const ctx: CoverCanvas2DContextLike = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    drawImage,
  };
  const convertToBlob = vi.fn(async () => blob);
  const canvas: CoverOffscreenCanvasLike = {
    getContext: vi.fn(() => ctx),
    convertToBlob,
  };
  return { canvas, ctx, drawImage, convertToBlob };
}

describe("CoverResizeWorkerCore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("高解像度画像(縦長・横長)を長辺上限350pxへ縮小してWebP(quality:0.8)に変換し即座にbitmap.close()すること (AC-COV-01)", async () => {
    const rawImage = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const deflated = deflateSync(rawImage);

    // 1. 縦長 1400x2100 -> 233x350 (Deflate)
    const portrait = createFakeBitmap(1400, 2100);
    const portraitWebp = new Blob([new Uint8Array([10, 20, 30])], {
      type: "image/webp",
    });
    const portraitCanvas = createFakeCanvas(portraitWebp);
    const createCanvasSpy = vi.fn(() => portraitCanvas.canvas);

    const core1 = new CoverResizeWorkerCore({
      createImageBitmap: vi.fn(async (blob) => {
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(rawImage);
        return portrait.bitmap;
      }),
      createOffscreenCanvas: createCanvasSpy,
      createDecompressionStream: null,
    });

    const result1 = await core1.encodeCoverWebp(deflated, 8);
    expect(result1).toEqual({
      blob: portraitWebp,
      width: 233,
      height: 350,
    });
    expect(createCanvasSpy).toHaveBeenCalledWith(233, 350);
    expect(portraitCanvas.ctx.imageSmoothingEnabled).toBe(true);
    expect(portraitCanvas.ctx.imageSmoothingQuality).toBe("high");
    expect(portraitCanvas.drawImage).toHaveBeenCalledWith(
      portrait.bitmap,
      0,
      0,
      233,
      350,
    );
    expect(portraitCanvas.convertToBlob).toHaveBeenCalledWith({
      type: "image/webp",
      quality: 0.8,
    });
    expect(portrait.close).toHaveBeenCalledTimes(1);

    // 2. 横長 1000x500 -> 350x175 (Store + 明示オプション)
    const landscape = createFakeBitmap(1000, 500);
    const landscapeCanvas = createFakeCanvas();
    const core2 = new CoverResizeWorkerCore({
      createImageBitmap: vi.fn(async () => landscape.bitmap),
      createOffscreenCanvas: vi.fn(() => landscapeCanvas.canvas),
    });

    const result2 = await core2.encodeCoverWebp(rawImage, 0, {
      maxLongEdgePx: 200,
      webpQuality: 0.75,
    });
    expect(result2.width).toBe(200);
    expect(result2.height).toBe(100);
    expect(landscapeCanvas.convertToBlob).toHaveBeenCalledWith({
      type: "image/webp",
      quality: 0.75,
    });
    expect(landscape.close).toHaveBeenCalledTimes(1);
  });

  it("長辺が350px以下の短小画像は拡大せず等倍寸法を維持すること (AC-COV-01)", async () => {
    const small = createFakeBitmap(240, 320);
    const smallCanvas = createFakeCanvas();
    const createCanvasSpy = vi.fn(() => smallCanvas.canvas);

    const core = new CoverResizeWorkerCore({
      createImageBitmap: vi.fn(async () => small.bitmap),
      createOffscreenCanvas: createCanvasSpy,
    });

    const result = await core.encodeCoverWebp(new Uint8Array([1, 2, 3]), 0);
    expect(result.width).toBe(240);
    expect(result.height).toBe(320);
    expect(createCanvasSpy).toHaveBeenCalledWith(240, 320);
    expect(small.close).toHaveBeenCalledTimes(1);

    // 極端なアスペクト比でも最小 1px を維持すること
    const thin = createFakeBitmap(10_000, 1);
    const thinCanvas = createFakeCanvas();
    const coreThin = new CoverResizeWorkerCore({
      createImageBitmap: vi.fn(async () => thin.bitmap),
      createOffscreenCanvas: vi.fn(() => thinCanvas.canvas),
    });
    const thinResult = await coreThin.encodeCoverWebp(new Uint8Array([1]), 0);
    expect(thinResult.width).toBe(350);
    expect(thinResult.height).toBe(1);
    expect(thin.close).toHaveBeenCalledTimes(1);
  });

  it("デフォルト依存でglobalThis.createImageBitmapとOffscreenCanvasを使用すること (AC-COV-01)", async () => {
    const fakeBitmap = createFakeBitmap(100, 200);
    const fakeWebp = new Blob([new Uint8Array([7, 8])], { type: "image/webp" });
    const fakeCanvas = createFakeCanvas(fakeWebp);

    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => fakeBitmap.bitmap),
    );
    class MockOffscreenCanvas {
      readonly width: number;
      readonly height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(id: "2d") {
        return fakeCanvas.canvas.getContext(id);
      }
      convertToBlob(options?: ImageEncodeOptions) {
        return fakeCanvas.canvas.convertToBlob(options);
      }
    }
    vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);

    const core = new CoverResizeWorkerCore();
    const result = await core.encodeCoverWebp(new Uint8Array([1, 2]), 0);
    expect(result).toEqual({ blob: fakeWebp, width: 100, height: 200 });
    expect(fakeBitmap.close).toHaveBeenCalledTimes(1);
  });

  it("不正寸法・2Dコンテキスト未取得・描画例外・0バイトWebP・伸長失敗時は必ずbitmap.close()を実行しDECODE_FAILEDを送出すること (AC-COV-01)", async () => {
    // 1. 不正寸法 (0 / NaN)
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [Number.NaN, 100],
      [100, Number.POSITIVE_INFINITY],
    ]) {
      const badBitmap = createFakeBitmap(w, h);
      const core = new CoverResizeWorkerCore({
        createImageBitmap: vi.fn(async () => badBitmap.bitmap),
        createOffscreenCanvas: vi.fn(() => createFakeCanvas().canvas),
      });
      await expect(
        core.encodeCoverWebp(new Uint8Array([1]), 0),
      ).rejects.toMatchObject({
        name: "ZipArchiveError",
        code: "DECODE_FAILED",
      });
      expect(badBitmap.close).toHaveBeenCalledTimes(1);
    }

    // 2. 2D コンテキスト取得失敗 (null)
    const noCtxBitmap = createFakeBitmap(200, 200);
    const coreNoCtx = new CoverResizeWorkerCore({
      createImageBitmap: vi.fn(async () => noCtxBitmap.bitmap),
      createOffscreenCanvas: vi.fn(() => ({
        getContext: () => null,
        convertToBlob: vi.fn(),
      })),
    });
    await expect(
      coreNoCtx.encodeCoverWebp(new Uint8Array([1]), 0),
    ).rejects.toMatchObject({
      code: "DECODE_FAILED",
    });
    expect(noCtxBitmap.close).toHaveBeenCalledTimes(1);

    // 3. convertToBlob が 0 バイト Blob を返した場合
    const emptyBlobBitmap = createFakeBitmap(200, 200);
    const emptyCanvas = createFakeCanvas(new Blob([], { type: "image/webp" }));
    const coreEmptyBlob = new CoverResizeWorkerCore({
      createImageBitmap: vi.fn(async () => emptyBlobBitmap.bitmap),
      createOffscreenCanvas: vi.fn(() => emptyCanvas.canvas),
    });
    await expect(
      coreEmptyBlob.encodeCoverWebp(new Uint8Array([1]), 0),
    ).rejects.toMatchObject({
      code: "DECODE_FAILED",
    });
    expect(emptyBlobBitmap.close).toHaveBeenCalledTimes(1);

    // 4. convertToBlob が例外を投げた場合も bitmap.close() が呼ばれること
    const throwBitmap = createFakeBitmap(200, 200);
    const throwCanvas = createFakeCanvas();
    throwCanvas.convertToBlob.mockRejectedValueOnce(new Error("encode failed"));
    const coreThrow = new CoverResizeWorkerCore({
      createImageBitmap: vi.fn(async () => throwBitmap.bitmap),
      createOffscreenCanvas: vi.fn(() => throwCanvas.canvas),
    });
    await expect(
      coreThrow.encodeCoverWebp(new Uint8Array([1]), 0),
    ).rejects.toBeInstanceOf(ZipArchiveError);
    expect(throwBitmap.close).toHaveBeenCalledTimes(1);

    // 5. 伸長失敗時 (破損 Deflate)
    const coreCorrupt = new CoverResizeWorkerCore({
      createImageBitmap: vi.fn(),
      createOffscreenCanvas: vi.fn(),
      createDecompressionStream: null,
    });
    await expect(
      coreCorrupt.encodeCoverWebp(new Uint8Array([0xff, 0xff, 0xff]), 8),
    ).rejects.toMatchObject({
      code: "DECODE_FAILED",
    });

    // 6. expectedUncompressedSize を超過する Zip Bomb 相当の圧縮データ
    const bombPayload = new Uint8Array(16_384).fill(0x33);
    const deflatedBomb = deflateSync(bombPayload);
    const decodeSpy = vi.fn();
    const coreBomb = new CoverResizeWorkerCore({
      createImageBitmap: decodeSpy,
      createOffscreenCanvas: vi.fn(),
      createDecompressionStream: null,
    });
    await expect(
      coreBomb.encodeCoverWebp(deflatedBomb, 8, {
        expectedUncompressedSize: 512,
      }),
    ).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "DECODE_FAILED",
    });
    expect(decodeSpy).not.toHaveBeenCalled();
  });
});
