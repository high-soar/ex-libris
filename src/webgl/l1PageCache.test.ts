import { describe, expect, it, vi } from "vitest";
import { ENGINE_BUDGETS } from "../engine/constants";
import type { DecodedPageFrame } from "../engine/types";
import { L1PageCache } from "./l1PageCache";

function createFakeBitmap(width = 800, height = 1200): ImageBitmap {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

function createReadyFrame(
  pageIndex: number,
  epoch = 1,
  bitmap = createFakeBitmap(),
): Extract<DecodedPageFrame, { status: "ready" }> {
  return {
    status: "ready",
    pageIndex,
    epoch,
    width: bitmap.width,
    height: bitmap.height,
    bitmap,
  };
}

function createErrorFrame(
  pageIndex: number,
  epoch = 1,
): Extract<DecodedPageFrame, { status: "error" }> {
  return {
    status: "error",
    pageIndex,
    epoch,
    errorCode: "DECODE_FAILED",
    message: `ページ ${pageIndex} のデコードに失敗しました`,
  };
}

describe("L1PageCache", () => {
  it("既定上限がENGINE_BUDGETS.L1_MAX_PAGESであり最小1にクランプされること (AC-GL-01)", () => {
    const defaultCache = new L1PageCache();
    expect(defaultCache.maxPages).toBe(ENGINE_BUDGETS.L1_MAX_PAGES);
    expect(defaultCache.size).toBe(0);

    const clampedZero = new L1PageCache({ maxPages: 0 });
    expect(clampedZero.maxPages).toBe(1);

    const clampedNegative = new L1PageCache({ maxPages: -3 });
    expect(clampedNegative.maxPages).toBe(1);

    const nanFallback = new L1PageCache({ maxPages: Number.NaN });
    expect(nanFallback.maxPages).toBe(ENGINE_BUDGETS.L1_MAX_PAGES);

    const customCache = new L1PageCache({ maxPages: 3 });
    expect(customCache.maxPages).toBe(3);
  });

  it("ready/errorフレームを格納しgetでLRU更新・peekでLRU非更新・getReadyEntriesでreadyのみ取得できること", () => {
    const cache = new L1PageCache({ maxPages: 3 });
    const frame0 = createReadyFrame(0);
    const frame1 = createErrorFrame(1);
    const frame2 = createReadyFrame(2);
    const frame3 = createReadyFrame(3);

    expect(cache.put(frame0)).toBe(true);
    expect(cache.put(frame1)).toBe(true);
    expect(cache.put(frame2)).toBe(true);
    expect(cache.size).toBe(3);

    // peek は LRU 順を更新しない（0 が最古のまま）
    expect(cache.peek(0)).toBe(frame0);
    expect(cache.peek(99)).toBeUndefined();

    // get は LRU 順を更新する（0 を MRU へ移動し、1 が最古になる）
    expect(cache.get(0)).toBe(frame0);
    expect(cache.get(99)).toBeUndefined();

    // ready エントリのみ返却される（error の page 1 は除外）
    expect(cache.getReadyEntries()).toEqual([frame2, frame0]);

    // 4件目追加で最古 LRU の page 1 (error) が退避され、page 0 は残る
    expect(cache.put(frame3)).toBe(true);
    expect(cache.peek(1)).toBeUndefined();
    expect(cache.peek(0)).toBe(frame0);
    expect(cache.size).toBe(3);
  });

  it("古いepochのフレームはキャッシュせずreadyなら即座にbitmap.close()してfalseを返すこと (AC-GL-01)", () => {
    const onEvictTexture = vi.fn();
    const cache = new L1PageCache({ onEvictTexture });

    const validFrame = createReadyFrame(0, 5);
    expect(cache.put(validFrame)).toBe(true);

    cache.setMinActiveEpoch(5);

    const staleReady = createReadyFrame(0, 4);
    expect(cache.put(staleReady)).toBe(false);
    expect(staleReady.bitmap.close).toHaveBeenCalledTimes(1);
    expect(cache.peek(0)).toBe(validFrame);
    expect(onEvictTexture).not.toHaveBeenCalled();

    const staleError = createErrorFrame(1, 3);
    expect(cache.put(staleError)).toBe(false);
    expect(cache.peek(1)).toBeUndefined();
  });

  it("同一ページ上書き時は旧readyのonEvictTextureとbitmap.close()を実行し同一bitmap参照時は多重closeを防ぐこと (AC-GL-01)", () => {
    const onEvictTexture = vi.fn();
    const cache = new L1PageCache({ onEvictTexture });

    const bitmapA = createFakeBitmap();
    const bitmapB = createFakeBitmap();
    const frameA1 = createReadyFrame(2, 1, bitmapA);
    const frameA2SameBitmap = createReadyFrame(2, 2, bitmapA);
    const frameB = createReadyFrame(2, 3, bitmapB);

    expect(cache.put(frameA1)).toBe(true);

    // 同一 bitmap 参照での上書きは close / テクスチャ破棄を行わない
    expect(cache.put(frameA2SameBitmap)).toBe(true);
    expect(bitmapA.close).not.toHaveBeenCalled();
    expect(onEvictTexture).not.toHaveBeenCalled();
    expect(cache.peek(2)).toBe(frameA2SameBitmap);

    // 別 bitmap での上書きは旧 bitmap.close() と onEvictTexture を実行する
    expect(cache.put(frameB)).toBe(true);
    expect(bitmapA.close).toHaveBeenCalledTimes(1);
    expect(onEvictTexture).toHaveBeenCalledTimes(1);
    expect(onEvictTexture).toHaveBeenCalledWith(2);
    expect(bitmapB.close).not.toHaveBeenCalled();

    // ready を error で上書きした場合も旧 ready を解放する
    expect(cache.put(createErrorFrame(2, 4))).toBe(true);
    expect(bitmapB.close).toHaveBeenCalledTimes(1);
    expect(onEvictTexture).toHaveBeenCalledTimes(2);

    // error を ready で上書きした場合は旧エントリ解放コールバックは呼ばれない
    const bitmapC = createFakeBitmap();
    expect(cache.put(createReadyFrame(2, 5, bitmapC))).toBe(true);
    expect(onEvictTexture).toHaveBeenCalledTimes(2);
  });

  it("上限超過時はprotectedPages外の最古LRUから優先退避し全保護時は最古へフォールバックすること (AC-GL-01)", () => {
    const evictedPages: number[] = [];
    const cache = new L1PageCache({
      onEvictTexture: (pageIndex) => evictedPages.push(pageIndex),
    });

    const frames = [0, 1, 2, 3, 4].map((p) => createReadyFrame(p, 1));
    for (const f of frames) {
      expect(cache.put(f)).toBe(true);
    }
    expect(cache.size).toBe(5);

    // page 0, 1, 3, 4 を保護して page 5 を追加 -> 最古の非保護 page 2 が退避される
    const frame5 = createReadyFrame(5, 1);
    expect(cache.put(frame5, [0, 1, 3, 4])).toBe(true);
    expect(evictedPages).toEqual([2]);
    expect(frames[2]!.bitmap.close).toHaveBeenCalledTimes(1);
    expect(cache.peek(2)).toBeUndefined();
    expect(cache.size).toBe(5);

    // 現在キャッシュ内は [0, 1, 3, 4, 5]。すべて保護して page 6 を追加 -> 最古の page 0 へフォールバック
    const frame6 = createReadyFrame(6, 1);
    expect(cache.put(frame6, [0, 1, 3, 4, 5])).toBe(true);
    expect(evictedPages).toEqual([2, 0]);
    expect(frames[0]!.bitmap.close).toHaveBeenCalledTimes(1);
    expect(cache.peek(0)).toBeUndefined();
    expect(cache.size).toBe(5);
  });

  it("maxPages=1で既存ページが保護されている場合も最古を退避して新フレームを保持できること (AC-GL-01)", () => {
    const onEvictTexture = vi.fn();
    const cache = new L1PageCache({ maxPages: 1, onEvictTexture });
    const frame0 = createReadyFrame(0);
    const frame1 = createReadyFrame(1);

    expect(cache.put(frame0, [0])).toBe(true);
    expect(cache.put(frame1, [0])).toBe(true);

    expect(onEvictTexture).toHaveBeenCalledWith(0);
    expect(frame0.bitmap.close).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
    expect(cache.peek(1)).toBe(frame1);
  });

  it("deleteおよびclear時に保持中の全readyエントリをonEvictTextureとbitmap.close()で即座に解放すること (AC-GL-01)", () => {
    const onEvictTexture = vi.fn();
    const cache = new L1PageCache({ onEvictTexture });

    const frame0 = createReadyFrame(0);
    const frame1 = createErrorFrame(1);
    const frame2 = createReadyFrame(2);

    cache.put(frame0);
    cache.put(frame1);
    cache.put(frame2);

    expect(cache.delete(99)).toBe(false);
    expect(cache.delete(0)).toBe(true);
    expect(onEvictTexture).toHaveBeenCalledTimes(1);
    expect(onEvictTexture).toHaveBeenCalledWith(0);
    expect(frame0.bitmap.close).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(2);

    cache.clear();
    expect(onEvictTexture).toHaveBeenCalledTimes(2);
    expect(onEvictTexture).toHaveBeenLastCalledWith(2);
    expect(frame2.bitmap.close).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
    expect(cache.getReadyEntries()).toEqual([]);

    // onEvictTexture 未指定キャッシュでも clear / delete が安全に動作すること
    const noCallbackCache = new L1PageCache();
    const frame3 = createReadyFrame(3);
    noCallbackCache.put(frame3);
    expect(noCallbackCache.delete(3)).toBe(true);
    expect(frame3.bitmap.close).toHaveBeenCalledTimes(1);
  });
});
