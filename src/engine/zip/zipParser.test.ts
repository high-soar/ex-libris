import { inflateSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ENGINE_BUDGETS } from "../constants";
import type { RandomAccessReader, ZipPageEntry } from "../types";
import { ZipArchiveError } from "./errors";
import {
  buildSyntheticZip,
  createMemoryReader,
} from "./__fixtures__/zipBuilder";
import { parseZipDirectory, readCompressedPageSlice } from "./zipParser";

describe("zipParser", () => {
  it("末尾128KBから1RTTでEOCDとCDHを解析しStore・Deflateページ情報を返すこと (AC-ENG-02)", async () => {
    const storeBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const deflateBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const zipBytes = buildSyntheticZip({
      preambleBytes: new Uint8Array(64),
      comment: "ExLibris Comic Archive",
      entries: [
        { name: "001.jpg", data: storeBytes, compressionMethod: 0 },
        { name: "002.png", data: deflateBytes, compressionMethod: 8 },
      ],
    });
    const reader = createMemoryReader(zipBytes);

    const entries = await parseZipDirectory(reader);

    expect(reader.reads).toHaveLength(1);
    expect(reader.reads[0]).toEqual({
      offset: 0,
      length: zipBytes.byteLength,
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      pageIndex: 0,
      entryName: "001.jpg",
      entryNameByteLength: 7,
      compressionMethod: 0,
      compressedSize: storeBytes.byteLength,
      uncompressedSize: storeBytes.byteLength,
    });
    expect(entries[1]).toMatchObject({
      pageIndex: 1,
      entryName: "002.png",
      entryNameByteLength: 7,
      compressionMethod: 8,
      uncompressedSize: deflateBytes.byteLength,
    });

    const slice0 = await readCompressedPageSlice(reader, entries[0]);
    expect(slice0).toEqual(storeBytes);
    const slice1 = await readCompressedPageSlice(reader, entries[1]);
    expect(inflateSync(slice1)).toEqual(deflateBytes);
  });

  it("Central Directoryが128KBを超過する場合は追加1RTTで全量解析すること (AC-ENG-02)", async () => {
    const padding = new Uint8Array(15_000).fill(0x41);
    const archiveEntries = Array.from({ length: 10 }, (_, idx) => ({
      name: `page_${idx + 1}.jpg`,
      data: new Uint8Array([idx + 1, idx + 2, idx + 3]),
      cdhComment: padding,
    }));
    const zipBytes = buildSyntheticZip({ entries: archiveEntries });
    expect(zipBytes.byteLength).toBeGreaterThan(
      ENGINE_BUDGETS.INITIAL_TAIL_READ_BYTES,
    );

    const reader = createMemoryReader(zipBytes);
    const entries = await parseZipDirectory(reader);

    expect(reader.reads).toHaveLength(2);
    expect(reader.reads[0]).toEqual({
      offset: zipBytes.byteLength - ENGINE_BUDGETS.INITIAL_TAIL_READ_BYTES,
      length: ENGINE_BUDGETS.INITIAL_TAIL_READ_BYTES,
    });
    expect(entries).toHaveLength(10);
    expect(entries.map((e) => e.entryName)).toEqual([
      "page_1.jpg",
      "page_2.jpg",
      "page_3.jpg",
      "page_4.jpg",
      "page_5.jpg",
      "page_6.jpg",
      "page_7.jpg",
      "page_8.jpg",
      "page_9.jpg",
      "page_10.jpg",
    ]);
  });

  it("不要エントリ（__MACOSX/・._*・Thumbs.db・.DS_Store・desktop.ini・ディレクトリ・非画像）を除外し自然順ソートすること (AC-ENG-03)", async () => {
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "images/", data: new Uint8Array(0) },
        { name: "windows_dir\\", data: new Uint8Array(0) },
        {
          name: "dos_dir_no_slash",
          data: new Uint8Array(0),
          externalAttributes: 0x10,
        },
        {
          name: "unix_dir_no_slash",
          data: new Uint8Array(0),
          externalAttributes: 0x41ed0000,
        },
        { name: "__MACOSX/p1.jpg", data: new Uint8Array([1]) },
        { name: "chapter/__MACOSX/p2.jpg", data: new Uint8Array([1]) },
        { name: "._p1.jpg", data: new Uint8Array([1]) },
        { name: "chapter/._p2.jpg", data: new Uint8Array([1]) },
        { name: ".DS_Store", data: new Uint8Array([1]) },
        { name: "chapter/Thumbs.db", data: new Uint8Array([1]) },
        { name: "desktop.ini", data: new Uint8Array([1]) },
        { name: "README", data: new Uint8Array([1]) },
        { name: "metadata.xml", data: new Uint8Array([1]) },
        {
          name: "encrypted_non_image.txt",
          data: new Uint8Array([1]),
          flags: 1,
        },
        { name: "p10.JPG", data: new Uint8Array([10]) },
        { name: "p2.jpg", data: new Uint8Array([2]) },
        { name: "p1.jpeg", data: new Uint8Array([1]) },
        { name: "p11.PNG", data: new Uint8Array([11]) },
        { name: "p12.webp", data: new Uint8Array([12]) },
        { name: "p13.AVIF", data: new Uint8Array([13]) },
      ],
    });
    const reader = createMemoryReader(zipBytes);

    const entries = await parseZipDirectory(reader);

    expect(entries.map((e) => [e.pageIndex, e.entryName])).toEqual([
      [0, "p1.jpeg"],
      [1, "p2.jpg"],
      [2, "p10.JPG"],
      [3, "p11.PNG"],
      [4, "p12.webp"],
      [5, "p13.AVIF"],
    ]);
  });

  it("非UTF-8バイト列のファイル名でも停止せずデコードし元バイト長entryNameByteLengthを保持すること (AC-ENG-04)", async () => {
    // Shift_JIS相当の不正UTF-8バイト列: 0x82 0xA0 ("あ" in SJIS) + ".jpg"
    const sjisName = new Uint8Array([0x82, 0xa0, 0x2e, 0x6a, 0x70, 0x67]);
    const utf8JapaneseName = "第1話_あ.jpg";
    const utf8ByteLength = new TextEncoder().encode(
      utf8JapaneseName,
    ).byteLength;

    const zipBytes = buildSyntheticZip({
      entries: [
        { name: sjisName, data: new Uint8Array([1, 2, 3]) },
        { name: utf8JapaneseName, data: new Uint8Array([4, 5, 6]) },
      ],
    });
    const reader = createMemoryReader(zipBytes);

    const entries = await parseZipDirectory(reader);

    expect(entries).toHaveLength(2);
    const sjisEntry = entries.find((e) => e.entryNameByteLength === 6);
    expect(sjisEntry).toBeDefined();
    expect(sjisEntry?.entryName).toContain(".jpg");

    const utf8Entry = entries.find((e) => e.entryName === utf8JapaneseName);
    expect(utf8Entry).toBeDefined();
    expect(utf8Entry?.entryNameByteLength).toBe(utf8ByteLength);
    expect(utf8ByteLength).toBeGreaterThan(utf8JapaneseName.length);
  });

  it("論理ページ順と物理オフセット順が異なる場合でもphysicalEndを物理配置順で正しく計算すること (AC-ENG-05)", async () => {
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "p10.jpg", data: new Uint8Array([10, 10]) },
        { name: "p2.jpg", data: new Uint8Array([2, 2]) },
      ],
      reorderCdhOrder: [1, 0],
    });
    const reader = createMemoryReader(zipBytes);

    const entries = await parseZipDirectory(reader);

    expect(entries[0].entryName).toBe("p2.jpg");
    expect(entries[1].entryName).toBe("p10.jpg");
    expect(entries[1].localHeaderOffset).toBeLessThan(
      entries[0].localHeaderOffset,
    );
    expect(entries[1].physicalEnd).toBe(entries[0].localHeaderOffset);
    expect(entries[0].physicalEnd).toBeGreaterThan(
      entries[0].localHeaderOffset,
    );
    expect(await readCompressedPageSlice(reader, entries[0])).toEqual(
      new Uint8Array([2, 2]),
    );
    expect(await readCompressedPageSlice(reader, entries[1])).toEqual(
      new Uint8Array([10, 10]),
    );
  });

  it("CDHとLFHでextraFieldLengthが異なる場合やBit3 Data Descriptor有効時でも1RTTで正確に切り出すこと (AC-ENG-05)", async () => {
    const payloadA = new Uint8Array([11, 22, 33, 44]);
    const payloadB = new Uint8Array([55, 66, 77, 88, 99]);
    const zipBytes = buildSyntheticZip({
      entries: [
        {
          name: "001.jpg",
          data: payloadA,
          cdhExtra: new Uint8Array(0),
          lfhExtra: new Uint8Array(128).fill(0x7f),
        },
        {
          name: "002.jpg",
          data: payloadB,
          dataDescriptor: true,
        },
      ],
    });
    const reader = createMemoryReader(zipBytes);
    const entries = await parseZipDirectory(reader);
    reader.reads.length = 0;

    const sliceA = await readCompressedPageSlice(reader, entries[0]);
    expect(sliceA).toEqual(payloadA);
    expect(reader.reads).toHaveLength(1);

    reader.reads.length = 0;
    const sliceB = await readCompressedPageSlice(reader, entries[1]);
    expect(sliceB).toEqual(payloadB);
    expect(reader.reads).toHaveLength(1);
  });

  it("LFH extraFieldが1KBマージンを超過する場合は不足末尾差分のみ追加1RTT取得して結合すること (AC-ENG-05)", async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const zipBytes = buildSyntheticZip({
      entries: [
        {
          name: "001.jpg",
          data: payload,
          cdhExtra: new Uint8Array(0),
          lfhExtra: new Uint8Array(1_500).fill(0xaa),
        },
      ],
    });
    const reader = createMemoryReader(zipBytes);
    const entries = await parseZipDirectory(reader);
    reader.reads.length = 0;

    const slice = await readCompressedPageSlice(reader, entries[0]);

    expect(slice).toEqual(payload);
    expect(reader.reads).toHaveLength(2);
    expect(reader.reads[0].length).toBe(
      30 +
        entries[0].entryNameByteLength +
        entries[0].compressedSize +
        ENGINE_BUDGETS.LFH_EXTRA_MARGIN_BYTES,
    );
  });

  it("空アーカイブ・暗号化・未対応圧縮・ZIP64に明示的ZipErrorCodeを送出すること (AC-ENG-04)", async () => {
    const emptyZip = buildSyntheticZip({ entries: [] });
    await expect(
      parseZipDirectory(createMemoryReader(emptyZip)),
    ).rejects.toMatchObject({ code: "EMPTY_ARCHIVE" });

    const junkOnlyZip = buildSyntheticZip({
      entries: [{ name: "README.txt", data: new Uint8Array([1, 2]) }],
    });
    await expect(
      parseZipDirectory(createMemoryReader(junkOnlyZip)),
    ).rejects.toMatchObject({ code: "EMPTY_ARCHIVE" });

    const encryptedZip = buildSyntheticZip({
      entries: [{ name: "001.jpg", data: new Uint8Array([1]), flags: 0x0001 }],
    });
    await expect(
      parseZipDirectory(createMemoryReader(encryptedZip)),
    ).rejects.toMatchObject({ code: "ENCRYPTED_ZIP" });

    const unsupportedZip = buildSyntheticZip({
      entries: [
        {
          name: "001.jpg",
          data: new Uint8Array([1]),
          compressionMethod: 9,
        },
      ],
    });
    await expect(
      parseZipDirectory(createMemoryReader(unsupportedZip)),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_COMPRESSION" });

    const zip64LocatorZip = buildSyntheticZip({
      entries: [{ name: "001.jpg", data: new Uint8Array([1]) }],
      prependZip64Locator: true,
    });
    await expect(
      parseZipDirectory(createMemoryReader(zip64LocatorZip)),
    ).rejects.toMatchObject({ code: "ZIP64_NOT_SUPPORTED" });

    const eocdSatCases = [
      { diskNumber: 0xffff },
      { cdDiskNumber: 0xffff },
      { diskEntries: 0xffff },
      { totalEntries: 0xffff },
      { cdSize: 0xffffffff },
      { cdOffset: 0xffffffff },
    ];
    for (const overrideEocd of eocdSatCases) {
      const satZip = buildSyntheticZip({
        entries: [{ name: "001.jpg", data: new Uint8Array([1]) }],
        overrideEocd,
      });
      await expect(
        parseZipDirectory(createMemoryReader(satZip)),
      ).rejects.toMatchObject({ code: "ZIP64_NOT_SUPPORTED" });
    }

    const cdhSatCases = [
      { overrideCdhCompressedSize: 0xffffffff },
      { overrideCdhUncompressedSize: 0xffffffff },
      { overrideCdhLocalHeaderOffset: 0xffffffff },
    ];
    for (const entryOverride of cdhSatCases) {
      const satZip = buildSyntheticZip({
        entries: [
          {
            name: "001.jpg",
            data: new Uint8Array([1]),
            ...entryOverride,
          },
        ],
      });
      await expect(
        parseZipDirectory(createMemoryReader(satZip)),
      ).rejects.toMatchObject({ code: "ZIP64_NOT_SUPPORTED" });
    }
  });

  it("破損ZIPの各種境界異常（EOCD不在・短読込・CD境界超過・CDH破損・LFH破損）でCORRUPT_ZIPを送出すること (AC-ENG-04, AC-ENG-05)", async () => {
    // 1. 22バイト未満
    await expect(
      parseZipDirectory(createMemoryReader(new Uint8Array(10))),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 2. EOCDシグネチャ不在
    const noEocdZip = buildSyntheticZip({
      entries: [{ name: "001.jpg", data: new Uint8Array([1]) }],
      omitEocd: true,
    });
    await expect(
      parseZipDirectory(createMemoryReader(noEocdZip)),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 3. 末尾読込サイズが要求値より短い
    const shortTailReader: RandomAccessReader = {
      sourceId: "short",
      totalSize: 100,
      async readRange() {
        return new Uint8Array(50);
      },
    };
    await expect(parseZipDirectory(shortTailReader)).rejects.toMatchObject({
      code: "CORRUPT_ZIP",
    });

    // 4. cdOffset + cdSize > eocdAbsoluteOffset
    const badCdBoundsZip = buildSyntheticZip({
      entries: [{ name: "001.jpg", data: new Uint8Array([1]) }],
      overrideEocd: { cdSize: 9999 },
    });
    await expect(
      parseZipDirectory(createMemoryReader(badCdBoundsZip)),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 5. 128KB超CDの2回目readRangeが短サイズを返した場合
    const hugeCdPadding = new Uint8Array(15_000).fill(0x41);
    const hugeCdZip = buildSyntheticZip({
      entries: Array.from({ length: 10 }, (_, idx) => ({
        name: `p${idx}.jpg`,
        data: new Uint8Array([1]),
        cdhComment: hugeCdPadding,
      })),
    });
    let callCount = 0;
    const truncatedSecondReader: RandomAccessReader = {
      sourceId: "truncated-cd",
      totalSize: hugeCdZip.byteLength,
      async readRange(offset, length) {
        callCount += 1;
        if (callCount === 2) {
          return new Uint8Array(10);
        }
        return hugeCdZip.slice(offset, offset + length);
      },
    };
    await expect(
      parseZipDirectory(truncatedSecondReader),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 6. totalEntriesがCD実体長を超過（CDH途中で終端）
    const truncatedCdhCountZip = buildSyntheticZip({
      entries: [{ name: "001.jpg", data: new Uint8Array([1]) }],
      overrideEocd: { totalEntries: 2 },
    });
    await expect(
      parseZipDirectory(createMemoryReader(truncatedCdhCountZip)),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 7. CDHシグネチャ不正
    const badCdhSigZip = buildSyntheticZip({
      entries: [
        {
          name: "001.jpg",
          data: new Uint8Array([1]),
          overrideCdhSignature: 0xdeadbeef,
        },
      ],
    });
    await expect(
      parseZipDirectory(createMemoryReader(badCdhSigZip)),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 8. CDH可変長フィールドがCDバッファ範囲外
    const overflowCdhVarZip = buildSyntheticZip({
      entries: [{ name: "001.jpg", data: new Uint8Array([1]) }],
    });
    const overflowView = new DataView(overflowCdhVarZip.buffer);
    const cdStart = overflowView.getUint32(
      overflowCdhVarZip.byteLength - 6,
      true,
    );
    overflowView.setUint16(cdStart + 28, 9999, true);
    await expect(
      parseZipDirectory(createMemoryReader(overflowCdhVarZip)),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 9. LFHオフセットがCD開始位置を超過
    const badLfhOffsetZip = buildSyntheticZip({
      entries: [
        {
          name: "001.jpg",
          data: new Uint8Array([1]),
          overrideCdhLocalHeaderOffset: 99999,
        },
      ],
    });
    await expect(
      parseZipDirectory(createMemoryReader(badLfhOffsetZip)),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });
  });

  it("readCompressedPageSliceのLFH境界異常・シグネチャ不一致・2回目読込不足でCORRUPT_ZIPを送出すること (AC-ENG-05)", async () => {
    const baseEntry: ZipPageEntry = {
      pageIndex: 0,
      entryName: "001.jpg",
      entryNameByteLength: 7,
      compressionMethod: 0,
      compressedSize: 4,
      uncompressedSize: 4,
      localHeaderOffset: 0,
      physicalEnd: 100,
      crc32: 0,
    };

    // 1. localHeaderOffset < 0
    await expect(
      readCompressedPageSlice(createMemoryReader(new Uint8Array(100)), {
        ...baseEntry,
        localHeaderOffset: -1,
      }),
    ).rejects.toBeInstanceOf(ZipArchiveError);

    // 2. maxSpan < 30
    await expect(
      readCompressedPageSlice(createMemoryReader(new Uint8Array(100)), {
        ...baseEntry,
        physicalEnd: 29,
      }),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 3. initialBuf.byteLength < 30
    const shortInitialReader: RandomAccessReader = {
      sourceId: "short-lfh",
      totalSize: 100,
      async readRange() {
        return new Uint8Array(20);
      },
    };
    await expect(
      readCompressedPageSlice(shortInitialReader, baseEntry),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 4. LFHシグネチャ不正
    const badLfhSigZip = buildSyntheticZip({
      entries: [
        {
          name: "001.jpg",
          data: new Uint8Array([1, 2, 3, 4]),
          overrideLfhSignature: 0x11223344,
        },
      ],
    });
    const badLfhReader = createMemoryReader(badLfhSigZip);
    const badLfhEntries = await parseZipDirectory(badLfhReader);
    await expect(
      readCompressedPageSlice(badLfhReader, badLfhEntries[0]),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 5. dataEnd > maxSpan (LFHが誇大なextraLengthを主張)
    const spanOverflowZip = buildSyntheticZip({
      entries: [
        {
          name: "001.jpg",
          data: new Uint8Array([1, 2, 3, 4]),
          overrideLfhExtraLength: 500,
        },
      ],
    });
    const spanReader = createMemoryReader(spanOverflowZip);
    const spanEntries = await parseZipDirectory(spanReader);
    await expect(
      readCompressedPageSlice(spanReader, spanEntries[0]),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 6. 1KB超過LFHの2回目読込が不足
    const largeExtraZip = buildSyntheticZip({
      entries: [
        {
          name: "001.jpg",
          data: new Uint8Array([1, 2, 3, 4]),
          lfhExtra: new Uint8Array(1_500).fill(0x55),
        },
      ],
    });
    const largeEntries = await parseZipDirectory(
      createMemoryReader(largeExtraZip),
    );
    let sliceReadCount = 0;
    const truncatedTailReader: RandomAccessReader = {
      sourceId: "truncated-tail",
      totalSize: largeExtraZip.byteLength,
      async readRange(offset, length) {
        sliceReadCount += 1;
        if (sliceReadCount === 2) {
          return new Uint8Array(1);
        }
        return largeExtraZip.slice(offset, offset + length);
      },
    };
    await expect(
      readCompressedPageSlice(truncatedTailReader, largeEntries[0]),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });
  });
});
