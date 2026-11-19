import { ENGINE_BUDGETS } from "../engine/constants";
import type { DecodedPageFrame } from "../engine/types";

export type ReadyPageFrame = Extract<DecodedPageFrame, { status: "ready" }>;

export interface L1PageCacheOptions {
  readonly maxPages?: number;
  readonly onEvictTexture?: (pageIndex: number) => void;
}

function normalizeMaxPages(rawMaxPages?: number): number {
  if (rawMaxPages === undefined || !Number.isFinite(rawMaxPages)) {
    return ENGINE_BUDGETS.L1_MAX_PAGES;
  }
  return Math.max(1, Math.floor(rawMaxPages));
}

export class L1PageCache {
  readonly maxPages: number;
  private readonly onEvictTexture?: (pageIndex: number) => void;
  private readonly entries = new Map<number, DecodedPageFrame>();
  private minActiveEpoch = 0;

  constructor(options: L1PageCacheOptions = {}) {
    this.maxPages = normalizeMaxPages(options.maxPages);
    this.onEvictTexture = options.onEvictTexture;
  }

  get size(): number {
    return this.entries.size;
  }

  setMinActiveEpoch(epoch: number): void {
    this.minActiveEpoch = epoch;
  }

  put(frame: DecodedPageFrame, protectedPages?: Iterable<number>): boolean {
    if (frame.epoch < this.minActiveEpoch) {
      if (frame.status === "ready") {
        frame.bitmap.close();
      }
      return false;
    }

    const existing = this.entries.get(frame.pageIndex);
    if (existing !== undefined) {
      this.entries.delete(frame.pageIndex);
      const isSameBitmap =
        existing.status === "ready" &&
        frame.status === "ready" &&
        existing.bitmap === frame.bitmap;
      if (!isSameBitmap) {
        this.releaseEntry(frame.pageIndex, existing);
      }
    }

    while (this.entries.size >= this.maxPages) {
      const [evictPageIndex, evictEntry] =
        this.selectEvictionEntry(protectedPages);
      this.entries.delete(evictPageIndex);
      this.releaseEntry(evictPageIndex, evictEntry);
    }

    this.entries.set(frame.pageIndex, frame);
    return true;
  }

  get(pageIndex: number): DecodedPageFrame | undefined {
    const entry = this.entries.get(pageIndex);
    if (entry === undefined) {
      return undefined;
    }
    this.entries.delete(pageIndex);
    this.entries.set(pageIndex, entry);
    return entry;
  }

  peek(pageIndex: number): DecodedPageFrame | undefined {
    return this.entries.get(pageIndex);
  }

  getReadyEntries(): ReadyPageFrame[] {
    const ready: ReadyPageFrame[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status === "ready") {
        ready.push(entry);
      }
    }
    return ready;
  }

  delete(pageIndex: number): boolean {
    const entry = this.entries.get(pageIndex);
    if (entry === undefined) {
      return false;
    }
    this.entries.delete(pageIndex);
    this.releaseEntry(pageIndex, entry);
    return true;
  }

  clear(): void {
    for (const [pageIndex, entry] of this.entries.entries()) {
      this.releaseEntry(pageIndex, entry);
    }
    this.entries.clear();
  }

  private releaseEntry(pageIndex: number, entry: DecodedPageFrame): void {
    if (entry.status === "ready") {
      this.onEvictTexture?.(pageIndex);
      entry.bitmap.close();
    }
  }

  private selectEvictionEntry(
    protectedPages?: Iterable<number>,
  ): [number, DecodedPageFrame] {
    const protectedSet = protectedPages ? new Set(protectedPages) : null;
    let firstEntry: [number, DecodedPageFrame] | undefined;
    for (const entry of this.entries.entries()) {
      if (firstEntry === undefined) {
        firstEntry = entry;
      }
      if (protectedSet === null || !protectedSet.has(entry[0])) {
        return entry;
      }
    }
    return firstEntry as [number, DecodedPageFrame];
  }
}
