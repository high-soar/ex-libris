export interface EngineBudgets {
  readonly INITIAL_TAIL_READ_BYTES: number;
  readonly LFH_EXTRA_MARGIN_BYTES: number;
  readonly MAX_COALESCE_GAP_BYTES: number;
  readonly WARM_PREFETCH_BUDGET_BYTES: number;
  readonly L2_CACHE_MAX_BYTES: number;
  readonly L1_MAX_PAGES: number;
  readonly DECODE_WORKER_POOL_SIZE: number;
  readonly COVER_BG_MAX_PER_SECOND: number;
}

export const ENGINE_BUDGETS = {
  INITIAL_TAIL_READ_BYTES: 131_072,
  LFH_EXTRA_MARGIN_BYTES: 1_024,
  MAX_COALESCE_GAP_BYTES: 65_536,
  WARM_PREFETCH_BUDGET_BYTES: 10_485_760,
  L2_CACHE_MAX_BYTES: 83_886_080,
  L1_MAX_PAGES: 5,
  DECODE_WORKER_POOL_SIZE: 2,
  COVER_BG_MAX_PER_SECOND: 2,
} as const satisfies EngineBudgets;
