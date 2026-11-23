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
 * CP932(Shift_JIS)およびZIP64構造でZIP/CBZバイト列を組み立てる（Redスタブ）
 * @param {readonly { name: string | Uint8Array; data: Uint8Array; flags?: number; compressionMethod?: 0 | 8 }[]} entries
 * @returns {Buffer}
 */
export function buildDeterministicCp932Zip64(entries) {
  void entries;
  return Buffer.alloc(0);
}

/**
 * HO-05 実機検証用: CP932(GPBF Bit11=0)・__MACOSX除外・物理逆順・ZIP64飽和構造の 4 ページ CBZ を生成する（Redスタブ）
 * @returns {Buffer}
 */
export function buildHo05Cp932Zip64TestArchive() {
  return Buffer.alloc(0);
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

function createBlankRgbaRaw(width, height) {
  const stride = 1 + width * 4;
  return Buffer.alloc(stride * height);
}

function fillRgbaRect(raw, width, height, x0, y0, x1, y1, rgba) {
  const startX = Math.max(0, Math.floor(x0));
  const endX = Math.min(width, Math.floor(x1));
  const startY = Math.max(0, Math.floor(y0));
  const endY = Math.min(height, Math.floor(y1));
  if (startX >= endX || startY >= endY) {
    return;
  }
  const stride = 1 + width * 4;
  for (let y = startY; y < endY; y += 1) {
    const rowBase = y * stride;
    for (let x = startX; x < endX; x += 1) {
      const off = rowBase + 1 + x * 4;
      raw[off] = rgba[0];
      raw[off + 1] = rgba[1];
      raw[off + 2] = rgba[2];
      raw[off + 3] = rgba[3];
    }
  }
}

function encodeRgbaRawToPng(width, height, raw) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", idat),
    makePngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * 自炊画質補正テストラボ（4象限パターン）PNG を決定論的に生成する
 * - 左上: 黄ばみ紙色 rgba(235, 228, 212, 255) + 濃インク細帯
 * - 右上: 裏写り暗灰 rgba(42, 42, 42, 255) + 暗部階調帯
 * - 左下: 薄墨グレー rgba(128, 128, 128, 255) + 中間調階調帯
 * - 右下: 鋭い階段エッジ / 細線パターン (80 / 180)
 * @param {number} [width]
 * @param {number} [height]
 * @returns {Buffer}
 */
export function createShaderLabPng(width = 600, height = 900) {
  const raw = createBlankRgbaRaw(width, height);
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);

  // 左上: 黄ばみ紙色
  const yellowPaper = [235, 228, 212, 255];
  const inkDark = [32, 32, 32, 255];
  const subtleStain = [214, 206, 188, 255];
  fillRgbaRect(raw, width, height, 0, 0, midX, midY, yellowPaper);
  fillRgbaRect(
    raw,
    width,
    height,
    Math.floor(midX * 0.15),
    Math.floor(midY * 0.22),
    Math.floor(midX * 0.85),
    Math.floor(midY * 0.26),
    inkDark,
  );
  fillRgbaRect(
    raw,
    width,
    height,
    Math.floor(midX * 0.15),
    Math.floor(midY * 0.34),
    Math.floor(midX * 0.72),
    Math.floor(midY * 0.38),
    inkDark,
  );
  fillRgbaRect(
    raw,
    width,
    height,
    Math.floor(midX * 0.15),
    Math.floor(midY * 0.72),
    Math.floor(midX * 0.85),
    Math.floor(midY * 0.82),
    subtleStain,
  );

  // 右上: 裏写り暗灰
  const bleedDark = [42, 42, 42, 255];
  const nearBlack = [16, 16, 16, 255];
  const darkMid = [72, 72, 72, 255];
  const lightRef = [220, 220, 220, 255];
  fillRgbaRect(raw, width, height, midX, 0, width, midY, bleedDark);
  fillRgbaRect(
    raw,
    width,
    height,
    midX + Math.floor((width - midX) * 0.15),
    Math.floor(midY * 0.2),
    midX + Math.floor((width - midX) * 0.85),
    Math.floor(midY * 0.28),
    nearBlack,
  );
  fillRgbaRect(
    raw,
    width,
    height,
    midX + Math.floor((width - midX) * 0.15),
    Math.floor(midY * 0.36),
    midX + Math.floor((width - midX) * 0.85),
    Math.floor(midY * 0.44),
    darkMid,
  );
  fillRgbaRect(
    raw,
    width,
    height,
    midX + Math.floor((width - midX) * 0.15),
    Math.floor(midY * 0.72),
    midX + Math.floor((width - midX) * 0.85),
    Math.floor(midY * 0.8),
    lightRef,
  );

  // 左下: 薄墨グレー (ガンマ確認)
  const thinInk = [128, 128, 128, 255];
  const lighterInk = [176, 176, 176, 255];
  const darkerInk = [84, 84, 84, 255];
  fillRgbaRect(raw, width, height, 0, midY, midX, height, thinInk);
  fillRgbaRect(
    raw,
    width,
    height,
    Math.floor(midX * 0.15),
    midY + Math.floor((height - midY) * 0.16),
    Math.floor(midX * 0.85),
    midY + Math.floor((height - midY) * 0.26),
    lighterInk,
  );
  fillRgbaRect(
    raw,
    width,
    height,
    Math.floor(midX * 0.15),
    midY + Math.floor((height - midY) * 0.72),
    Math.floor(midX * 0.85),
    midY + Math.floor((height - midY) * 0.82),
    darkerInk,
  );

  // 右下: 鋭い階段エッジ / 細線パターン (80 / 180)
  const edgeLow = [80, 80, 80, 255];
  const edgeHigh = [180, 180, 180, 255];
  const rightMidX = midX + Math.floor((width - midX) / 2);
  const rightMidY = midY + Math.floor((height - midY) / 2);
  fillRgbaRect(raw, width, height, midX, midY, rightMidX, rightMidY, edgeLow);
  fillRgbaRect(raw, width, height, rightMidX, midY, width, rightMidY, edgeHigh);
  fillRgbaRect(raw, width, height, midX, rightMidY, width, height, edgeLow);
  for (let x = midX + 8; x < width - 8; x += 12) {
    fillRgbaRect(
      raw,
      width,
      height,
      x,
      rightMidY + 12,
      x + 6,
      rightMidY + Math.floor((height - rightMidY) * 0.48),
      edgeHigh,
    );
  }
  const checkerStartY = rightMidY + Math.floor((height - rightMidY) * 0.54);
  for (let y = checkerStartY; y < height - 12; y += 8) {
    const rowShift = Math.floor((y - checkerStartY) / 8) % 2;
    for (let x = midX + 8 + rowShift * 8; x < width - 8; x += 16) {
      fillRgbaRect(raw, width, height, x, y, x + 8, y + 8, edgeHigh);
    }
  }

  // 中央十字区切り線
  const divider = [20, 20, 20, 255];
  fillRgbaRect(raw, width, height, midX - 2, 0, midX + 2, height, divider);
  fillRgbaRect(raw, width, height, 0, midY - 2, width, midY + 2, divider);

  return encodeRgbaRawToPng(width, height, raw);
}

