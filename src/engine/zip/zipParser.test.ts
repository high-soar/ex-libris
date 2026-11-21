import { inflateSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ENGINE_BUDGETS } from "../constants";
import type { RandomAccessReader, ZipPageEntry } from "../types";
import { ZipArchiveError } from "./errors";
import {
  buildSyntheticZip,
  buildTlvBlock,
  createMemoryReader,
  createVirtualOffsetReader,
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

  it("GPBF Bit11判定とCP932（Shift_JIS）フォールバックで日本語・半角カナ・機種依存文字・0x5C後続バイトを正確に復元し元バイト長entryNameByteLengthを保持すること (AC-ENG-04, AC-ENG-10)", async () => {
    // 1. GPBF Bit 11=0 + 不正UTF-8（Shift_JIS: "あ.jpg" = 0x82 0xA0 + ".jpg"）
    const sjisAh = new Uint8Array([0x82, 0xa0, 0x2e, 0x6a, 0x70, 0x67]);
    // 2. GPBF Bit 11=0 + Shift_JIS 半角カナ・機種依存文字（"ｱｲｳ①㈱髙.jpg"）
    const sjisVendor = new Uint8Array([
      0xb1, 0xb2, 0xb3, 0x87, 0x40, 0x87, 0x8a, 0xfb, 0xfc, 0x2e, 0x6a, 0x70,
      0x67,
    ]);
    // 3. GPBF Bit 11=0 + Shift_JIS 0x5C('表','ソ')をディレクトリ区切りと誤認しない（"表ソ/001.jpg"）
    const sjisTrail5c = new Uint8Array([
      0x95, 0x5c, 0x83, 0x5c, 0x2f, 0x30, 0x30, 0x31, 0x2e, 0x6a, 0x70, 0x67,
    ]);
    // 4. GPBF Bit 11=0 だが実バイトが正当なUTF-8（"第1話/001.jpg"）-> UTF-8 strict成功
    const utf8NoFlagName = "第1話/001.jpg";
    const utf8NoFlagBytes = new TextEncoder().encode(utf8NoFlagName);
    // 5. GPBF Bit 11=1 (0x0800) で不正UTF-8バイト列 -> Shift_JISフォールバックせずUTF-8(fatal:false)置換文字にする
    const bit11InvalidUtf8 = new Uint8Array([
      0x82, 0xa0, 0x2e, 0x70, 0x6e, 0x67,
    ]);
    // 6. 通常のBit 11=1 UTF-8日本語ファイル名
    const utf8JapaneseName = "第1話_あ.jpg";
    const utf8ByteLength = new TextEncoder().encode(
      utf8JapaneseName,
    ).byteLength;

    const payloadSjis = new Uint8Array([10, 20, 30, 40]);
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: sjisAh, data: payloadSjis, flags: 0 },
        { name: sjisVendor, data: new Uint8Array([2]), flags: 0 },
        { name: sjisTrail5c, data: new Uint8Array([3]), flags: 0 },
        { name: utf8NoFlagBytes, data: new Uint8Array([4]), flags: 0 },
        { name: bit11InvalidUtf8, data: new Uint8Array([5]), flags: 0x0800 },
        { name: utf8JapaneseName, data: new Uint8Array([6]), flags: 0x0800 },
      ],
    });
    const reader = createMemoryReader(zipBytes);

    const entries = await parseZipDirectory(reader);

    expect(entries).toHaveLength(6);

    const ahEntry = entries.find((e) => e.entryName === "あ.jpg");
    expect(ahEntry).toBeDefined();
    expect(ahEntry?.entryNameByteLength).toBe(6);
    expect(await readCompressedPageSlice(reader, ahEntry!)).toEqual(
      payloadSjis,
    );

    const vendorEntry = entries.find((e) => e.entryName === "ｱｲｳ①㈱髙.jpg");
    expect(vendorEntry).toBeDefined();
    expect(vendorEntry?.entryNameByteLength).toBe(sjisVendor.byteLength);

    const trail5cEntry = entries.find((e) => e.entryName === "表ソ/001.jpg");
    expect(trail5cEntry).toBeDefined();
    expect(trail5cEntry?.entryNameByteLength).toBe(sjisTrail5c.byteLength);

    const utf8NoFlagEntry = entries.find((e) => e.entryName === utf8NoFlagName);
    expect(utf8NoFlagEntry).toBeDefined();
    expect(utf8NoFlagEntry?.entryNameByteLength).toBe(
      utf8NoFlagBytes.byteLength,
    );

    const bit11InvalidEntry = entries.find((e) => e.entryName.endsWith(".png"));
    expect(bit11InvalidEntry?.entryName).toBe("\ufffd\ufffd.png");

    const utf8Entry = entries.find((e) => e.entryName === utf8JapaneseName);
    expect(utf8Entry).toBeDefined();
    expect(utf8Entry?.entryNameByteLength).toBe(utf8ByteLength);
  });

  it("パス区切り('/'と'\\')セグメント単位の日本語自然順でソートし、共通接頭辞同値時はセグメント数の少ない方を先頭にすること (AC-ENG-03)", async () => {
    // フラット文字列比較だと "_" < "/" や "-" < "/" の影響で "第1話_おまけ/001.jpg" が "第1話/002.jpg" より先になり得る
    const zipBytes = buildSyntheticZip({
      entries: [
        { name: "第1話_おまけ/001.jpg", data: new Uint8Array([1]) },
        { name: "第10話/001.jpg", data: new Uint8Array([2]) },
        { name: "第2話\\001.jpg", data: new Uint8Array([3]) },
        { name: "第1話/010.jpg", data: new Uint8Array([4]) },
        { name: "第1話/002.jpg", data: new Uint8Array([5]) },
        { name: "album.jpg/01.png", data: new Uint8Array([6]) },
        { name: "album.jpg", data: new Uint8Array([7]) },
        { name: "chapterA/02.jpg", data: new Uint8Array([8]) },
        { name: "chaptera/01.jpg", data: new Uint8Array([9]) },
      ],
    });
    const reader = createMemoryReader(zipBytes);

    const entries = await parseZipDirectory(reader);

    expect(entries.map((e) => e.entryName)).toEqual([
      "album.jpg",
      "album.jpg/01.png",
      "chaptera/01.jpg",
      "chapterA/02.jpg",
      "第1話/002.jpg",
      "第1話/010.jpg",
      "第1話_おまけ/001.jpg",
      "第2話\\001.jpg",
      "第10話/001.jpg",
    ]);
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

  it("LFH extraFieldが1KBマージンを超過する2RTT経路でケース2a（末尾差分のみ・byteOffset===0独立バッファ）とケース2b（圧縮本体直接取得）を余剰コピーなく処理すること (AC-ENG-05, AC-ENG-10)", async () => {
    // ケース 2a: compressedSize=2000, lfhExtra=1050 => fetchLength=30+7+2000+1024=3061, dataStart=30+7+1050=1087 < 3061, dataEnd=3087 > 3061
    const payload2a = Uint8Array.from({ length: 2000 }, (_, i) => i & 0xff);
    // ケース 2b: compressedSize=8, lfhExtra=5000 => fetchLength=30+7+8+1024=1069, dataStart=30+7+5000=5037 >= 1069
    const payload2b = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    // ケース 2b 境界: compressedSize=8, lfhExtra=1032 => fetchLength=1069, dataStart=30+7+1032=1069 === initialBuf.byteLength
    const payload2bExact = new Uint8Array([9, 10, 11, 12, 13, 14, 15, 16]);

    const zipBytes = buildSyntheticZip({
      entries: [
        {
          name: "001.jpg",
          data: payload2a,
          cdhExtra: new Uint8Array(0),
          lfhExtra: new Uint8Array(1_050).fill(0xaa),
        },
        {
          name: "002.jpg",
          data: payload2b,
          cdhExtra: new Uint8Array(0),
          lfhExtra: new Uint8Array(5_000).fill(0xbb),
        },
        {
          name: "003.jpg",
          data: payload2bExact,
          cdhExtra: new Uint8Array(0),
          lfhExtra: new Uint8Array(1_032).fill(0xcc),
        },
      ],
    });
    const reader = createMemoryReader(zipBytes);
    const entries = await parseZipDirectory(reader);

    // ケース 2a 検証
    reader.reads.length = 0;
    const slice2a = await readCompressedPageSlice(reader, entries[0]);
    expect(slice2a).toEqual(payload2a);
    expect(slice2a.byteOffset).toBe(0);
    expect(slice2a.byteLength).toBe(slice2a.buffer.byteLength);
    expect(reader.reads).toHaveLength(2);
    expect(reader.reads[0].length).toBe(
      30 +
        entries[0].entryNameByteLength +
        entries[0].compressedSize +
        ENGINE_BUDGETS.LFH_EXTRA_MARGIN_BYTES,
    );
    expect(reader.reads[1]).toEqual({
      offset: entries[0].localHeaderOffset + reader.reads[0].length,
      length: 26,
    });

    // ケース 2b 検証（dataStart > initialBuf.byteLength）
    reader.reads.length = 0;
    const slice2b = await readCompressedPageSlice(reader, entries[1]);
    expect(slice2b).toEqual(payload2b);
    expect(slice2b.byteOffset).toBe(0);
    expect(slice2b.byteLength).toBe(slice2b.buffer.byteLength);
    expect(reader.reads).toHaveLength(2);
    expect(reader.reads[1]).toEqual({
      offset: entries[1].localHeaderOffset + 30 + 7 + 5_000,
      length: payload2b.byteLength,
    });

    // ケース 2b 境界検証（dataStart === initialBuf.byteLength）
    reader.reads.length = 0;
    const slice2bExact = await readCompressedPageSlice(reader, entries[2]);
    expect(slice2bExact).toEqual(payload2bExact);
    expect(slice2bExact.byteOffset).toBe(0);
    expect(slice2bExact.byteLength).toBe(slice2bExact.buffer.byteLength);
    expect(reader.reads).toHaveLength(2);
    expect(reader.reads[1]).toEqual({
      offset: entries[2].localHeaderOffset + 30 + 7 + 1_032,
      length: payload2bExact.byteLength,
    });

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      parseZipDirectory(reader, aborted.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      readCompressedPageSlice(reader, entries[0], aborted.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("4GB超ZIP64アーカイブ（128KB内・3RTT超過・0x0001飽和組合せ・非画像エントリ4GB超境界）を完全解析できること (AC-ENG-09)", async () => {
    const virtualShift = 5_000_000_000;
    const payload0 = new Uint8Array([1, 2, 3, 4]);
    const payload1 = new Uint8Array([5, 6, 7, 8, 9]);
    const xmlBytes = new TextEncoder().encode("<ComicInfo/>");

    // 1. 仮想 5GB オフセット上の ZIP64（非画像 ComicInfo.xml を挟み、0x5455 先行 TLV + 0x0001 解決順序も検証）
    const zip64Bytes = buildSyntheticZip({
      virtualOffsetShift: virtualShift,
      entries: [
        {
          name: "001.jpg",
          data: payload0,
          cdhExtraPrefix: buildTlvBlock(
            0x5455,
            new Uint8Array([1, 2, 3, 4, 5]),
          ),
        },
        {
          name: "ComicInfo.xml",
          data: xmlBytes,
        },
        {
          name: "002.jpg",
          data: payload1,
          zip64Extra: {
            uncompressedSize: BigInt(payload1.byteLength),
            compressedSize: BigInt(payload1.byteLength),
            diskStartNumber: 0,
          },
        },
      ],
    });
    const virtualReader = createVirtualOffsetReader(zip64Bytes, virtualShift);
    const entries = await parseZipDirectory(virtualReader);

    expect(virtualReader.reads).toHaveLength(1);
    expect(entries).toHaveLength(2);
    expect(entries[0].localHeaderOffset).toBe(virtualShift);
    // ComicInfo.xml の 64bit localHeaderOffset が先行解決されているため physicalEnd が 5GB+ で正しく境界設定される
    expect(entries[0].physicalEnd).toBeGreaterThan(virtualShift);
    expect(entries[0].physicalEnd).toBeLessThan(entries[1].localHeaderOffset);
    expect(entries[1].localHeaderOffset).toBeGreaterThan(
      entries[0].physicalEnd,
    );

    expect(await readCompressedPageSlice(virtualReader, entries[0])).toEqual(
      payload0,
    );
    expect(await readCompressedPageSlice(virtualReader, entries[1])).toEqual(
      payload1,
    );

    // 2. ZIP64 EOCD Record が末尾128KBより前にある 3 RTT 経路 + 非飽和標準EOCD + 拡張ZIP64データ(sizeOfZip64Eocd > 44)
    const threeRttBytes = buildSyntheticZip({
      zip64: true,
      saturateStandardEocd: false,
      zip64EocdExtensibleData: new Uint8Array(12).fill(0x33),
      betweenZip64EocdAndLocatorBytes: 140_000,
      entries: [
        {
          name: "p1.jpg",
          data: payload0,
          zip64Extra: { compressedSize: BigInt(payload0.byteLength) },
        },
        {
          name: "p2.jpg",
          data: payload1,
          zip64Extra: { uncompressedSize: BigInt(payload1.byteLength) },
        },
        {
          name: "p3.jpg",
          data: payload0,
          zip64Extra: { diskStartNumber: 0 },
        },
      ],
    });
    const threeRttReader = createMemoryReader(threeRttBytes);
    const threeRttEntries = await parseZipDirectory(threeRttReader);
    expect(threeRttReader.reads).toHaveLength(3);
    expect(threeRttReader.reads[1].length).toBe(56);
    expect(threeRttEntries.map((e) => e.entryName)).toEqual([
      "p1.jpg",
      "p2.jpg",
      "p3.jpg",
    ]);
    expect(
      await readCompressedPageSlice(threeRttReader, threeRttEntries[0]),
    ).toEqual(payload0);
  });

  it("空アーカイブ・暗号化・未対応圧縮・未バックアップ飽和値に明示的ZipErrorCodeを送出すること (AC-ENG-04, AC-ENG-09)", async () => {
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

    // Locator のみ存在し ZIP64 EOCD Record 不在 -> CORRUPT_ZIP
    const locatorOnlyZip = buildSyntheticZip({
      entries: [{ name: "001.jpg", data: new Uint8Array([1]) }],
      prependZip64Locator: true,
    });
    await expect(
      parseZipDirectory(createMemoryReader(locatorOnlyZip)),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // Locator 不在かつ標準 EOCD 飽和値またはマルチディスク -> CORRUPT_ZIP
    const eocdCorruptCases = [
      { diskNumber: 1 },
      { cdDiskNumber: 1 },
      { diskEntries: 1, totalEntries: 2 },
      { diskNumber: 0xffff },
      { cdDiskNumber: 0xffff },
      { diskEntries: 0xffff, totalEntries: 0xffff },
      { cdSize: 0xffffffff },
      { cdOffset: 0xffffffff },
    ];
    for (const overrideEocd of eocdCorruptCases) {
      const satZip = buildSyntheticZip({
        entries: [{ name: "001.jpg", data: new Uint8Array([1]) }],
        overrideEocd,
      });
      await expect(
        parseZipDirectory(createMemoryReader(satZip)),
      ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });
    }

    // CDH 飽和で 0x0001 Extra Field 不在 -> CORRUPT_ZIP
    const cdhSatCases = [
      { overrideCdhCompressedSize: 0xffffffff },
      { overrideCdhUncompressedSize: 0xffffffff },
      { overrideCdhLocalHeaderOffset: 0xffffffff },
      { overrideCdhDiskStartNumber: 0xffff },
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
      ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });
    }
  });

  it("ZIP64境界異常（マルチディスク・安全整数超過・56B境界・totalEntries*46>cdSize・0x0001破損・非画像エントリ破損）でCORRUPT_ZIPを送出すること (AC-ENG-09)", async () => {
    const baseEntry = { name: "001.jpg", data: new Uint8Array([1]) };

    // 1. totalEntries * 46 > cdSize (diskEntries === totalEntries で標準EOCD・ZIP64双方)
    await expect(
      parseZipDirectory(
        createMemoryReader(
          buildSyntheticZip({
            entries: [baseEntry],
            overrideEocd: { diskEntries: 2, totalEntries: 2 },
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    await expect(
      parseZipDirectory(
        createMemoryReader(
          buildSyntheticZip({
            zip64: true,
            entries: [baseEntry],
            overrideZip64Eocd: {
              diskEntries: 2n,
              totalEntries: 2n,
            },
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 2. Locator 存在時の標準 EOCD 非飽和ディスク異常
    for (const overrideEocd of [
      { diskNumber: 1 },
      { cdDiskNumber: 1 },
      { diskEntries: 1, totalEntries: 2 },
    ]) {
      await expect(
        parseZipDirectory(
          createMemoryReader(
            buildSyntheticZip({
              zip64: true,
              entries: [baseEntry],
              overrideEocd,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });
    }

    // 3. ZIP64 Locator 自体の異常（disk/totalDisks/安全整数超過/56B事前境界違反）
    const maxSafePlus1 = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    const locatorInvalidCases = [
      { locatorDiskNumber: 1 },
      { totalDisks: 2 },
      { totalDisks: 0 },
      { zip64EocdOffset: maxSafePlus1 },
    ];
    for (const overrideZip64Locator of locatorInvalidCases) {
      await expect(
        parseZipDirectory(
          createMemoryReader(
            buildSyntheticZip({
              zip64: true,
              entries: [baseEntry],
              overrideZip64Locator,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });
    }

    // 事前境界: zip64EocdOffset + 56 > eocdAbsoluteOffset - 20
    const preBoundaryZip = buildSyntheticZip({
      zip64: true,
      entries: [baseEntry],
    });
    const preBoundaryView = new DataView(preBoundaryZip.buffer);
    const locatorPos = preBoundaryZip.byteLength - 22 - 20;
    preBoundaryView.setBigUint64(locatorPos + 8, BigInt(locatorPos - 55), true);
    await expect(
      parseZipDirectory(createMemoryReader(preBoundaryZip)),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 4. zip64EocdOffset < tailStart 時の 56B 追加読込が短サイズを返した場合
    const threeRttShortZip = buildSyntheticZip({
      zip64: true,
      betweenZip64EocdAndLocatorBytes: 140_000,
      entries: [baseEntry],
    });
    let z64ReadCall = 0;
    const shortZ64Reader: RandomAccessReader = {
      sourceId: "short-z64",
      totalSize: threeRttShortZip.byteLength,
      async readRange(offset, length) {
        z64ReadCall += 1;
        if (z64ReadCall === 2) {
          return new Uint8Array(10);
        }
        return threeRttShortZip.slice(offset, offset + length);
      },
    };
    await expect(parseZipDirectory(shortZ64Reader)).rejects.toMatchObject({
      code: "CORRUPT_ZIP",
    });

    // 5. ZIP64 EOCD Record 内部異常
    const z64EocdInvalidCases = [
      { signature: 0x12345678 },
      { sizeOfZip64Eocd: maxSafePlus1 },
      { sizeOfZip64Eocd: 43n },
      { diskNumber: 1 },
      { cdDiskNumber: 1 },
      { diskEntries: maxSafePlus1 },
      { totalEntries: maxSafePlus1 },
      { diskEntries: 1n, totalEntries: 2n },
      { cdSize: maxSafePlus1 },
      { cdOffset: maxSafePlus1 },
      { cdSize: 9999n },
    ];
    for (const overrideZip64Eocd of z64EocdInvalidCases) {
      await expect(
        parseZipDirectory(
          createMemoryReader(
            buildSyntheticZip({
              zip64: true,
              entries: [baseEntry],
              overrideZip64Eocd,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });
    }

    // 6. CDH diskStartNumber !== 0（非飽和・飽和・非画像エントリ先行検査）
    await expect(
      parseZipDirectory(
        createMemoryReader(
          buildSyntheticZip({
            entries: [{ ...baseEntry, overrideCdhDiskStartNumber: 1 }],
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    await expect(
      parseZipDirectory(
        createMemoryReader(
          buildSyntheticZip({
            entries: [
              baseEntry,
              {
                name: "ComicInfo.xml",
                data: new Uint8Array([1]),
                overrideCdhDiskStartNumber: 2,
              },
            ],
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    await expect(
      parseZipDirectory(
        createMemoryReader(
          buildSyntheticZip({
            zip64: true,
            entries: [
              {
                ...baseEntry,
                zip64Extra: { diskStartNumber: 1 },
              },
            ],
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 非画像エントリが localHeaderOffset=0xffffffff かつ 0x0001 不在でも isJunkOrNonImageEntry 前に CORRUPT_ZIP
    await expect(
      parseZipDirectory(
        createMemoryReader(
          buildSyntheticZip({
            entries: [
              baseEntry,
              {
                name: "ComicInfo.xml",
                data: new Uint8Array([1]),
                overrideCdhLocalHeaderOffset: 0xffffffff,
              },
            ],
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 7. 0x0001 Extra Field TLV 異常・長不足・安全整数超過
    const nonZip64ExtraOnly = buildTlvBlock(0x5455, new Uint8Array(8));
    const truncatedTlv = new Uint8Array([0x55, 0x54, 0x20, 0x00, 0x01]); // declares 32 bytes but only 1 byte
    const overflowTlvZip = buildSyntheticZip({
      entries: [
        {
          ...baseEntry,
          overrideCdhCompressedSize: 0xffffffff,
          cdhExtra: truncatedTlv,
        },
      ],
    });
    await expect(
      parseZipDirectory(createMemoryReader(overflowTlvZip)),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    const nonZip64OnlyZip = buildSyntheticZip({
      entries: [
        {
          ...baseEntry,
          overrideCdhCompressedSize: 0xffffffff,
          cdhExtra: nonZip64ExtraOnly,
        },
      ],
    });
    await expect(
      parseZipDirectory(createMemoryReader(nonZip64OnlyZip)),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    const short0001Cases = [
      {
        overrideCdhUncompressedSize: 0xffffffff,
        cdhExtra: buildTlvBlock(0x0001, new Uint8Array(4)),
      },
      {
        overrideCdhUncompressedSize: 0xffffffff,
        overrideCdhCompressedSize: 0xffffffff,
        cdhExtra: buildTlvBlock(0x0001, new Uint8Array(12)),
      },
      {
        overrideCdhUncompressedSize: 0xffffffff,
        overrideCdhCompressedSize: 0xffffffff,
        overrideCdhLocalHeaderOffset: 0xffffffff,
        cdhExtra: buildTlvBlock(0x0001, new Uint8Array(20)),
      },
      {
        overrideCdhUncompressedSize: 0xffffffff,
        overrideCdhCompressedSize: 0xffffffff,
        overrideCdhLocalHeaderOffset: 0xffffffff,
        overrideCdhDiskStartNumber: 0xffff,
        cdhExtra: buildTlvBlock(0x0001, new Uint8Array(26)),
      },
    ];
    for (const shortCase of short0001Cases) {
      await expect(
        parseZipDirectory(
          createMemoryReader(
            buildSyntheticZip({
              zip64: true,
              entries: [{ ...baseEntry, ...shortCase }],
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });
    }

    const maxSafe0001Cases = [
      { uncompressedSize: maxSafePlus1 },
      { compressedSize: maxSafePlus1 },
      { localHeaderOffset: maxSafePlus1 },
    ];
    for (const zip64Extra of maxSafe0001Cases) {
      await expect(
        parseZipDirectory(
          createMemoryReader(
            buildSyntheticZip({
              zip64: true,
              entries: [{ ...baseEntry, zip64Extra }],
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });
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

    // 6. totalEntries*46 <= cdSize を満たすが 2エントリ目のCDH固定ヘッダ途中で終端する破損CD
    const paddedCdZip = buildSyntheticZip({
      entries: [
        {
          name: "a".repeat(50) + ".jpg",
          data: new Uint8Array([1]),
          cdhComment: new Uint8Array(20),
        },
      ],
      overrideEocd: { diskEntries: 2, totalEntries: 2 },
    });
    await expect(
      parseZipDirectory(createMemoryReader(paddedCdZip)),
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

  it("readCompressedPageSliceのLFH境界異常・シグネチャ不一致・2回目読込不足（ケース2a/2b双方）でCORRUPT_ZIPを送出すること (AC-ENG-05, AC-ENG-10)", async () => {
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

    // 6a. ケース2a（dataStart < initialBuf.byteLength）の2回目読込が不足
    const case2aZip = buildSyntheticZip({
      entries: [
        {
          name: "001.jpg",
          data: new Uint8Array(2_000).fill(0x2a),
          lfhExtra: new Uint8Array(1_050).fill(0x44),
        },
      ],
    });
    const case2aEntries = await parseZipDirectory(
      createMemoryReader(case2aZip),
    );
    let case2aReadCount = 0;
    const truncated2aReader: RandomAccessReader = {
      sourceId: "truncated-2a",
      totalSize: case2aZip.byteLength,
      async readRange(offset, length) {
        case2aReadCount += 1;
        if (case2aReadCount === 2) {
          return new Uint8Array(1);
        }
        return case2aZip.slice(offset, offset + length);
      },
    };
    await expect(
      readCompressedPageSlice(truncated2aReader, case2aEntries[0]),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 6b. ケース2b（dataStart >= initialBuf.byteLength）の2回目直接読込が不足
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

  it("画像エントリ間に非画像・ゴミエントリ(ComicInfo.xml/Thumbs.db)が挟まる場合も全CDH基準でphysicalEndを境界設定し越境読込を防ぐこと (AC-ENG-05)", async () => {
    const payload0 = new Uint8Array([1, 2, 3, 4]);
    const xmlPayload = new TextEncoder().encode("<ComicInfo/>");
    const payload1 = new Uint8Array([5, 6, 7, 8]);
    const thumbsPayload = new Uint8Array([9, 10, 11, 12]);

    // 物理配置順: 001.jpg (offset 0) -> ComicInfo.xml (offset 41) -> 002.jpg (offset 96) -> Thumbs.db (offset 137) -> CD
    const normalZip = buildSyntheticZip({
      entries: [
        { name: "001.jpg", data: payload0 },
        { name: "ComicInfo.xml", data: xmlPayload },
        { name: "002.jpg", data: payload1 },
        { name: "chapter/Thumbs.db", data: thumbsPayload },
      ],
    });
    const normalReader = createMemoryReader(normalZip);
    const normalEntries = await parseZipDirectory(normalReader);

    expect(normalEntries.map((e) => e.entryName)).toEqual([
      "001.jpg",
      "002.jpg",
    ]);
    // 001.jpg の physicalEnd は 002.jpg ではなく直後の ComicInfo.xml 開始位置 (41)
    expect(normalEntries[0].localHeaderOffset).toBe(0);
    expect(normalEntries[0].physicalEnd).toBe(41);
    expect(normalEntries[0].physicalEnd).toBeLessThan(
      normalEntries[1].localHeaderOffset,
    );
    // 002.jpg の physicalEnd は CD ではなく直後の chapter/Thumbs.db 開始位置 (137)
    expect(normalEntries[1].localHeaderOffset).toBe(96);
    expect(normalEntries[1].physicalEnd).toBe(137);
    expect(
      await readCompressedPageSlice(normalReader, normalEntries[0]),
    ).toEqual(payload0);
    expect(
      await readCompressedPageSlice(normalReader, normalEntries[1]),
    ).toEqual(payload1);

    // 001.jpg の LFH が直後の ComicInfo.xml 境界 (41) を超える過大な extraFieldLength を主張した場合、越境読込せず CORRUPT_ZIP を送出すること
    const overflowIntoNonImageZip = buildSyntheticZip({
      entries: [
        { name: "001.jpg", data: payload0, overrideLfhExtraLength: 50 },
        { name: "ComicInfo.xml", data: xmlPayload },
        { name: "002.jpg", data: payload1 },
      ],
    });
    const overflowReader = createMemoryReader(overflowIntoNonImageZip);
    const overflowEntries = await parseZipDirectory(overflowReader);
    overflowReader.reads.length = 0;

    await expect(
      readCompressedPageSlice(overflowReader, overflowEntries[0]),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });
    expect(overflowReader.reads).toHaveLength(1);
    expect(overflowReader.reads[0]).toEqual({ offset: 0, length: 41 });

    // 非画像エントリが cdOffset 以上の不正オフセットを持っていても範囲外として無視し、末尾有効画像は cdOffset を上限とすること
    const outOfRangeJunkZip = buildSyntheticZip({
      entries: [
        { name: "001.jpg", data: payload0 },
        {
          name: "ComicInfo.xml",
          data: xmlPayload,
          overrideCdhLocalHeaderOffset: 99999,
        },
      ],
    });
    const outOfRangeView = new DataView(outOfRangeJunkZip.buffer);
    const expectedCdOffset = outOfRangeView.getUint32(
      outOfRangeJunkZip.byteLength - 6,
      true,
    );
    const outOfRangeEntries = await parseZipDirectory(
      createMemoryReader(outOfRangeJunkZip),
    );
    expect(outOfRangeEntries[0].physicalEnd).toBe(expectedCdOffset);
  });

  it("全CDHエントリのcdOffset未満範囲でlocalHeaderOffsetが重複している場合はCORRUPT_ZIPを送出すること (AC-ENG-04, AC-ENG-05)", async () => {
    // 1. 有効画像と非画像エントリが同一 localHeaderOffset を主張
    const imageAndJunkDupZip = buildSyntheticZip({
      entries: [
        { name: "001.jpg", data: new Uint8Array([1, 2, 3, 4]) },
        {
          name: "ComicInfo.xml",
          data: new Uint8Array([5, 6]),
          overrideCdhLocalHeaderOffset: 0,
        },
      ],
    });
    await expect(
      parseZipDirectory(createMemoryReader(imageAndJunkDupZip)),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 2. 有効画像同士が同一 localHeaderOffset を主張
    const imageDupZip = buildSyntheticZip({
      entries: [
        { name: "001.jpg", data: new Uint8Array([1, 2, 3, 4]) },
        {
          name: "002.jpg",
          data: new Uint8Array([5, 6, 7, 8]),
          overrideCdhLocalHeaderOffset: 0,
        },
      ],
    });
    await expect(
      parseZipDirectory(createMemoryReader(imageDupZip)),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });

    // 3. ゴミ・非画像エントリ同士が同一 localHeaderOffset を主張（画像ゼロ件でも CORRUPT_ZIP を優先）
    const junkDupZip = buildSyntheticZip({
      entries: [
        { name: "README.txt", data: new Uint8Array([1]) },
        {
          name: "Thumbs.db",
          data: new Uint8Array([2]),
          overrideCdhLocalHeaderOffset: 0,
        },
      ],
    });
    await expect(
      parseZipDirectory(createMemoryReader(junkDupZip)),
    ).rejects.toMatchObject({ code: "CORRUPT_ZIP" });
  });
});
