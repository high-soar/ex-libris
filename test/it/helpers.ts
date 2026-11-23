import { expect, type JSHandle, type Page } from "@playwright/test";
import { deflateSync, unzlibSync, zlibSync } from "fflate";
import {
  buildSyntheticZip,
  computeCrc32,
} from "../../src/engine/zip/__fixtures__/zipBuilder";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export async function waitForServicesReady(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.__exLibrisServices?.isReady === true),
      { timeout: 10_000 },
    )
    .toBe(true);
}

export async function resetTestDatabase(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const resetFn = window.__exLibrisServices?.resetTestDb;
    if (typeof resetFn !== "function") {
      throw new Error("window.__exLibrisServices.resetTestDb is not available");
    }
    await resetFn();
  });
}

export function trackPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (error) => {
    errors.push(error);
  });
  return errors;
}

export async function createFileDataTransfer(
  page: Page,
  options: {
    readonly name: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
  },
): Promise<JSHandle<DataTransfer>> {
  return page.evaluateHandle(
    ({ name, mimeType, rawBytes }) => {
      const dataTransfer = new DataTransfer();
      const file = new File([new Uint8Array(rawBytes)], name, {
        type: mimeType,
      });
      dataTransfer.items.add(file);
      return dataTransfer;
    },
    {
      name: options.name,
      mimeType: options.mimeType,
      rawBytes: Array.from(options.bytes),
    },
  );
}

const CORRUPT_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0x01, 0x02,
]);

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = new Uint8Array(4 + data.byteLength);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  const crc = computeCrc32(crcInput);

  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, crc, false);
  return chunk;
}

