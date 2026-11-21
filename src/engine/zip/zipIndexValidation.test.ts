import { describe, expect, it } from "vitest";
import type { ZipPageEntry } from "../types";
import { validateZipIndexEntries } from "./zipIndexValidation";

function createValidEntry(overrides: Partial<ZipPageEntry> = {}): ZipPageEntry {
  return {
    pageIndex: 0,
    entryName: "001.jpg",
    entryNameByteLength: 7,
    compressionMethod: 0,
    compressedSize: 1024,
    uncompressedSize: 1024,
    localHeaderOffset: 0,
    physicalEnd: 1100,
    crc32: 0x1234abcd,
    ...overrides,
  };
}

describe("validateZipIndexEntries", () => {
  it("有効なZipPageEntry配列（Store/Deflate混在・境界値含む）を受け入れること (AC-ENG-11)", () => {
    const entries: ZipPageEntry[] = [
      createValidEntry({
        pageIndex: 0,
        entryName: "第1話/001.jpg",
        entryNameByteLength: 15,
        compressionMethod: 0,
        compressedSize: 0,
        uncompressedSize: 0,
        localHeaderOffset: 0,
        physicalEnd: 100,
        crc32: 0,
      }),
      createValidEntry({
        pageIndex: 1,
        entryName: "第1話/002.png",
        entryNameByteLength: 15,
        compressionMethod: 8,
        compressedSize: 2048,
        uncompressedSize: 4096,
        localHeaderOffset: Number.MAX_SAFE_INTEGER - 10,
        physicalEnd: Number.MAX_SAFE_INTEGER,
        crc32: 0xffffffff,
      }),
    ];

    expect(validateZipIndexEntries(entries)).toBe(true);
    expect(validateZipIndexEntries(entries, 2)).toBe(true);
  });

  it("非配列・空配列・ページ数不一致・非オブジェクト要素を拒否すること", () => {
    expect(validateZipIndexEntries(null)).toBe(false);
    expect(validateZipIndexEntries(undefined)).toBe(false);
    expect(validateZipIndexEntries("not-an-array")).toBe(false);
    expect(validateZipIndexEntries({ length: 1 })).toBe(false);
    expect(validateZipIndexEntries([])).toBe(false);

    const single = [createValidEntry()];
    expect(validateZipIndexEntries(single, 0)).toBe(false);
    expect(validateZipIndexEntries(single, 2)).toBe(false);

    expect(validateZipIndexEntries([null])).toBe(false);
    expect(validateZipIndexEntries([undefined])).toBe(false);
    expect(validateZipIndexEntries(["entry"])).toBe(false);
    expect(validateZipIndexEntries([42])).toBe(false);
  });

  it("pageIndex不一致・entryName不正・entryNameByteLength不正を拒否すること", () => {
    expect(validateZipIndexEntries([createValidEntry({ pageIndex: 1 })])).toBe(
      false,
    );
    expect(
      validateZipIndexEntries([
        createValidEntry({ pageIndex: 0 }),
        createValidEntry({ pageIndex: 2 }),
      ]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([
        createValidEntry({ pageIndex: "0" as unknown as number }),
      ]),
    ).toBe(false);

    expect(validateZipIndexEntries([createValidEntry({ entryName: "" })])).toBe(
      false,
    );
    expect(
      validateZipIndexEntries([
        createValidEntry({ entryName: 123 as unknown as string }),
      ]),
    ).toBe(false);

    expect(
      validateZipIndexEntries([createValidEntry({ entryNameByteLength: 0 })]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([createValidEntry({ entryNameByteLength: -1 })]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([createValidEntry({ entryNameByteLength: 1.5 })]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([
        createValidEntry({ entryNameByteLength: Number.NaN }),
      ]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([
        createValidEntry({ entryNameByteLength: "7" as unknown as number }),
      ]),
    ).toBe(false);
  });

  it("compressionMethod・サイズ・オフセット・physicalEnd・crc32の不正値を拒否すること", () => {
    expect(
      validateZipIndexEntries([
        createValidEntry({ compressionMethod: 9 as 0 }),
      ]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([
        createValidEntry({ compressionMethod: "0" as unknown as 0 }),
      ]),
    ).toBe(false);

    // compressedSize
    expect(
      validateZipIndexEntries([createValidEntry({ compressedSize: -1 })]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([createValidEntry({ compressedSize: 1.5 })]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([
        createValidEntry({ compressedSize: Number.MAX_SAFE_INTEGER + 1 }),
      ]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([
        createValidEntry({ compressedSize: "100" as unknown as number }),
      ]),
    ).toBe(false);

    // uncompressedSize
    expect(
      validateZipIndexEntries([createValidEntry({ uncompressedSize: -1 })]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([
        createValidEntry({ uncompressedSize: Number.POSITIVE_INFINITY }),
      ]),
    ).toBe(false);

    // localHeaderOffset & physicalEnd
    expect(
      validateZipIndexEntries([createValidEntry({ localHeaderOffset: -1 })]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([
        createValidEntry({ localHeaderOffset: Number.NaN }),
      ]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([
        createValidEntry({ localHeaderOffset: 0, physicalEnd: -1 }),
      ]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([
        createValidEntry({
          localHeaderOffset: 0,
          physicalEnd: Number.MAX_SAFE_INTEGER + 1,
        }),
      ]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([
        createValidEntry({ localHeaderOffset: 100, physicalEnd: 100 }),
      ]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([
        createValidEntry({ localHeaderOffset: 100, physicalEnd: 99 }),
      ]),
    ).toBe(false);

    // crc32
    expect(validateZipIndexEntries([createValidEntry({ crc32: -1 })])).toBe(
      false,
    );
    expect(
      validateZipIndexEntries([createValidEntry({ crc32: 0x100000000 })]),
    ).toBe(false);
    expect(validateZipIndexEntries([createValidEntry({ crc32: 1.25 })])).toBe(
      false,
    );
    expect(
      validateZipIndexEntries([createValidEntry({ crc32: Number.NaN })]),
    ).toBe(false);
    expect(
      validateZipIndexEntries([
        createValidEntry({ crc32: "0" as unknown as number }),
      ]),
    ).toBe(false);
  });
});