function createYellowPaperPng(width = 600, height = 900) {
  const raw = createBlankRgbaRaw(width, height);
  fillRgbaRect(raw, width, height, 0, 0, width, height, [235, 228, 212, 255]);
  // 裏写り薄いテキスト模擬帯
  for (let y = 120; y < 340; y += 36) {
    fillRgbaRect(raw, width, height, 70, y, 530, y + 14, [202, 194, 178, 255]);
  }
  // 濃いインク枠と暗灰領域
  fillRgbaRect(raw, width, height, 60, 400, 540, 412, [34, 34, 34, 255]);
  fillRgbaRect(raw, width, height, 60, 440, 540, 620, [42, 42, 42, 255]);
  fillRgbaRect(raw, width, height, 100, 480, 500, 580, [235, 228, 212, 255]);
  fillRgbaRect(raw, width, height, 140, 520, 460, 540, [34, 34, 34, 255]);
  // 下部の薄い黄ばみ斑
  fillRgbaRect(raw, width, height, 70, 680, 530, 810, [218, 210, 192, 255]);
  return encodeRgbaRawToPng(width, height, raw);
}

function createThinInkPng(width = 600, height = 900) {
  const raw = createBlankRgbaRaw(width, height);
  fillRgbaRect(raw, width, height, 0, 0, width, height, [244, 244, 244, 255]);
  // 薄墨グレー太帯・濃淡比較
  fillRgbaRect(raw, width, height, 60, 80, 540, 180, [160, 160, 160, 255]);
  fillRgbaRect(raw, width, height, 60, 210, 540, 340, [128, 128, 128, 255]);
  fillRgbaRect(raw, width, height, 60, 370, 540, 460, [92, 92, 92, 255]);
  // 階段エッジ＆細線テスト領域 (80 / 180)
  fillRgbaRect(raw, width, height, 60, 510, 300, 670, [80, 80, 80, 255]);
  fillRgbaRect(raw, width, height, 300, 510, 540, 670, [180, 180, 180, 255]);
  fillRgbaRect(raw, width, height, 60, 700, 540, 840, [80, 80, 80, 255]);
  for (let x = 72; x < 528; x += 10) {
    fillRgbaRect(raw, width, height, x, 710, x + 4, 830, [180, 180, 180, 255]);
  }
  return encodeRgbaRawToPng(width, height, raw);
}