function buildPngFromTemplateRow(
  width: number,
  height: number,
  templateRow: Uint8Array,
): Uint8Array {
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const rowStride = 1 + width * 4;
  const rawScanlines = new Uint8Array(height * rowStride);
  for (let y = 0; y < height; y += 1) {
    rawScanlines.set(templateRow, y * rowStride);
  }

  const ihdr = createPngChunk("IHDR", ihdrData);
  const idat = createPngChunk("IDAT", zlibSync(rawScanlines));
  const iend = createPngChunk("IEND", new Uint8Array(0));

  const out = new Uint8Array(
    PNG_SIGNATURE.byteLength +
      ihdr.byteLength +
      idat.byteLength +
      iend.byteLength,
  );
  let offset = 0;
  for (const part of [PNG_SIGNATURE, ihdr, idat, iend]) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function createSyntheticPng(
  rgba: readonly [number, number, number, number],
  width = 4,
  height = 4,
): Uint8Array {
  const rowStride = 1 + width * 4;
  const templateRow = new Uint8Array(rowStride);
  templateRow[0] = 0;
  const [r, g, b, a] = rgba;
  for (let x = 0; x < width; x += 1) {
    const px = 1 + x * 4;
    templateRow[px] = r;
    templateRow[px + 1] = g;
    templateRow[px + 2] = b;
    templateRow[px + 3] = a;
  }
  return buildPngFromTemplateRow(width, height, templateRow);
}

export function createSplitColorPng(
  leftRgba: readonly [number, number, number, number],
  rightRgba: readonly [number, number, number, number],
  width: number,
  height: number,
): Uint8Array {
  const rowStride = 1 + width * 4;
  const templateRow = new Uint8Array(rowStride);
  templateRow[0] = 0;
  const splitX = Math.floor(width / 2);
  for (let x = 0; x < width; x += 1) {
    const [r, g, b, a] = x < splitX ? leftRgba : rightRgba;
    const px = 1 + x * 4;
    templateRow[px] = r;
    templateRow[px + 1] = g;
    templateRow[px + 2] = b;
    templateRow[px + 3] = a;
  }
  return buildPngFromTemplateRow(width, height, templateRow);
}

export function buildSyntheticThreePageArchive(): Uint8Array {
  const redPng = createSyntheticPng([255, 0, 0, 255]);
  const greenPng = createSyntheticPng([0, 255, 0, 255]);
  const bluePng = createSyntheticPng([0, 0, 255, 255]);

  return buildSyntheticZip({
    entries: [
      {
        name: "__MACOSX/._001.png",
        data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
        compressionMethod: 0,
      },
      {
        name: "Thumbs.db",
        data: new Uint8Array([1, 2, 3, 4]),
        compressionMethod: 0,
      },
      {
        name: "第10話/010.png",
        data: bluePng,
        compressionMethod: 8,
      },
      {
        name: "第2話/002.png",
        data: greenPng,
        compressionMethod: 0,
      },
      {
        name: "第1話/001.png",
        data: redPng,
        compressionMethod: 8,
      },
    ],
  });
}

export function buildPartialCorruptArchive(): Uint8Array {
  const validGreenPng = createSyntheticPng([0, 255, 0, 255]);
  return buildSyntheticZip({
    entries: [
      {
        name: "001.png",
        data: CORRUPT_PNG_BYTES,
        compressionMethod: 0,
      },
      {
        name: "002.png",
        data: validGreenPng,
        compressionMethod: 8,
      },
    ],
  });
}

export function buildSyntheticPortraitSpreadArchive(): Uint8Array {
  const pageSpecs: readonly {
    readonly name: string;
    readonly rgba: readonly [number, number, number, number];
    readonly compressionMethod: 0 | 8;
  }[] = [
    { name: "001.png", rgba: [255, 0, 0, 255], compressionMethod: 0 }, // 0: 赤
    { name: "002.png", rgba: [0, 255, 0, 255], compressionMethod: 8 }, // 1: 緑
    { name: "003.png", rgba: [0, 0, 255, 255], compressionMethod: 0 }, // 2: 青
    { name: "004.png", rgba: [255, 255, 0, 255], compressionMethod: 8 }, // 3: 黄
    { name: "005.png", rgba: [0, 255, 255, 255], compressionMethod: 0 }, // 4: シアン
    { name: "006.png", rgba: [255, 0, 255, 255], compressionMethod: 8 }, // 5: マゼンタ
  ];

  return buildSyntheticZip({
    entries: pageSpecs.map((page) => ({
      name: page.name,
      data: createSyntheticPng(page.rgba, 64, 96),
      compressionMethod: page.compressionMethod,
    })),
  });
}

export function buildSyntheticMixedSpreadArchive(): Uint8Array {
  const pageSpecs: readonly {
    readonly name: string;
    readonly rgba: readonly [number, number, number, number];
    readonly width: number;
    readonly height: number;
    readonly compressionMethod: 0 | 8;
  }[] = [
    {
      name: "001.png",
      rgba: [255, 0, 0, 255],
      width: 64,
      height: 96,
      compressionMethod: 0,
    }, // 0: 表紙 縦(赤)
    {
      name: "002.png",
      rgba: [0, 255, 0, 255],
      width: 64,
      height: 96,
      compressionMethod: 8,
    }, // 1: 縦(緑)
    {
      name: "003.png",
      rgba: [0, 0, 255, 255],
      width: 64,
      height: 96,
      compressionMethod: 0,
    }, // 2: 縦(青)
    {
      name: "004.png",
      rgba: [255, 255, 0, 255],
      width: 160,
      height: 80,
      compressionMethod: 8,
    }, // 3: 横長(黄)
    {
      name: "005.png",
      rgba: [0, 255, 255, 255],
      width: 64,
      height: 96,
      compressionMethod: 0,
    }, // 4: 縦(シアン)
    {
      name: "006.png",
      rgba: [255, 0, 255, 255],
      width: 64,
      height: 96,
      compressionMethod: 8,
    }, // 5: 縦(マゼンタ)
  ];

  return buildSyntheticZip({
    entries: pageSpecs.map((page) => ({
      name: page.name,
      data: createSyntheticPng(page.rgba, page.width, page.height),
      compressionMethod: page.compressionMethod,
    })),
  });
}

export function buildSyntheticOversizedTextureArchive(
  maxTextureSize: number,
): Uint8Array {
  const coverPng = createSyntheticPng([0, 255, 0, 255], 64, 96);
  const oversizedPng = createSplitColorPng(
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    maxTextureSize + 128,
    64,
  );

  return buildSyntheticZip({
    entries: [
      {
        name: "001.png",
        data: coverPng,
        compressionMethod: 0,
      },
      {
        name: "002.png",
        data: oversizedPng,
        compressionMethod: 0,
      },
    ],
  });
}

export function buildSpreadCorruptArchive(
  corruptPageIndices: readonly number[],
): Uint8Array {
  const corruptSet = new Set(corruptPageIndices);
  const pageSpecs: readonly {
    readonly name: string;
    readonly rgba: readonly [number, number, number, number];
  }[] = [
    { name: "001.png", rgba: [255, 0, 0, 255] },
    { name: "002.png", rgba: [0, 255, 0, 255] },
    { name: "003.png", rgba: [0, 0, 255, 255] },
  ];

  return buildSyntheticZip({
    entries: pageSpecs.map((page, index) => ({
      name: page.name,
      data: corruptSet.has(index)
        ? CORRUPT_PNG_BYTES
        : createSyntheticPng(page.rgba, 64, 96),
      compressionMethod: 0,
    })),
  });
}

export function buildCorruptZipBytes(): Uint8Array {
  return new TextEncoder().encode(
    "broken-zip-archive-without-eocd-signature-for-comlink-error-test",
  );
}

export function buildSyntheticZip64Archive(): Uint8Array {
  const junkData = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const junkName = "__MACOSX/._001.png";
  const redPng = createSyntheticPng([255, 0, 0, 255]);
  const greenPng = createSyntheticPng([0, 255, 0, 255]);
  const greenDeflated = deflateSync(greenPng);
  const bluePng = createSyntheticPng([0, 0, 255, 255]);

  const offset0 = 0;
  const offset1 = offset0 + 30 + junkName.length + junkData.byteLength;
  const offset2 = offset1 + 30 + "001.png".length + redPng.byteLength;
  const offset3 = offset2 + 30 + "002.png".length + greenDeflated.byteLength;

  return buildSyntheticZip({
    zip64: true,
    saturateStandardEocd: true,
    entries: [
      {
        name: junkName,
        data: junkData,
        compressionMethod: 0,
        zip64Extra: {
          uncompressedSize: BigInt(junkData.byteLength),
          compressedSize: BigInt(junkData.byteLength),
          localHeaderOffset: BigInt(offset0),
        },
      },
      {
        name: "001.png",
        data: redPng,
        compressionMethod: 0,
        zip64Extra: {
          uncompressedSize: BigInt(redPng.byteLength),
          compressedSize: BigInt(redPng.byteLength),
          localHeaderOffset: BigInt(offset1),
        },
      },
      {
        name: "002.png",
        data: greenPng,
        compressedData: greenDeflated,
        compressionMethod: 8,
        zip64Extra: {
          uncompressedSize: BigInt(greenPng.byteLength),
          compressedSize: BigInt(greenDeflated.byteLength),
          localHeaderOffset: BigInt(offset2),
        },
      },
      {
        name: "010.png",
        data: bluePng,
        compressionMethod: 0,
        zip64Extra: {
          localHeaderOffset: BigInt(offset3),
        },
      },
    ],
  });
}

export function buildSyntheticCp932Archive(): Uint8Array {
  const redPng = createSyntheticPng([255, 0, 0, 255]);
  const yellowPng = createSyntheticPng([255, 255, 0, 255]);
  const greenPng = createSyntheticPng([0, 255, 0, 255]);
  const bluePng = createSyntheticPng([0, 0, 255, 255]);

  // Shift_JIS (CP932, Bit 11 = 0) バイト列: 第(91 e6), 話(98 62), ①(87 40), 特(93 c1), 典(93 54)
  const ep10Name = new Uint8Array([
    0x91, 0xe6, 0x31, 0x30, 0x98, 0x62, 0x2f, 0x30, 0x31, 0x30, 0x2e, 0x70,
    0x6e, 0x67,
  ]); // "第10話/010.png"
  const ep2Name = new Uint8Array([
    0x91, 0xe6, 0x32, 0x98, 0x62, 0x2f, 0x30, 0x30, 0x32, 0x2e, 0x70, 0x6e,
    0x67,
  ]); // "第2話/002.png"
  const ep1BonusName = new Uint8Array([
    0x91, 0xe6, 0x31, 0x98, 0x62, 0x2f, 0x87, 0x40, 0x93, 0xc1, 0x93, 0x54,
    0x2e, 0x70, 0x6e, 0x67,
  ]); // "第1話/①特典.png"
  const ep1Name = new Uint8Array([
    0x91, 0xe6, 0x31, 0x98, 0x62, 0x2f, 0x30, 0x30, 0x31, 0x2e, 0x70, 0x6e,
    0x67,
  ]); // "第1話/001.png"

  return buildSyntheticZip({
    entries: [
      {
        name: "__MACOSX/._001.png",
        data: new Uint8Array([1, 2, 3, 4]),
        compressionMethod: 0,
      },
      {
        name: ep10Name,
        data: bluePng,
        compressionMethod: 8,
        flags: 0,
      },
      {
        name: ep2Name,
        data: greenPng,
        compressionMethod: 0,
        flags: 0,
      },
      {
        name: ep1BonusName,
        data: yellowPng,
        compressionMethod: 8,
        flags: 0,
      },
      {
        name: ep1Name,
        data: redPng,
        compressionMethod: 0,
        flags: 0,
      },
    ],
  });
}

export function buildSyntheticSevenPageArchive(): Uint8Array {
  const pageColors: readonly {
    readonly name: string;
    readonly rgba: readonly [number, number, number, number];
    readonly compressionMethod: 0 | 8;
  }[] = [
    { name: "001.png", rgba: [255, 0, 0, 255], compressionMethod: 0 }, // 0: 赤
    { name: "002.png", rgba: [0, 255, 0, 255], compressionMethod: 8 }, // 1: 緑
    { name: "003.png", rgba: [0, 0, 255, 255], compressionMethod: 0 }, // 2: 青
    { name: "004.png", rgba: [255, 255, 0, 255], compressionMethod: 8 }, // 3: 黄
    { name: "005.png", rgba: [0, 255, 255, 255], compressionMethod: 0 }, // 4: シアン
    { name: "006.png", rgba: [255, 0, 255, 255], compressionMethod: 8 }, // 5: マゼンタ
    { name: "007.png", rgba: [255, 255, 255, 255], compressionMethod: 0 }, // 6: 白
  ];

  return buildSyntheticZip({
    entries: pageColors.map((page) => ({
      name: page.name,
      data: createSyntheticPng(page.rgba),
      compressionMethod: page.compressionMethod,
    })),
  });
}

function createQuadrantShaderTestPng(): Uint8Array {
  const width = 400;
  const height = 400;
  const rowStride = 1 + width * 4;
  const topRow = new Uint8Array(rowStride);
  const bottomRow = new Uint8Array(rowStride);
  topRow[0] = 0;
  bottomRow[0] = 0;

  const yellowPaper: readonly [number, number, number, number] = [
    235, 228, 212, 255,
  ];
  const bleedDark: readonly [number, number, number, number] = [
    42, 42, 42, 255,
  ];
  const thinInk: readonly [number, number, number, number] = [
    128, 128, 128, 255,
  ];
  const edgeLow: readonly [number, number, number, number] = [80, 80, 80, 255];
  const edgeHigh: readonly [number, number, number, number] = [
    180, 180, 180, 255,
  ];

  for (let x = 0; x < width; x += 1) {
    const px = 1 + x * 4;
    const topColor = x < 200 ? yellowPaper : bleedDark;
    topRow[px] = topColor[0];
    topRow[px + 1] = topColor[1];
    topRow[px + 2] = topColor[2];
    topRow[px + 3] = topColor[3];

    const bottomColor = x < 200 ? thinInk : x < 300 ? edgeLow : edgeHigh;
    bottomRow[px] = bottomColor[0];
    bottomRow[px + 1] = bottomColor[1];
    bottomRow[px + 2] = bottomColor[2];
    bottomRow[px + 3] = bottomColor[3];
  }

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const rawScanlines = new Uint8Array(height * rowStride);
  for (let y = 0; y < height; y += 1) {
    rawScanlines.set(y < 200 ? topRow : bottomRow, y * rowStride);
  }

  const ihdr = createPngChunk("IHDR", ihdrData);
  const idat = createPngChunk("IDAT", zlibSync(rawScanlines));
  const iend = createPngChunk("IEND", new Uint8Array(0));

  const out = new Uint8Array(
    PNG_SIGNATURE.byteLength +
      ihdr.byteLength +
      idat.byteLength +
      iend.byteLength,
  );
  let offset = 0;
  for (const part of [PNG_SIGNATURE, ihdr, idat, iend]) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function buildSyntheticShaderTestArchive(): Uint8Array {
  return buildSyntheticZip({
    entries: [
      {
        name: "001_shader_lab.png",
        data: createQuadrantShaderTestPng(),
        compressionMethod: 0,
      },
    ],
  });
}

export interface InspectableZipIndexCacheRecord {
  readonly cacheKey: string;
  readonly pageCount: number;
  readonly cachedAt: number;
  readonly entryNames: readonly string[];
}

export async function readZipIndexCacheRecord(
  page: Page,
  cacheKey: string,
): Promise<InspectableZipIndexCacheRecord | null> {
  return page.evaluate(async (key) => {
    return await new Promise<InspectableZipIndexCacheRecord | null>(
      (resolve, reject) => {
        const request = indexedDB.open("ExLibrisDB");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const idb = request.result;
          if (!idb.objectStoreNames.contains("zipIndexCache")) {
            idb.close();
            resolve(null);
            return;
          }
          const tx = idb.transaction("zipIndexCache", "readonly");
          const store = tx.objectStore("zipIndexCache");
          const getReq = store.get(key);
          getReq.onerror = () => {
            idb.close();
            reject(getReq.error);
          };
          getReq.onsuccess = () => {
            const raw = getReq.result as
              | {
                  cacheKey: string;
                  pageCount: number;
                  cachedAt: number;
                  entries: Array<{ entryName: string }>;
                }
              | undefined;
            idb.close();
            if (!raw) {
              resolve(null);
              return;
            }
            resolve({
              cacheKey: raw.cacheKey,
              pageCount: raw.pageCount,
              cachedAt: raw.cachedAt,
              entryNames: raw.entries.map((entry) => entry.entryName),
            });
          };
        };
      },
    );
  }, cacheKey);
}

export async function readSyncMetaValue(
  page: Page,
  metaKey: string,
): Promise<string | null> {
  return page.evaluate(async (key) => {
    return await new Promise<string | null>((resolve, reject) => {
      const request = indexedDB.open("ExLibrisDB");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const idb = request.result;
        if (!idb.objectStoreNames.contains("syncMeta")) {
          idb.close();
          resolve(null);
          return;
        }
        const tx = idb.transaction("syncMeta", "readonly");
        const store = tx.objectStore("syncMeta");
        const getReq = store.get(key);
        getReq.onerror = () => {
          idb.close();
          reject(getReq.error);
        };
        getReq.onsuccess = () => {
          const raw = getReq.result as
            { key: string; value: string } | undefined;
          idb.close();
          resolve(raw ? raw.value : null);
        };
      };
    });
  }, metaKey);
}

