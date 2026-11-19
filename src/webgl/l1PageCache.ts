import { ENGINE_BUDGETS } from "../engine/constants";
import type { DecodedPageFrame } from "../engine/types";

export type ReadyPageFrame = Extract<DecodedPageFrame, { status: "ready" }>;

export interface L1PageCacheOptions {
  readonly maxPages?: number;
  readonly onEvictTexture?: (pageIndex: number) => void;
}

export class L1PageCache {
  readonly maxPages: number;

  constructor(options: L1PageCacheOptions = {}) {
    this.maxPages = options.maxPages ?? ENGINE_BUDGETS.L1_MAX_PAGES;
  }

  get size(): number {
    return 0;
  }

  setMinActiveEpoch(_epoch: number): void {}

  put(_frame: DecodedPageFrame, _protectedPages?: Iterable<number>): boolean {
    return false;
  }

  get(_pageIndex: number): DecodedPageFrame | undefined {
    return undefined;
  }

  peek(_pageIndex: number): DecodedPageFrame | undefined {
    return undefined;
  }

  getReadyEntries(): ReadyPageFrame[] {
    return [];
  }

  delete(_pageIndex: number): boolean {
    return false;
  }

  clear(): void {}
}
