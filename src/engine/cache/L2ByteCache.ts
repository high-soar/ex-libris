import { ENGINE_BUDGETS } from "../constants";
import { markSharedBuffer } from "../workers/coordinatorTransfer";

export interface L2ByteCacheOptions {
  readonly maxBytes?: number;
}

export interface L2ByteCachePutOptions {
  readonly allowOversized?: boolean;
}

function normalizeMaxBytes(rawMaxBytes?: number): number {
  if (rawMaxBytes === undefined || !Number.isFinite(rawMaxBytes)) {
    return ENGINE_BUDGETS.L2_CACHE_MAX_BYTES;
  }
  return Math.max(1, Math.floor(rawMaxBytes));
}

function normalizeStoredSlice(data: Uint8Array): Uint8Array {
  if (
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength &&
    data.buffer instanceof ArrayBuffer
  ) {
    return data;
  }
  return data.slice();
}

export class L2ByteCache {
  readonly maxBytes: number;
  private readonly entries = new Map<number, Uint8Array>();
  private readonly pinnedPages = new Set<number>();
  private currentTotalBytes = 0;

  constructor(options: L2ByteCacheOptions = {}) {
    this.maxBytes = normalizeMaxBytes(options.maxBytes);
  }

  get size(): number {
    return this.entries.size;
  }

  get totalBytes(): number {
    return this.currentTotalBytes;
  }

  has(pageIndex: number): boolean {
    return this.entries.has(pageIndex);
  }

  peek(pageIndex: number): Uint8Array | undefined {
    return this.entries.get(pageIndex);
  }

  get(pageIndex: number): Uint8Array | undefined {
    const entry = this.entries.get(pageIndex);
    if (entry === undefined) {
      return undefined;
    }
    this.entries.delete(pageIndex);
    this.entries.set(pageIndex, entry);
    return entry;
  }

  delete(pageIndex: number): boolean {
    const entry = this.entries.get(pageIndex);
    if (entry === undefined) {
      return false;
    }
    this.entries.delete(pageIndex);
    this.currentTotalBytes -= entry.byteLength;
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.pinnedPages.clear();
    this.currentTotalBytes = 0;
  }

  setPinnedPages(pageIndices: Iterable<number>): void {
    this.pinnedPages.clear();
    for (const pageIndex of pageIndices) {
      this.pinnedPages.add(pageIndex);
    }
    for (const [pageIndex, entry] of this.entries.entries()) {
      if (
        entry.byteLength > this.maxBytes &&
        !this.pinnedPages.has(pageIndex)
      ) {
        this.entries.delete(pageIndex);
        this.currentTotalBytes -= entry.byteLength;
      }
    }
  }

  hasOversizedPinnedEntry(): boolean {
    for (const [pageIndex, entry] of this.entries.entries()) {
      if (entry.byteLength > this.maxBytes && this.pinnedPages.has(pageIndex)) {
        return true;
      }
    }
    return false;
  }

  put(
    pageIndex: number,
    data: Uint8Array,
    options?: L2ByteCachePutOptions,
  ): boolean {
    const existing = this.entries.get(pageIndex);
    if (existing !== undefined) {
      this.entries.delete(pageIndex);
      this.currentTotalBytes -= existing.byteLength;
    }

    if (data.byteLength > this.maxBytes) {
      if (options?.allowOversized !== true || this.hasOversizedPinnedEntry()) {
        return false;
      }
      this.entries.clear();
      this.currentTotalBytes = 0;
      this.storeNormalizedEntry(pageIndex, data);
      return true;
    }

    if (this.hasOversizedPinnedEntry()) {
      return false;
    }

    while (this.currentTotalBytes + data.byteLength > this.maxBytes) {
      const evictPageIndex = this.selectEvictionPageIndex();
      const evictEntry = this.entries.get(evictPageIndex) as Uint8Array;
      this.entries.delete(evictPageIndex);
      this.currentTotalBytes -= evictEntry.byteLength;
    }

    this.storeNormalizedEntry(pageIndex, data);
    return true;
  }

  private storeNormalizedEntry(pageIndex: number, data: Uint8Array): void {
    const stored = normalizeStoredSlice(data);
    markSharedBuffer(stored.buffer);
    this.entries.set(pageIndex, stored);
    this.currentTotalBytes += stored.byteLength;
  }

  private selectEvictionPageIndex(): number {
    let firstPageIndex: number | undefined;
    for (const pageIndex of this.entries.keys()) {
      if (firstPageIndex === undefined) {
        firstPageIndex = pageIndex;
      }
      if (!this.pinnedPages.has(pageIndex)) {
        return pageIndex;
      }
    }
    return firstPageIndex as number;
  }
}