export interface InspectableReadingProgressRecord {
  readonly targetKey: string;
  readonly volumeId: string | null;
  readonly currentPageIndex: number;
  readonly totalPageCount: number;
  readonly readStatus: "unread" | "reading" | "completed";
  readonly spreadPageOffset: 0 | 1;
  readonly lastReadAt: number;
  readonly updatedAt: number;
}

export async function readReadingProgressRecord(
  page: Page,
  targetKey: string,
): Promise<InspectableReadingProgressRecord | null> {
  return page.evaluate(async (key) => {
    return await new Promise<InspectableReadingProgressRecord | null>(
      (resolve, reject) => {
        const request = indexedDB.open("ExLibrisDB");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const idb = request.result;
          if (!idb.objectStoreNames.contains("readingProgress")) {
            idb.close();
            resolve(null);
            return;
          }
          const tx = idb.transaction("readingProgress", "readonly");
          const store = tx.objectStore("readingProgress");
          const getReq = store.get(key);
          getReq.onerror = () => {
            idb.close();
            reject(getReq.error);
          };
          getReq.onsuccess = () => {
            const raw = getReq.result as
              InspectableReadingProgressRecord | undefined;
            idb.close();
            resolve(raw ?? null);
          };
        };
      },
    );
  }, targetKey);
}

