import { deflateSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZipArchiveError } from "../zip/errors";
import { DecodeWorkerCore } from "./DecodeWorkerCore";

function createFakeBitmap(width = 800, height = 1200): ImageBitmap {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

describe("DecodeWorkerCore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Store(0)圧縮データをそのままBlob化してImageBitmapへデコードできること (AC-ENG-06)", async () => {
    const rawImage = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const fakeBitmap = createFakeBitmap(1024, 1536);
    const decodeSpy = vi.fn(async (blob: Blob) => {
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(rawImage);
      return fakeBitmap;
    });

    const core = new DecodeWorkerCore({ createImageBitmap: decodeSpy });
    const result = await core.decodePageSlice(rawImage, 0);

    expect(decodeSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      bitmap: fakeBitmap,
      width: 1024,
      height: 1536,
    });
  });

  it("Deflate(8)をDecompressionStream('deflate-raw')優先で伸長してデコードできること (AC-ENG-06)", async () => {
    const rawImage = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const deflated = deflateSync(rawImage);
    const fakeBitmap = createFakeBitmap(640, 960);

    const decodeSpy = vi.fn(async (blob: Blob) => {
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(rawImage);
      return fakeBitmap;
    });
    const streamSpy = vi.fn(
      (format: "deflate-raw") => new DecompressionStream(format),
    );

    const core = new DecodeWorkerCore({
      createImageBitmap: decodeSpy,
      createDecompressionStream: streamSpy,
    });
    const result = await core.decodePageSlice(deflated, 8);

    expect(streamSpy).toHaveBeenCalledWith("deflate-raw");
    expect(result).toEqual({
      bitmap: fakeBitmap,
      width: 640,
      height: 960,
    });

    const defaultStreamCore = new DecodeWorkerCore({
      createImageBitmap: decodeSpy,
    });
    const defaultResult = await defaultStreamCore.decodePageSlice(deflated, 8);
    expect(defaultResult.bitmap).toBe(fakeBitmap);
  });

  it("DecompressionStream非対応環境や失敗時はfflate.inflateSyncへフォールバックすること (AC-ENG-06)", async () => {
    const rawImage = new Uint8Array([1, 3, 5, 7, 9, 11, 13, 15]);
    const deflated = deflateSync(rawImage);
    const fakeBitmap = createFakeBitmap(500, 700);

    // 1. DecompressionStreamが存在しない環境 (globalThis stub)
    vi.stubGlobal("DecompressionStream", undefined);
    const globalStubDecode = vi.fn(async (blob: Blob) => {
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(rawImage);
      return fakeBitmap;
    });
    vi.stubGlobal("createImageBitmap", globalStubDecode);

    const noStreamCore = new DecodeWorkerCore();
    const res1 = await noStreamCore.decodePageSlice(deflated, 8);
    expect(res1.bitmap).toBe(fakeBitmap);

    // 2. createDecompressionStreamがnull注入された場合
    const nullStreamCore = new DecodeWorkerCore({
      createImageBitmap: globalStubDecode,
      createDecompressionStream: null,
    });
    const res2 = await nullStreamCore.decodePageSlice(deflated, 8);
    expect(res2.bitmap).toBe(fakeBitmap);

    // 3. DecompressionStream実行中にエラーとなった場合のフォールバック
    const failingStreamCore = new DecodeWorkerCore({
      createImageBitmap: globalStubDecode,
      createDecompressionStream: () => {
        throw new Error("deflate-raw unsupported");
      },
    });
    const res3 = await failingStreamCore.decodePageSlice(deflated, 8);
    expect(res3.bitmap).toBe(fakeBitmap);
  });

  it("伸長またはcreateImageBitmapに失敗した場合はZipArchiveError('DECODE_FAILED')を送出すること (AC-ENG-06)", async () => {
    const badDeflate = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    const core1 = new DecodeWorkerCore({
      createImageBitmap: vi.fn(async () => createFakeBitmap()),
      createDecompressionStream: null,
    });

    await expect(core1.decodePageSlice(badDeflate, 8)).rejects.toBeInstanceOf(
      ZipArchiveError,
    );
    await expect(core1.decodePageSlice(badDeflate, 8)).rejects.toMatchObject({
      code: "DECODE_FAILED",
    });

    const core2 = new DecodeWorkerCore({
      createImageBitmap: vi.fn(async () => {
        throw new Error("Invalid image data");
      }),
    });

    await expect(
      core2.decodePageSlice(new Uint8Array([1, 2, 3]), 0),
    ).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "DECODE_FAILED",
    });
  });
});
