import { expect, type JSHandle, type Page } from "@playwright/test";
import { unzlibSync, zlibSync } from "fflate";
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

export function createSyntheticPng(
  rgba: readonly [number, number, number, number],
  width = 4,
  height = 4,
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
  const [r, g, b, a] = rgba;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowStride;
    rawScanlines[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 4;
      rawScanlines[px] = r;
      rawScanlines[px + 1] = g;
      rawScanlines[px + 2] = b;
      rawScanlines[px + 3] = a;
    }
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
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0x01, 0x02]),
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

export function buildCorruptZipBytes(): Uint8Array {
  return new TextEncoder().encode(
    "broken-zip-archive-without-eocd-signature-for-comlink-error-test",
  );
}

export function readPngCenterPixel(pngBytes: Uint8Array): {
  r: number;
  g: number;
  b: number;
} {
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
  const inflated = unzlibSync(compressed);

  const stride = width * bpp;
  const targetY = Math.floor(height / 2);
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

  const centerOffset = Math.floor(width / 2) * bpp;
  return {
    r: currRow[centerOffset],
    g: currRow[centerOffset + 1],
    b: currRow[centerOffset + 2],
  };
}