export async function deleteReadingProgressRecord(
  page: Page,
  targetKey: string,
): Promise<void> {
  await page.evaluate(async (key) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("ExLibrisDB");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const idb = request.result;
        if (!idb.objectStoreNames.contains("readingProgress")) {
          idb.close();
          resolve();
          return;
        }
        const tx = idb.transaction("readingProgress", "readwrite");
        tx.oncomplete = () => {
          idb.close();
          resolve();
        };
        tx.onerror = () => {
          idb.close();
          reject(tx.error);
        };
        tx.onabort = () => {
          idb.close();
          reject(tx.error ?? new Error("IndexedDB delete transaction aborted"));
        };
        const store = tx.objectStore("readingProgress");
        store.delete(key);
      };
    });
  }, targetKey);
}

interface DecodedPngRows {
  readonly width: number;
  readonly height: number;
  readonly bpp: number;
  readonly inflated: Uint8Array;
}

function decodePngScanlines(pngBytes: Uint8Array): DecodedPngRows {
  const view = new DataView(
    pngBytes.buffer,
    pngBytes.byteOffset,
    pngBytes.byteLength,
  );
  let cursor = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks: Uint8Array[] = [];

  while (cursor + 12 <= pngBytes.byteLength) {
    const length = view.getUint32(cursor, false);
    const type = String.fromCharCode(
      pngBytes[cursor + 4],
      pngBytes[cursor + 5],
      pngBytes[cursor + 6],
      pngBytes[cursor + 7],
    );
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    const data = pngBytes.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      const ihdr = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = ihdr.getUint32(0, false);
      height = ihdr.getUint32(4, false);
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }

    cursor = dataEnd + 4;
  }

  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bpp === 0 || width === 0 || height === 0) {
    throw new Error(
      `Unsupported PNG format: ${width}x${height} c=${colorType}`,
    );
  }

  const totalIdat = idatChunks.reduce((acc, c) => acc + c.byteLength, 0);
  const compressed = new Uint8Array(totalIdat);
  let idatOffset = 0;
  for (const chunk of idatChunks) {
    compressed.set(chunk, idatOffset);
    idatOffset += chunk.byteLength;
  }
  return {
    width,
    height,
    bpp,
    inflated: unzlibSync(compressed),
  };
}

