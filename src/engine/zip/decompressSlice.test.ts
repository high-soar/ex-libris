import { deflateSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decompressZipSlice } from "./decompressSlice";

describe("decompressZipSlice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Store(0)圧縮データはコピーせずそのまま返却すること (AC-COV-01)", async () => {
    const raw = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const result = await decompressZipSlice(raw, 0);
    expect(result).toBe(raw);
  });

  it("Deflate(8)圧縮データをDecompressionStream('deflate-raw')優先で伸長できること (AC-COV-01)", async () => {
    const raw = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const deflated = deflateSync(raw);

    const streamSpy = vi.fn(
      (format: "deflate-raw") => new DecompressionStream(format),
    );
    const result = await decompressZipSlice(deflated, 8, {
      createDecompressionStream: streamSpy,
    });
    expect(streamSpy).toHaveBeenCalledWith("deflate-raw");
    expect(result).toEqual(raw);

    const defaultResult = await decompressZipSlice(deflated, 8);
    expect(defaultResult).toEqual(raw);
  });

  it("DecompressionStream非対応・null注入・実行時エラー時はfflate.inflateSyncへフォールバックすること (AC-COV-01)", async () => {
    const raw = new Uint8Array([1, 3, 5, 7, 9, 11, 13, 15]);
    const deflated = deflateSync(raw);

    vi.stubGlobal("DecompressionStream", undefined);
    expect(await decompressZipSlice(deflated, 8)).toEqual(raw);

    expect(
      await decompressZipSlice(deflated, 8, {
        createDecompressionStream: null,
      }),
    ).toEqual(raw);

    expect(
      await decompressZipSlice(deflated, 8, {
        createDecompressionStream: () => {
          throw new Error("deflate-raw unsupported");
        },
      }),
    ).toEqual(raw);
  });

  it("破損したDeflateストリームの場合は例外を送出すること (AC-COV-01)", async () => {
    const corrupt = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    await expect(
      decompressZipSlice(corrupt, 8, { createDecompressionStream: null }),
    ).rejects.toThrow();
  });
});
