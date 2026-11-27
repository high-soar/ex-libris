import { describe, expect, it } from "vitest";
import { parseZipDirectory, readCompressedPageSlice } from "../zip/zipParser";
import { MockCoverArchiveRangeReader } from "./MockCoverArchiveRangeReader";

describe("MockCoverArchiveRangeReader", () => {
  it("外部通信ゼロで有効な1ページPNG入りZIPをインメモリ合成しparseZipDirectoryとreadCompressedPageSliceで読み取れること (NFR-05)", async () => {
    const reader = new MockCoverArchiveRangeReader("vol-preview-1");
    expect(reader.sourceId).toBe("mock-cover:vol-preview-1");
    expect(reader.totalSize).toBeGreaterThan(100);

    const entries = await parseZipDirectory(reader);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entryName).toBe("cover.png");
    expect(entries[0]?.compressionMethod).toBe(0);

    const slice = await readCompressedPageSlice(reader, entries[0]!);
    // PNG シグネチャ 89 50 4E 47 0D 0A 1A 0A を持つ有効な PNG バイト列であること
    expect(Array.from(slice.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it("readRangeの境界条件(AbortSignal・不正範囲・length=0・offset>=totalSize・独立バッファ)を正しく処理すること", async () => {
    const reader = new MockCoverArchiveRangeReader("vol-boundary");

    const aborted = new AbortController();
    aborted.abort();
    await expect(reader.readRange(0, 10, aborted.signal)).rejects.toMatchObject(
      {
        name: "AbortError",
      },
    );

    for (const [offset, length] of [
      [-1, 5],
      [0, -1],
      [0.5, 2],
      [0, 1.5],
    ]) {
      await expect(reader.readRange(offset, length)).rejects.toMatchObject({
        name: "ZipArchiveError",
        code: "READ_ERROR",
      });
    }

    expect(await reader.readRange(0, 0)).toEqual(new Uint8Array(0));
    expect(await reader.readRange(reader.totalSize, 10)).toEqual(
      new Uint8Array(0),
    );

    const head = await reader.readRange(0, 4);
    expect(head.byteOffset).toBe(0);
    expect(head.buffer.byteLength).toBe(4);
    expect(Array.from(head)).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});
