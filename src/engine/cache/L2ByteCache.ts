import { ENGINE_BUDGETS } from "../constants";

export interface L2ByteCacheOptions {
  readonly maxBytes?: number;
}

export interface L2ByteCachePutOptions {
  readonly allowOversized?: boolean;
}

export class L2ByteCache {
  readonly maxBytes: number;

  constructor(_options: L2ByteCacheOptions = {}) {
    this.maxBytes = ENGINE_BUDGETS.L2_CACHE_MAX_BYTES;
  }

  get size(): number {
    return 0;
  }

  get totalBytes(): number {
    return 0;
  }

  has(_pageIndex: number): boolean {
    return false;
  }

  peek(_pageIndex: number): Uint8Array | undefined {
    return undefined;
  }

  get(_pageIndex: number): Uint8Array | undefined {
    return undefined;
  }

  delete(_pageIndex: number): boolean {
    return false;
  }

  clear(): void {
    // Red: Greenステップで実装
  }

  setPinnedPages(_pageIndices: Iterable<number>): void {
    // Red: Greenステップで実装
  }

  hasOversizedPinnedEntry(): boolean {
    return false;
  }

  put(
    _pageIndex: number,
    _data: Uint8Array,
    _options?: L2ByteCachePutOptions,
  ): boolean {
    return false;
  }
}