function createSeekColoredPagePng(
  pageNumber,
  totalPages,
  leftRgba,
  rightRgba,
  width = 600,
  height = 900,
) {
  const raw = createBlankRgbaRaw(width, height);
  const midX = Math.floor(width / 2);
  fillRgbaRect(raw, width, height, 0, 0, midX, height, leftRgba);
  fillRgbaRect(raw, width, height, midX, 0, width, height, rightRgba);

  const isTwoTone =
    leftRgba[0] !== rightRgba[0] ||
    leftRgba[1] !== rightRgba[1] ||
    leftRgba[2] !== rightRgba[2] ||
    leftRgba[3] !== rightRgba[3];
  if (isTwoTone) {
    const seamHalf = Math.min(8, Math.floor(width / 20));
    fillRgbaRect(
      raw,
      width,
      height,
      midX - seamHalf,
      0,
      midX + seamHalf,
      height,
      [255, 255, 255, 255],
    );
  }

  // 上部シーク進捗ヘッダー (ページ位置バー + ドット数)
  fillRgbaRect(raw, width, height, 0, 0, width, 64, [248, 250, 252, 255]);
  const fillWidth = Math.round((width * pageNumber) / totalPages);
  fillRgbaRect(raw, width, height, 0, 0, fillWidth, 14, [79, 70, 229, 255]);
  fillRgbaRect(
    raw,
    width,
    height,
    fillWidth,
    0,
    width,
    14,
    [203, 213, 225, 255],
  );
  for (let i = 0; i < pageNumber; i += 1) {
    const row = Math.floor(i / 10);
    const col = i % 10;
    const dx = 24 + col * 24;
    const dy = 22 + row * 18;
    fillRgbaRect(
      raw,
      width,
      height,
      dx,
      dy,
      dx + 14,
      dy + 12,
      [15, 23, 42, 255],
    );
  }
  fillRgbaRect(raw, width, height, 0, 62, width, 64, [15, 23, 42, 255]);

  return encodeRgbaRawToPng(width, height, raw);
}

/**
 * HO-08 実機検証用: 画質補正ラボ・20ページシーク・p.10横長単独を含む 20 ページ CBZ を生成する
 * @returns {Buffer}
 */
export function buildHo08ShaderSeekTestArchive() {
  const totalPages = 20;
  /** @type {readonly [number, number, number, number][]} */
  const palette = [
    [37, 99, 235, 255], // p.4 青
    [16, 185, 129, 255], // p.5 エメラルド
    [168, 85, 247, 255], // p.6 パープル
    [239, 68, 68, 255], // p.7 レッド
    [245, 158, 11, 255], // p.8 アンバー
    [6, 182, 212, 255], // p.9 シアン
    [236, 72, 153, 255], // p.11 ピンク
    [132, 204, 22, 255], // p.12 ライム
    [99, 102, 241, 255], // p.13 インディゴ
    [20, 184, 166, 255], // p.14 ティール
    [249, 115, 22, 255], // p.15 オレンジ
    [139, 92, 246, 255], // p.16 バイオレット
    [14, 165, 233, 255], // p.17 スカイ
    [234, 179, 8, 255], // p.18 イエロー
    [244, 63, 94, 255], // p.19 ローズ
  ];

  const entries = [
    { name: "001_cover_shader_lab.png", data: createShaderLabPng(600, 900) },
    { name: "002_yellow_paper.png", data: createYellowPaperPng(600, 900) },
    { name: "003_thin_ink.png", data: createThinInkPng(600, 900) },
  ];

  for (let page = 4; page <= 9; page += 1) {
    const color = palette[page - 4];
    entries.push({
      name: `${String(page).padStart(3, "0")}.png`,
      data: createSeekColoredPagePng(page, totalPages, color, color, 600, 900),
    });
  }

  entries.push({
    name: "010_landscape_spread.png",
    data: createSeekColoredPagePng(
      10,
      totalPages,
      [245, 130, 30, 255],
      [30, 195, 225, 255],
      1200,
      800,
    ),
  });

  for (let page = 11; page <= 19; page += 1) {
    const color = palette[page - 5];
    entries.push({
      name: `${String(page).padStart(3, "0")}.png`,
      data: createSeekColoredPagePng(page, totalPages, color, color, 600, 900),
    });
  }

  entries.push({
    name: "020_end.png",
    data: createSeekColoredPagePng(
      20,
      totalPages,
      [16, 185, 129, 255],
      [245, 158, 11, 255],
      600,
      900,
    ),
  });

  return buildDeterministicStoreZip(entries);
}

export const MANUAL_TEST_ARCHIVES = [
  {
    filename: "ho07-max-texture-test.cbz",
    build: buildHo07MaxTextureTestArchive,
  },
  {
    filename: "ho08-shader-seek-test.cbz",
    build: buildHo08ShaderSeekTestArchive,
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
