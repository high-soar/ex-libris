import { afterEach, describe, expect, it, vi } from "vitest";
import { ZipArchiveError } from "../zip/errors";
import { LocalFileReader } from "./LocalFileReader";

function createTestFile(bytes: Uint8Array, name = "comic.cbz"): File {
  return new File([bytes as Uint8Array<ArrayBuffer>], name, {
    type: "application/zip",
  });
}

describe("LocalFileReader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sourceIdとtotalSizeをFile情報から正しく構築すること (AC-ENG-01)", () => {
    const file = createTestFile(new Uint8Array([1, 2, 3, 4]), "vol01.zip");
    const reader = new LocalFileReader(file);

    expect(reader.sourceId).toBe("local:vol01.zip:4");
    expect(reader.totalSize).toBe(4);
  });

  it("指定した範囲を正確に読み取り末尾超過時は実サイズまでクランプすること (AC-ENG-01)", async () => {
    const data = new Uint8Array([10, 20, 30, 40, 50]);
    const reader = new LocalFileReader(createTestFile(data));

    expect(await reader.readRange(1, 3)).toEqual(new Uint8Array([20, 30, 40]));
    expect(await reader.readRange(3, 100)).toEqual(new Uint8Array([40, 50]));
  });

  it("lengthが0またはoffsetがtotalSize以上の場合は空Uint8Arrayを返すこと (AC-ENG-01)", async () => {
    const reader = new LocalFileReader(
      createTestFile(new Uint8Array([1, 2, 3])),
    );

    expect(await reader.readRange(0, 0)).toEqual(new Uint8Array(0));
    expect(await reader.readRange(3, 5)).toEqual(new Uint8Array(0));
    expect(await reader.readRange(10, 5)).toEqual(new Uint8Array(0));
  });

  it("負数や非整数のoffset/lengthに対してZipArchiveError('READ_ERROR')を送出すること (AC-ENG-01)", async () => {
    const reader = new LocalFileReader(
      createTestFile(new Uint8Array([1, 2, 3])),
    );

    await expect(reader.readRange(-1, 2)).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "READ_ERROR",
    });
    await expect(reader.readRange(0, -1)).rejects.toBeInstanceOf(
      ZipArchiveError,
    );
    await expect(reader.readRange(1.5, 1)).rejects.toMatchObject({
      code: "READ_ERROR",
    });
    await expect(reader.readRange(0, Number.NaN)).rejects.toMatchObject({
      code: "READ_ERROR",
    });
  });

  it("事前または読込中にAbortSignalが中断された場合はAbortErrorを送出すること (AC-ENG-01)", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const file = createTestFile(data);
    const reader = new LocalFileReader(file);

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      reader.readRange(0, 2, preAborted.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });

    const inFlightController = new AbortController();
    const originalSlice = file.slice.bind(file);
    vi.spyOn(file, "slice").mockImplementation((start, end) => {
      const blob = originalSlice(start, end);
      return {
        arrayBuffer: async () => {
          inFlightController.abort();
          return blob.arrayBuffer();
        },
      } as Blob;
    });

    await expect(
      reader.readRange(0, 2, inFlightController.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("File.slice読込でI/O例外が発生した場合はREAD_ERRORへ変換しAbortErrorはそのまま再送出すること (AC-ENG-01)", async () => {
    const ioFile = createTestFile(new Uint8Array([1, 2, 3]));
    vi.spyOn(ioFile, "slice").mockImplementation(
      () =>
        ({
          arrayBuffer: async () => {
            throw new Error("disk failure");
          },
        }) as unknown as Blob,
    );
    const ioReader = new LocalFileReader(ioFile);

    await expect(ioReader.readRange(0, 2)).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "READ_ERROR",
    });

    const abortFile = createTestFile(new Uint8Array([1, 2, 3]));
    vi.spyOn(abortFile, "slice").mockImplementation(
      () =>
        ({
          arrayBuffer: async () => {
            throw new DOMException("Aborted inside blob", "AbortError");
          },
        }) as unknown as Blob,
    );
    const abortReader = new LocalFileReader(abortFile);

    await expect(abortReader.readRange(0, 2)).rejects.toMatchObject({
      name: "AbortError",
    });

    const errorNamedAbortFile = createTestFile(new Uint8Array([1, 2, 3]));
    vi.spyOn(errorNamedAbortFile, "slice").mockImplementation(
      () =>
        ({
          arrayBuffer: async () => {
            const err = new Error("Aborted error");
            err.name = "AbortError";
            throw err;
          },
        }) as unknown as Blob,
    );
    const errorNamedAbortReader = new LocalFileReader(errorNamedAbortFile);

    await expect(errorNamedAbortReader.readRange(0, 2)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
