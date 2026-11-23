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

    // 失敗時もactiveCountが0へ戻ること（Worker 0がactive=1の状態で次の要求がWorker 1を優先選択する）
    let rejectSlow1!: (err: unknown) => void;
    spy1.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSlow1 = reject;
        }),
    );
    const job3 = pool.decodePageSlice(new Uint8Array([4]), 0); // Worker 1 (active=0)
    rejectSlow1(new Error("decode error"));
    await expect(job3).rejects.toThrow("decode error");

    const job4 = pool.decodePageSlice(new Uint8Array([5]), 0); // activeCount復帰によりWorker 1 (active=0 < 1) を選択
    await job4;
    expect(spy0).toHaveBeenCalledTimes(1);
    expect(spy1).toHaveBeenCalledTimes(4);

    // 両方ともactive=1で同率の場合はnextIndex側が選ばれる
    let resolveSlow1!: (val: {
      bitmap: ImageBitmap;
      width: number;
      height: number;
    }) => void;
    spy1.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSlow1 = resolve;
        }),
    );
    const job5 = pool.decodePageSlice(new Uint8Array([6]), 0); // Worker 1 (active=0 < 1), nextIndex -> 0
    const job6 = pool.decodePageSlice(new Uint8Array([7]), 0); // Worker 0 (active=1) vs Worker 1 (active=1) -> Worker 0
    expect(spy0).toHaveBeenCalledTimes(2);
    expect(spy1).toHaveBeenCalledTimes(5);

    resolveSlow0({ bitmap: createFakeBitmap(0), width: 100, height: 200 });
    resolveSlow1({ bitmap: createFakeBitmap(1), width: 101, height: 201 });
    await expect(job0).resolves.toMatchObject({ width: 100 });
    await expect(job5).resolves.toMatchObject({ width: 101 });
    await expect(job6).resolves.toMatchObject({ width: 100 });
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

  it("対象スロットのエラー発生時に保留RPCを即座にDECODE_FAILEDでreject・購読解除して健全スロットのみで継続し、全スロット異常終了時は即rejectすること", async () => {
    let fireError0: ((event: unknown) => void) | undefined;
    let fireError1: ((event: unknown) => void) | undefined;
    const unsubscribe0 = vi.fn(() => {
      fireError0 = undefined;
    });
    const unsubscribe1 = vi.fn(() => {
      fireError1 = undefined;
    });

    let resolveHanging0!: (val: {
      bitmap: ImageBitmap;
      width: number;
      height: number;
    }) => void;
    let rejectHanging0!: (err: unknown) => void;

    const decode0 = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{
            bitmap: ImageBitmap;
            width: number;
            height: number;
          }>((resolve) => {
            resolveHanging0 = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<{
            bitmap: ImageBitmap;
            width: number;
            height: number;
          }>((_, reject) => {
            rejectHanging0 = reject;
          }),
      );

    let resolveSlow1!: (val: {
      bitmap: ImageBitmap;
      width: number;
      height: number;
    }) => void;
    const decode1 = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{
            bitmap: ImageBitmap;
            width: number;
            height: number;
          }>((resolve) => {
            resolveSlow1 = resolve;
          }),
      )
      .mockImplementation(async () => ({
        bitmap: createFakeBitmap(1),
        width: 101,
        height: 201,
      }));

    const pool = new DecodeWorkerPool([
      {
        api: { decodePageSlice: decode0 },
        subscribeError: (listener) => {
          fireError0 = listener;
          return unsubscribe0;
        },
        terminate: vi.fn(),
      },
      {
        api: { decodePageSlice: decode1 },
        subscribeError: (listener) => {
          fireError1 = listener;
          return unsubscribe1;
        },
        terminate: vi.fn(),
      },
    ]);

    // Slot 0 に 2件投入（両方保留）、Slot 1 に 1件投入（active=1 で処理中）
    const pending0a = pool.decodePageSlice(new Uint8Array([1]), 0);
    const pending1 = pool.decodePageSlice(new Uint8Array([2]), 0);
    const pending0b = pool.decodePageSlice(new Uint8Array([3]), 0);

    // Slot 0 がエラー終了 -> pending0a / pending0b は即座に DECODE_FAILED で reject され、購読解除される
    const staleListener0 = fireError0;
    staleListener0?.(new Event("error"));

    await expect(pending0a).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "DECODE_FAILED",
    });
    await expect(pending0b).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "DECODE_FAILED",
    });
    expect(unsubscribe0).toHaveBeenCalledTimes(1);

    // 同一スロットへの重複通知は無視されること
    staleListener0?.(new Event("error"));
    expect(unsubscribe0).toHaveBeenCalledTimes(1);

    // Slot 0 の元プロミスが後から resolve / reject しても影響しないこと
    resolveHanging0({
      bitmap: createFakeBitmap(9),
      width: 99,
      height: 99,
    });
    rejectHanging0(new Error("late rejection on broken slot"));
    await Promise.resolve();

    // 健全な Slot 1 が処理中 (activeCount=1) でも、壊れた Slot 0 には絶対割り当てず Slot 1 へルーティングすること
    const nextOnHealthy1 = pool.decodePageSlice(new Uint8Array([4]), 8);
    expect(decode0).toHaveBeenCalledTimes(2);
    expect(decode1).toHaveBeenCalledTimes(2);

    resolveSlow1({
      bitmap: createFakeBitmap(1),
      width: 101,
      height: 201,
    });
    await expect(pending1).resolves.toMatchObject({ width: 101 });
    await expect(nextOnHealthy1).resolves.toMatchObject({ width: 101 });

    // Slot 1 も壊れて全スロット broken になった場合、後続呼び出しを即座に DECODE_FAILED で reject すること
    fireError1?.(new Event("messageerror"));
    expect(unsubscribe1).toHaveBeenCalledTimes(1);

    await expect(
      pool.decodePageSlice(new Uint8Array([5]), 0),
    ).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "DECODE_FAILED",
    });
    expect(decode0).toHaveBeenCalledTimes(2);
    expect(decode1).toHaveBeenCalledTimes(2);

    // broken 済みスロットを再度 dispose しても二重 unsubscribe しないこと
    pool.dispose();
    expect(unsubscribe0).toHaveBeenCalledTimes(1);
    expect(unsubscribe1).toHaveBeenCalledTimes(1);
  });

  it("dispose時にunsubscribeError呼び出し・保留中デコードのDECODE_FAILED解放・同期throw保護を安全に行うこと", async () => {
    let retainedListener: ((event: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const terminate = vi.fn();
    let resolveHanging!: (val: {
      bitmap: ImageBitmap;
      width: number;
      height: number;
    }) => void;
    let rejectHanging2!: (err: unknown) => void;

    const decode = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("sync decode failure");
      })
      .mockImplementationOnce(
        () =>
          new Promise<{
            bitmap: ImageBitmap;
            width: number;
            height: number;
          }>((resolve) => {
            resolveHanging = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<{
            bitmap: ImageBitmap;
            width: number;
            height: number;
          }>((_, reject) => {
            rejectHanging2 = reject;
          }),
      );

    const pool = new DecodeWorkerPool([
      {
        api: { decodePageSlice: decode },
        subscribeError: (listener) => {
          retainedListener = listener;
          return unsubscribe;
        },
        terminate,
      },
    ]);

    // 同期 throw が安全に Promise reject され activeCount も復元されること
    await expect(pool.decodePageSlice(new Uint8Array([1]), 0)).rejects.toThrow(
      "sync decode failure",
    );

    const pendingResolveAfterDispose = pool.decodePageSlice(
      new Uint8Array([2]),
      0,
    );
    const pendingRejectAfterDispose = pool.decodePageSlice(
      new Uint8Array([3]),
      0,
    );

    pool.dispose();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);

    await expect(pendingResolveAfterDispose).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "DECODE_FAILED",
    });
    await expect(pendingRejectAfterDispose).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "DECODE_FAILED",
    });

    // dispose 後の遅延リスナー発火や遅延 resolve/reject が無害であること
    retainedListener?.(new Event("error"));
    resolveHanging({
      bitmap: createFakeBitmap(0),
      width: 100,
      height: 200,
    });
    rejectHanging2(new Error("late failure after dispose"));
    await Promise.resolve();
  });
});
