import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHo07MaxTextureTestArchive,
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

  it("writeManualTestArchives が一時ディレクトリへ定義済み全アーカイブを書き出せること", () => {
    const tmpDir = fs.mkdtempSync("/tmp/ex-libris-manual-fixtures-");
    try {
      const written = writeManualTestArchives(tmpDir);
      expect(written).toHaveLength(MANUAL_TEST_ARCHIVES.length);
      for (const writtenPath of written) {
        expect(fs.existsSync(writtenPath)).toBe(true);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
