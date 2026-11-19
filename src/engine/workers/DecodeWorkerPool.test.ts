import { describe, expect, it, vi } from "vitest";
import { DecodeWorkerPool } from "./DecodeWorkerPool";

function createFakeBitmap(id: number): ImageBitmap {
  return {
    width: 100 + id,
    height: 200 + id,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

describe("DecodeWorkerPool", () => {
  it("Workerハンドルが0件の場合はエラーを送出すること", () => {
    expect(() => new DecodeWorkerPool([])).toThrow();
  });

  it("逐次リクエストを2つのWorkerへラウンドロビンでディスパッチすること", async () => {
    const spy0 = vi.fn(async () => ({
      bitmap: createFakeBitmap(0),
      width: 100,
      height: 200,
    }));
    const spy1 = vi.fn(async () => ({
      bitmap: createFakeBitmap(1),
      width: 101,
      height: 201,
    }));

    const pool = new DecodeWorkerPool([
      { api: { decodePageSlice: spy0 } },
      { api: { decodePageSlice: spy1 } },
    ]);

    const slice = new Uint8Array([1, 2, 3]);
    await pool.decodePageSlice(slice, 0);
    await pool.decodePageSlice(slice, 8);
    await pool.decodePageSlice(slice, 0);

    expect(spy0).toHaveBeenCalledTimes(2);
    expect(spy1).toHaveBeenCalledTimes(1);
    expect(spy0).toHaveBeenCalledWith(slice, 0);
    expect(spy1).toHaveBeenCalledWith(slice, 8);
  });

  it("一方のWorkerが処理中の場合は空きWorkerを優先して割り当て最小負荷分散すること", async () => {
    let resolveSlow0!: (val: {
      bitmap: ImageBitmap;
      width: number;
      height: number;
    }) => void;
    const slowPromise0 = new Promise<{
      bitmap: ImageBitmap;
      width: number;
      height: number;
    }>((resolve) => {
      resolveSlow0 = resolve;
    });

    const spy0 = vi.fn(() => slowPromise0);
    const spy1 = vi.fn(async () => ({
      bitmap: createFakeBitmap(1),
      width: 101,
      height: 201,
    }));

    const pool = new DecodeWorkerPool([
      { api: { decodePageSlice: spy0 } },
      { api: { decodePageSlice: spy1 } },
    ]);

    const job0 = pool.decodePageSlice(new Uint8Array([1]), 0);
    const job1 = pool.decodePageSlice(new Uint8Array([2]), 0);
    await job1;

    // この時点でWorker 0は依然処理中・Worker 1は空き、かつnextIndex=0に戻る状態だが空きWorker 1が選ばれる
    const job2 = pool.decodePageSlice(new Uint8Array([3]), 0);
    await job2;

    expect(spy0).toHaveBeenCalledTimes(1);
    expect(spy1).toHaveBeenCalledTimes(2);

    // 両方ともビジー状態から負荷が最小の側へ割り振られ、失敗時もactiveCountが解放される
    let rejectSlow1!: (err: unknown) => void;
    spy1.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSlow1 = reject;
        }),
    );
    const job3 = pool.decodePageSlice(new Uint8Array([4]), 0); // Worker 1 (active=0)
    const job4 = pool.decodePageSlice(new Uint8Array([5]), 0); // Worker 0 (active=1) vs Worker 1 (active=1)

    rejectSlow1(new Error("decode error"));
    await expect(job3).rejects.toThrow("decode error");

    resolveSlow0({ bitmap: createFakeBitmap(0), width: 100, height: 200 });
    await expect(job0).resolves.toMatchObject({ width: 100 });
    await expect(job4).resolves.toMatchObject({ width: 100 });
  });

  it("disposeで全Workerを破棄し破棄後のデコード呼び出しをDECODE_FAILEDで拒否すること", async () => {
    const terminate0 = vi.fn();
    const pool = new DecodeWorkerPool([
      {
        api: {
          decodePageSlice: vi.fn(async () => ({
            bitmap: createFakeBitmap(0),
            width: 100,
            height: 200,
          })),
        },
        terminate: terminate0,
      },
      {
        api: {
          decodePageSlice: vi.fn(async () => ({
            bitmap: createFakeBitmap(1),
            width: 101,
            height: 201,
          })),
        },
      },
    ]);

    pool.dispose();
    pool.dispose();
    expect(terminate0).toHaveBeenCalledTimes(1);

    await expect(
      pool.decodePageSlice(new Uint8Array([1]), 0),
    ).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "DECODE_FAILED",
    });
  });
});
