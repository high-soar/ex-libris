import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { createMemoryReader } from "../src/engine/zip/__fixtures__/zipBuilder";
import {
  parseZipDirectory,
  readCompressedPageSlice,
} from "../src/engine/zip/zipParser";
import {
  buildDeterministicCp932Zip64,
  buildHo05Cp932Zip64TestArchive,
  buildHo07MaxTextureTestArchive,
  buildHo08ShaderSeekTestArchive,
  computeCrc32,
  MANUAL_TEST_ARCHIVES,
  writeManualTestArchives,
} from "./generate-manual-test-archives.mjs";

const repoRoot = process.cwd();

interface ZipEntryMeta {
  name: string;
  data: Uint8Array;
}

function readStoreZipEntries(zipBytes: Uint8Array): ZipEntryMeta[] {
  const buf = Buffer.from(zipBytes);
  const entries: ZipEntryMeta[] = [];
  let offset = 0;
  while (offset + 4 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const crc = buf.readUInt32LE(offset + 14);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString("utf8");
    const data = buf.subarray(dataStart, dataEnd);
    expect(computeCrc32(data)).toBe(crc);
    entries.push({ name, data });
    offset = dataEnd;
  }
  return entries;
}

function readPngDimensions(pngBytes: Uint8Array): {
  width: number;
  height: number;
} {
  const buf = Buffer.from(pngBytes);
  expect(buf.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function readNoFilterRgbaPngPixel(
  pngBytes: Uint8Array,
  x: number,
  y: number,
): [number, number, number, number] {
  const buf = Buffer.from(pngBytes);
  const { width } = readPngDimensions(buf);
  let cursor = 8;
  const idatParts: Buffer[] = [];
  while (cursor + 12 <= buf.length) {
    const len = buf.readUInt32BE(cursor);
    const type = buf.subarray(cursor + 4, cursor + 8).toString("ascii");
    const data = buf.subarray(cursor + 8, cursor + 8 + len);
    if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    cursor += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatParts));
  const stride = 1 + width * 4;
  const offset = y * stride + 1 + x * 4;
  return [raw[offset], raw[offset + 1], raw[offset + 2], raw[offset + 3]];
}

describe("generate-manual-test-archives", () => {
  it("buildDeterministicCp932Zip64 と buildHo05Cp932Zip64TestArchive が CP932 復元・自然順・__MACOSX 除外・ZIP64 飽和構造を満たすこと", async () => {
    const samplePayload = new Uint8Array([1, 2, 3, 4]);
    const rawZip64 = buildDeterministicCp932Zip64([
      {
        name: new Uint8Array([0x82, 0xa0, 0x2e, 0x70, 0x6e, 0x67]), // "あ.png"
        data: samplePayload,
        flags: 0,
      },
    ]);
    expect(rawZip64.byteLength).toBeGreaterThan(22 + 20 + 56);

    const archive = buildHo05Cp932Zip64TestArchive();
    const buf = Buffer.from(archive);

    // 末尾構造: ZIP64 EOCD Record (56B) + ZIP64 EOCD Locator (20B) + 飽和 Standard EOCD (22B)
    const stdEocdOffset = buf.length - 22;
    const locatorOffset = stdEocdOffset - 20;
    const z64EocdOffset = locatorOffset - 56;

    expect(buf.readUInt32LE(stdEocdOffset)).toBe(0x06054b50);
    expect(buf.readUInt16LE(stdEocdOffset + 4)).toBe(0xffff);
    expect(buf.readUInt16LE(stdEocdOffset + 6)).toBe(0xffff);
    expect(buf.readUInt16LE(stdEocdOffset + 8)).toBe(0xffff);
    expect(buf.readUInt16LE(stdEocdOffset + 10)).toBe(0xffff);
    expect(buf.readUInt32LE(stdEocdOffset + 12)).toBe(0xffffffff);
    expect(buf.readUInt32LE(stdEocdOffset + 16)).toBe(0xffffffff);

    expect(buf.readUInt32LE(locatorOffset)).toBe(0x07064b50);
    expect(buf.readBigUInt64LE(locatorOffset + 8)).toBe(BigInt(z64EocdOffset));
    expect(buf.readUInt32LE(locatorOffset + 16)).toBe(1);

    expect(buf.readUInt32LE(z64EocdOffset)).toBe(0x06064b50);
    expect(buf.readBigUInt64LE(z64EocdOffset + 4)).toBe(44n);
    expect(buf.readBigUInt64LE(z64EocdOffset + 24)).toBe(5n);
    expect(buf.readBigUInt64LE(z64EocdOffset + 32)).toBe(5n);
    const cdSize = Number(buf.readBigUInt64LE(z64EocdOffset + 40));
    const cdOffset = Number(buf.readBigUInt64LE(z64EocdOffset + 48));
    expect(cdOffset + cdSize).toBe(z64EocdOffset);

    // 各 CDH が 0xFFFFFFFF 飽和 + 24B 0x0001 Extra Field を持ち、GPBF Bit 11 = 0 であること
    let cursor = cdOffset;
    let cdhCount = 0;
    while (cursor < z64EocdOffset) {
      expect(buf.readUInt32LE(cursor)).toBe(0x02014b50);
      expect(buf.readUInt16LE(cursor + 8) & 0x0800).toBe(0);
      expect(buf.readUInt32LE(cursor + 20)).toBe(0xffffffff);
      expect(buf.readUInt32LE(cursor + 24)).toBe(0xffffffff);
      expect(buf.readUInt32LE(cursor + 42)).toBe(0xffffffff);
      const nameLen = buf.readUInt16LE(cursor + 28);
      const extraLen = buf.readUInt16LE(cursor + 30);
      const commentLen = buf.readUInt16LE(cursor + 32);
      expect(extraLen).toBe(28);
      const extraStart = cursor + 46 + nameLen;
      expect(buf.readUInt16LE(extraStart)).toBe(0x0001);
      expect(buf.readUInt16LE(extraStart + 2)).toBe(24);
      cursor += 46 + nameLen + extraLen + commentLen;
      cdhCount += 1;
    }
    expect(cdhCount).toBe(5);

    // 実 parseZipDirectory + readCompressedPageSlice による CP932 復元・自然順・__MACOSX 除外・ZIP64 飽和解除検証
    const reader = createMemoryReader(
      archive,
      "manual:ho05-cp932-zip64-test.cbz",
    );
    const entries = await parseZipDirectory(reader);

    expect(entries.map((entry) => entry.entryName)).toEqual([
      "第1話/001.png",
      "第1話/①特典.png",
      "第2話/002.png",
      "第10話/010.png",
    ]);
    // 物理格納順は逆順（010 -> 002 -> ①特典 -> 001）であること
    expect(entries[3].localHeaderOffset).toBeLessThan(
      entries[2].localHeaderOffset,
    );
    expect(entries[2].localHeaderOffset).toBeLessThan(
      entries[1].localHeaderOffset,
    );
    expect(entries[1].localHeaderOffset).toBeLessThan(
      entries[0].localHeaderOffset,
    );

    const expectedBodyColors: readonly [number, number, number, number][] = [
      [239, 68, 68, 255], // p.1: 赤
      [234, 179, 8, 255], // p.2: 黄
      [16, 185, 129, 255], // p.3: 緑
      [37, 99, 235, 255], // p.4: 青
    ];

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const slice = await readCompressedPageSlice(reader, entry);
      const pngBytes =
        entry.compressionMethod === 8 ? zlib.inflateRawSync(slice) : slice;
      expect(readPngDimensions(pngBytes)).toEqual({ width: 600, height: 900 });
      expect(readNoFilterRgbaPngPixel(pngBytes, 300, 450)).toEqual(
        expectedBodyColors[i],
      );
      // 上部ヘッダーの i+1 個目ドット (x = 24 + i * 24 + 4, y = 26) が濃色 [15,23,42,255] で、i+2 個目位置は背景色 [248,250,252,255]
      expect(readNoFilterRgbaPngPixel(pngBytes, 24 + i * 24 + 4, 26)).toEqual([
        15, 23, 42, 255,
      ]);
      expect(
        readNoFilterRgbaPngPixel(pngBytes, 24 + (i + 1) * 24 + 4, 26),
      ).toEqual([248, 250, 252, 255]);
    }
  });

  it("リポジトリ内の test/fixtures/manual/ho05-cp932-zip64-test.cbz が生成結果とバイナリ完全一致すること", () => {
    const fixturePath = path.resolve(
      repoRoot,
      "test/fixtures/manual/ho05-cp932-zip64-test.cbz",
    );
    expect(fs.existsSync(fixturePath)).toBe(true);
    const committed = fs.readFileSync(fixturePath);
    const generated = buildHo05Cp932Zip64TestArchive();
    expect(committed.equals(generated)).toBe(true);
  });

  it("ho07-max-texture-test.cbz が 6 ページ構成と 8448x256 / 16640x256 の有効 PNG を含むこと", () => {
    const archive = buildHo07MaxTextureTestArchive();
    const entries = readStoreZipEntries(archive);

    expect(entries.map((entry) => entry.name)).toEqual([
      "001.png",
      "002.png",
      "003.png",
      "004_over8192.png",
      "005_over16384.png",
      "006.png",
    ]);

    expect(readPngDimensions(entries[0].data)).toEqual({
      width: 600,
      height: 900,
    });
    expect(readPngDimensions(entries[3].data)).toEqual({
      width: 8448,
      height: 256,
    });
    expect(readPngDimensions(entries[4].data)).toEqual({
      width: 16640,
      height: 256,
    });
  });

  it("リポジトリ内の test/fixtures/manual/ho07-max-texture-test.cbz が生成結果とバイナリ完全一致すること", () => {
    const fixturePath = path.resolve(
      repoRoot,
      "test/fixtures/manual/ho07-max-texture-test.cbz",
    );
    expect(fs.existsSync(fixturePath)).toBe(true);
    const committed = fs.readFileSync(fixturePath);
    const generated = buildHo07MaxTextureTestArchive();
    expect(committed.equals(generated)).toBe(true);
  });

  it("ho08-shader-seek-test.cbz が 20 ページ構成・解像度・4象限シェーダーラボ画素値を含むこと", () => {
    const archive = buildHo08ShaderSeekTestArchive();
    const entries = readStoreZipEntries(archive);

    expect(entries).toHaveLength(20);
    expect(entries.map((entry) => entry.name)).toEqual([
      "001_cover_shader_lab.png",
      "002_yellow_paper.png",
      "003_thin_ink.png",
      "004.png",
      "005.png",
      "006.png",
      "007.png",
      "008.png",
      "009.png",
      "010_landscape_spread.png",
      "011.png",
      "012.png",
      "013.png",
      "014.png",
      "015.png",
      "016.png",
      "017.png",
      "018.png",
      "019.png",
      "020_end.png",
    ]);

    entries.forEach((entry, index) => {
      if (index === 9) {
        expect(readPngDimensions(entry.data)).toEqual({
          width: 1200,
          height: 800,
        });
      } else {
        expect(readPngDimensions(entry.data)).toEqual({
          width: 600,
          height: 900,
        });
      }
    });

    const labPng = entries[0].data;
    // 左上: 黄ばみ紙色
    expect(readNoFilterRgbaPngPixel(labPng, 60, 40)).toEqual([
      235, 228, 212, 255,
    ]);
    // 右上: 裏写り暗灰
    expect(readNoFilterRgbaPngPixel(labPng, 340, 40)).toEqual([
      42, 42, 42, 255,
    ]);
    // 左下: 薄墨グレー
    expect(readNoFilterRgbaPngPixel(labPng, 150, 675)).toEqual([
      128, 128, 128, 255,
    ]);
    // 右下: 鋭い階段エッジ (80 / 180)
    expect(readNoFilterRgbaPngPixel(labPng, 350, 520)).toEqual([
      80, 80, 80, 255,
    ]);
    expect(readNoFilterRgbaPngPixel(labPng, 520, 520)).toEqual([
      180, 180, 180, 255,
    ]);
  });

  it("リポジトリ内の test/fixtures/manual/ho08-shader-seek-test.cbz が生成結果とバイナリ完全一致すること", () => {
    const fixturePath = path.resolve(
      repoRoot,
      "test/fixtures/manual/ho08-shader-seek-test.cbz",
    );
    expect(fs.existsSync(fixturePath)).toBe(true);
    const committed = fs.readFileSync(fixturePath);
    const generated = buildHo08ShaderSeekTestArchive();
    expect(committed.equals(generated)).toBe(true);
  });

  it("writeManualTestArchives が一時ディレクトリへ定義済み 3 アーカイブを書き出せること", () => {
    const tmpDir = fs.mkdtempSync("/tmp/ex-libris-manual-fixtures-");
    try {
      const written = writeManualTestArchives(tmpDir);
      expect(written).toHaveLength(MANUAL_TEST_ARCHIVES.length);
      expect(MANUAL_TEST_ARCHIVES.map((spec) => spec.filename)).toEqual([
        "ho05-cp932-zip64-test.cbz",
        "ho07-max-texture-test.cbz",
        "ho08-shader-seek-test.cbz",
      ]);
      for (const writtenPath of written) {
        expect(fs.existsSync(writtenPath)).toBe(true);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
