import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
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

  it("writeManualTestArchives が一時ディレクトリへ定義済み全アーカイブを書き出せること", () => {
    const tmpDir = fs.mkdtempSync("/tmp/ex-libris-manual-fixtures-");
    try {
      const written = writeManualTestArchives(tmpDir);
      expect(written).toHaveLength(MANUAL_TEST_ARCHIVES.length);
      expect(MANUAL_TEST_ARCHIVES.map((spec) => spec.filename)).toEqual([
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