function reconstructPngRow(
  decoded: DecodedPngRows,
  targetY: number,
): Uint8Array {
  const { width, bpp, inflated } = decoded;
  const stride = width * bpp;
  let prevRow: Uint8Array | null = null;
  let currRow = new Uint8Array(stride);

  for (let y = 0; y <= targetY; y += 1) {
    const rowStart = y * (1 + stride);
    const filterType = inflated[rowStart];
    const nextRow = new Uint8Array(stride);

    for (let i = 0; i < stride; i += 1) {
      const raw = inflated[rowStart + 1 + i];
      const left = i >= bpp ? nextRow[i - bpp] : 0;
      const up = prevRow ? prevRow[i] : 0;
      const upLeft = prevRow && i >= bpp ? prevRow[i - bpp] : 0;

      if (filterType === 0) {
        nextRow[i] = raw;
      } else if (filterType === 1) {
        nextRow[i] = (raw + left) & 0xff;
      } else if (filterType === 2) {
        nextRow[i] = (raw + up) & 0xff;
      } else if (filterType === 3) {
        nextRow[i] = (raw + ((left + up) >> 1)) & 0xff;
      } else {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        nextRow[i] = (raw + predictor) & 0xff;
      }
    }

    prevRow = nextRow;
    currRow = nextRow;
  }

  return currRow;
}

