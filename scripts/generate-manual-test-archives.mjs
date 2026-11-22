#!/usr/bin/env node
/**
 * 手動実機検証用サンプルアーカイブ（test/fixtures/manual/）の決定論的生成スクリプト。
 *
 * Usage:
 *   node scripts/generate-manual-test-archives.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = buildCrc32Table();

/**
 * CRC-32 を算出する
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function computeCrc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(computeCrc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

/**
 * 左右 2 色（中央白境界線付き）の 8bit RGBA PNG を決定論的に生成する
 * @param {readonly [number, number, number, number]} leftRgba
 * @param {readonly [number, number, number, number]} rightRgba
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
export function createSplitSamplePng(leftRgba, rightRgba, width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = 1 + width * 4;
  const row = Buffer.alloc(stride);
  row[0] = 0; // filter none
  const mid = Math.floor(width / 2);
  const seamHalf = Math.min(8, Math.floor(width / 20));
  const isTwoTone =
    leftRgba[0] !== rightRgba[0] ||
    leftRgba[1] !== rightRgba[1] ||
    leftRgba[2] !== rightRgba[2] ||
    leftRgba[3] !== rightRgba[3];

  for (let x = 0; x < width; x += 1) {
    const off = 1 + x * 4;
    let color = x < mid ? leftRgba : rightRgba;
    if (isTwoTone && Math.abs(x - mid) < seamHalf) {
      color = [255, 255, 255, 255];
    }
    row[off] = color[0];
    row[off + 1] = color[1];
    row[off + 2] = color[2];
    row[off + 3] = color[3];
  }

  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    row.copy(raw, y * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", idat),
    makePngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Store 圧縮（UTF-8 フラグ付き）で ZIP/CBZ バイト列を組み立てる
 * @param {readonly { name: string; data: Uint8Array }[]} entries
 * @returns {Buffer}
 */
export function buildDeterministicStoreZip(entries) {
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const crc = computeCrc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8); // Store
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    locals.push(localHeader, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centrals.push(central, nameBytes);
    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/**
 * HO-07 実機検証用: MAX_TEXTURE_SIZE（4096/8192/16384）超過画像を含む 6 ページ CBZ を生成する
 * @returns {Buffer}
 */
export function buildHo07MaxTextureTestArchive() {
  const blue = [30, 80, 200, 255];
  const green = [30, 180, 90, 255];
  const purple = [160, 60, 200, 255];
  const red = [230, 40, 40, 255];
  const cyan = [40, 210, 230, 255];
  const gold = [245, 165, 25, 255];
  const magenta = [225, 45, 185, 255];
  const teal = [20, 140, 140, 255];

  return buildDeterministicStoreZip([
    { name: "001.png", data: createSplitSamplePng(blue, blue, 600, 900) },
    { name: "002.png", data: createSplitSamplePng(green, green, 600, 900) },
    { name: "003.png", data: createSplitSamplePng(purple, purple, 600, 900) },
    {
      name: "004_over8192.png",
      data: createSplitSamplePng(red, cyan, 8448, 256),
    },
    {
      name: "005_over16384.png",
      data: createSplitSamplePng(gold, magenta, 16640, 256),
    },
    { name: "006.png", data: createSplitSamplePng(teal, teal, 600, 900) },
  ]);
}

export const MANUAL_TEST_ARCHIVES = [
  {
    filename: "ho07-max-texture-test.cbz",
    build: buildHo07MaxTextureTestArchive,
  },
];

/**
 * 手動検証用テストアーカイブ一式を指定ディレクトリへ書き出す
 * @param {string} [outputDir]
 * @returns {string[]}
 */
export function writeManualTestArchives(
  outputDir = path.resolve(process.cwd(), "test/fixtures/manual"),
) {
  fs.mkdirSync(outputDir, { recursive: true });
  const writtenPaths = [];
  for (const spec of MANUAL_TEST_ARCHIVES) {
    const targetPath = path.join(outputDir, spec.filename);
    fs.writeFileSync(targetPath, spec.build());
    writtenPaths.push(targetPath);
  }
  return writtenPaths;
}

const isCliEntry =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCliEntry) {
  const paths = writeManualTestArchives();
  for (const filePath of paths) {
    const stat = fs.statSync(filePath);
    console.log(
      `Generated ${path.relative(process.cwd(), filePath)} (${stat.size} bytes)`,
    );
  }
}
