import { describe, expect, it } from "vitest";
import { ENGINE_BUDGETS } from "../constants";
import { isSharedBuffer } from "../workers/coordinatorTransfer";
import { L2ByteCache } from "./L2ByteCache";

function createSlice(size: number, fill = 0x11): Uint8Array {
  return new Uint8Array(size).fill(fill);
}

describe("L2ByteCache", () => {
  it("既定上限がENGINE_BUDGETS.L2_CACHE_MAX_BYTESであり非有限値フォールバック・1未満クランプ・小数切り捨てが行われること (AC-ENG-12)", () => {
    const defaultCache = new L2ByteCache();
    expect(defaultCache.maxBytes).toBe(ENGINE_BUDGETS.L2_CACHE_MAX_BYTES);
    expect(defaultCache.size).toBe(0);
    expect(defaultCache.totalBytes).toBe(0);

    expect(new L2ByteCache({ maxBytes: Number.NaN }).maxBytes).toBe(
      ENGINE_BUDGETS.L2_CACHE_MAX_BYTES,
    );
    expect(
      new L2ByteCache({ maxBytes: Number.POSITIVE_INFINITY }).maxBytes,
    ).toBe(ENGINE_BUDGETS.L2_CACHE_MAX_BYTES);
    expect(new L2ByteCache({ maxBytes: 0 }).maxBytes).toBe(1);
    expect(new L2ByteCache({ maxBytes: -512 }).maxBytes).toBe(1);
    expect(new L2ByteCache({ maxBytes: 0.7 }).maxBytes).toBe(1);
    expect(new L2ByteCache({ maxBytes: 1024.9 }).maxBytes).toBe(1024);
  });

  it("通常エントリ格納時にgetでMRU昇格・peekで非更新となり容量超過時は最古LRUから退避しdelete・clearで解放されること (AC-ENG-12)", () => {
    const cache = new L2ByteCache({ maxBytes: 100 });
    const slice0 = createSlice(40, 1);
    const slice1 = createSlice(40, 2);
    const slice2 = createSlice(30, 3);
    const slice3 = createSlice(40, 4);

    expect(cache.put(0, slice0)).toBe(true);
    expect(cache.put(1, slice1)).toBe(true);
    expect(cache.size).toBe(2);
    expect(cache.totalBytes).toBe(80);
    expect(cache.has(0)).toBe(true);
    expect(cache.has(99)).toBe(false);

    // peek は LRU 順を更新しない（0 が最古のまま）
    expect(cache.peek(0)).toBe(slice0);
    expect(cache.peek(99)).toBeUndefined();

    // get は LRU 順を更新する（0 を MRU へ移動し、1 が最古になる）
    expect(cache.get(0)).toBe(slice0);
    expect(cache.get(99)).toBeUndefined();

    // 30B 追加で合計 110B > 100B -> 最古 LRU の 1 (40B) が退避され、0 + 2 = 70B が残る
    expect(cache.put(2, slice2)).toBe(true);
    expect(cache.has(1)).toBe(false);
    expect(cache.has(0)).toBe(true);
    expect(cache.totalBytes).toBe(70);

    // 同一 pageIndex 上書き時は旧サイズを減算して差し替え
    const slice0Updated = createSlice(50, 5);
    expect(cache.put(0, slice0Updated)).toBe(true);
    expect(cache.totalBytes).toBe(80);
    expect(cache.peek(0)).toBe(slice0Updated);

    // delete の成否
    expect(cache.delete(99)).toBe(false);
    expect(cache.delete(2)).toBe(true);
    expect(cache.totalBytes).toBe(50);
    expect(cache.size).toBe(1);

    // 40B 追加（50+40=90 <= 100）後、clear で全解放
    expect(cache.put(3, slice3)).toBe(true);
    expect(cache.totalBytes).toBe(90);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.totalBytes).toBe(0);
    expect(cache.has(0)).toBe(false);
    expect(cache.has(3)).toBe(false);
  });

  it("部分subarrayやSharedArrayBuffer入力時は独立ArrayBufferへ正規化し格納確定バッファへ必ずmarkSharedBufferを付与すること (AC-ENG-12, AC-ENG-14)", () => {
    const cache = new L2ByteCache({ maxBytes: 100 });

    // 1. 独立全体 ArrayBuffer
    const standalone = createSlice(8, 0xaa);
    expect(isSharedBuffer(standalone.buffer)).toBe(false);
    expect(cache.put(0, standalone)).toBe(true);
    expect(cache.peek(0)).toBe(standalone);
    expect(isSharedBuffer(standalone.buffer)).toBe(true);

    // 2. byteOffset > 0 の部分 subarray（10MB 結合バッファ居残りリーク防止）
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const offsetView = backing.subarray(2, 6);
    expect(cache.put(1, offsetView)).toBe(true);
    const stored1 = cache.peek(1)!;
    expect(stored1).not.toBe(offsetView);
    expect(stored1.buffer).not.toBe(backing.buffer);
    expect(stored1.byteOffset).toBe(0);
    expect(stored1.byteLength).toBe(4);
    expect(stored1.buffer.byteLength).toBe(4);
    expect(stored1).toEqual(new Uint8Array([3, 4, 5, 6]));
    expect(isSharedBuffer(stored1.buffer)).toBe(true);
    expect(isSharedBuffer(backing.buffer)).toBe(false);

    // 3. byteOffset === 0 かつ部分長 subarray
    const headView = backing.subarray(0, 3);
    expect(cache.put(2, headView)).toBe(true);
    const stored2 = cache.peek(2)!;
    expect(stored2.buffer).not.toBe(backing.buffer);
    expect(stored2.byteOffset).toBe(0);
    expect(stored2.buffer.byteLength).toBe(3);
    expect(stored2).toEqual(new Uint8Array([1, 2, 3]));
    expect(isSharedBuffer(stored2.buffer)).toBe(true);

    // 4. SharedArrayBuffer 由来ビュー
    const sab = new SharedArrayBuffer(4);
    const sabView = new Uint8Array(sab);
    sabView.set([9, 8, 7, 6]);
    expect(cache.put(3, sabView)).toBe(true);
    const stored3 = cache.peek(3)!;
    expect(stored3.buffer).toBeInstanceOf(ArrayBuffer);
    expect(stored3.buffer).not.toBe(sab);
    expect(stored3).toEqual(new Uint8Array([9, 8, 7, 6]));
    expect(isSharedBuffer(stored3.buffer)).toBe(true);
  });

  it("非ピン最古から優先してLRU退避し全候補がピン中通常ページなら最古を退避してmaxBytesを厳守すること (AC-ENG-12)", () => {
    const cache = new L2ByteCache({ maxBytes: 100 });
    cache.setPinnedPages([0, 2]);

    expect(cache.put(0, createSlice(40, 1))).toBe(true); // pinned
    expect(cache.put(1, createSlice(40, 2))).toBe(true); // unpinned
    expect(cache.put(2, createSlice(20, 3))).toBe(true); // pinned -> total 100

    // 30B 追加時、最古は page 0（ピン中）だが非ピンの page 1 (40B) を優先退避して 0 と 2 を残す
    expect(cache.put(3, createSlice(30, 4))).toBe(true);
    expect(cache.has(1)).toBe(false);
    expect(cache.has(0)).toBe(true);
    expect(cache.has(2)).toBe(true);
    expect(cache.totalBytes).toBe(90);

    // 全てピン対象にした上で超過追加 -> 最古の page 0 を退避して maxBytes を厳守
    cache.setPinnedPages([0, 2, 3]);
    expect(cache.put(4, createSlice(20, 5))).toBe(true);
    expect(cache.has(0)).toBe(false);
    expect(cache.has(2)).toBe(true);
    expect(cache.has(3)).toBe(true);
    expect(cache.has(4)).toBe(true);
    expect(cache.totalBytes).toBe(70);
  });

  it("80MB超例外ページはallowOversized=true時のみ全退避で単一保持しピン中保護・複数並列スキップ・ピン解除時即時退避を行うこと (AC-ENG-12)", () => {
    const cache = new L2ByteCache({ maxBytes: 100 });
    expect(cache.put(0, createSlice(40, 1))).toBe(true);

    // 1. allowOversized 未指定 / false の超過ページは既存を壊さず false スキップ
    const oversizedRejected = createSlice(120, 2);
    expect(cache.put(1, oversizedRejected)).toBe(false);
    expect(cache.put(1, oversizedRejected, { allowOversized: false })).toBe(
      false,
    );
    expect(cache.has(0)).toBe(true);
    expect(cache.totalBytes).toBe(40);
    expect(isSharedBuffer(oversizedRejected.buffer)).toBe(false);

    // 2. 表示ページ（pinnedPages=[1]）かつ allowOversized: true なら既存全退避して 1 件一時保持
    cache.setPinnedPages([1, 2]);
    const oversizedPage1 = createSlice(120, 3);
    expect(cache.put(1, oversizedPage1, { allowOversized: true })).toBe(true);
    expect(cache.has(0)).toBe(false);
    expect(cache.size).toBe(1);
    expect(cache.totalBytes).toBe(120);
    expect(cache.hasOversizedPinnedEntry()).toBe(true);
    expect(isSharedBuffer(oversizedPage1.buffer)).toBe(true);

    // 3. 80MB 超ピン中エントリ保持中は、別ページの allowOversized: true (超過・通常双方) も allowOversized: false もスキップして保護
    const oversizedPage2 = createSlice(130, 4);
    expect(cache.put(2, oversizedPage2, { allowOversized: true })).toBe(false);
    expect(cache.put(2, createSlice(30, 5), { allowOversized: true })).toBe(
      false,
    );
    expect(cache.put(3, createSlice(30, 6), { allowOversized: false })).toBe(
      false,
    );
    expect(cache.size).toBe(1);
    expect(cache.peek(1)).toBe(oversizedPage1);

    // 4. 同一 pageIndex=1 を通常サイズで再格納する場合は既存 1 を先に削除するため格納成功する
    expect(cache.put(1, createSlice(50, 7))).toBe(true);
    expect(cache.hasOversizedPinnedEntry()).toBe(false);
    expect(cache.totalBytes).toBe(50);

    // 5. 再び 1 を 80MB 超一時保持させ、setPinnedPages でピン対象外にしたら即座に退避して totalBytes <= maxBytes へ戻す
    expect(cache.put(1, oversizedPage1, { allowOversized: true })).toBe(true);
    expect(cache.totalBytes).toBe(120);
    expect(cache.hasOversizedPinnedEntry()).toBe(true);

    // ピンに含めたままなら保持継続
    cache.setPinnedPages([1]);
    expect(cache.has(1)).toBe(true);
    expect(cache.totalBytes).toBe(120);

    // ピン対象から外した瞬間に即座に退避
    cache.setPinnedPages([2]);
    expect(cache.has(1)).toBe(false);
    expect(cache.size).toBe(0);
    expect(cache.totalBytes).toBe(0);
    expect(cache.hasOversizedPinnedEntry()).toBe(false);

    // 6. 非ピンの 80MB 超エントリが保持されている場合、hasOversizedPinnedEntry は false であり通常ページ投入で退避される
    cache.setPinnedPages([]);
    expect(cache.put(4, oversizedPage1, { allowOversized: true })).toBe(true);
    expect(cache.hasOversizedPinnedEntry()).toBe(false);
    expect(cache.put(5, createSlice(20, 8))).toBe(true);
    expect(cache.has(4)).toBe(false);
    expect(cache.has(5)).toBe(true);
    expect(cache.totalBytes).toBe(20);
  });
});