export function readPngPixelAtRatio(
  pngBytes: Uint8Array,
  xRatio: number,
  yRatio: number,
): {
  r: number;
  g: number;
  b: number;
} {
  const decoded = decodePngScanlines(pngBytes);
  const clampedXRatio = Math.min(1, Math.max(0, xRatio));
  const clampedYRatio = Math.min(1, Math.max(0, yRatio));
  const targetX = Math.min(
    decoded.width - 1,
    Math.floor(decoded.width * clampedXRatio),
  );
  const targetY = Math.min(
    decoded.height - 1,
    Math.floor(decoded.height * clampedYRatio),
  );
  const currRow = reconstructPngRow(decoded, targetY);
  const pixelOffset = targetX * decoded.bpp;
  return {
    r: currRow[pixelOffset],
    g: currRow[pixelOffset + 1],
    b: currRow[pixelOffset + 2],
  };
}

export function readPngHorizontalContrastRange(
  pngBytes: Uint8Array,
  yRatio: number,
  xRatioStart: number,
  xRatioEnd: number,
): {
  readonly min: number;
  readonly max: number;
  readonly contrast: number;
} {
  const decoded = decodePngScanlines(pngBytes);
  const clampedYRatio = Math.min(1, Math.max(0, yRatio));
  const targetY = Math.min(
    decoded.height - 1,
    Math.floor(decoded.height * clampedYRatio),
  );
  const currRow = reconstructPngRow(decoded, targetY);
  const startX = Math.max(
    0,
    Math.min(decoded.width - 1, Math.floor(decoded.width * xRatioStart)),
  );
  const endX = Math.max(
    startX,
    Math.min(decoded.width - 1, Math.floor(decoded.width * xRatioEnd)),
  );

  let min = 255;
  let max = 0;
  for (let x = startX; x <= endX; x += 1) {
    const off = x * decoded.bpp;
    const luma = Math.round(
      (currRow[off] + currRow[off + 1] + currRow[off + 2]) / 3,
    );
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }
  return {
    min,
    max,
    contrast: max - min,
  };
}

export function readPngCenterPixel(pngBytes: Uint8Array): {
  r: number;
  g: number;
  b: number;
} {
  return readPngPixelAtRatio(pngBytes, 0.5, 0.5);
}
