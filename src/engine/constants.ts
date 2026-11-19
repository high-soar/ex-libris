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

export const ENGINE_BUDGETS: EngineBudgets = {
  INITIAL_TAIL_READ_BYTES: 0,
  LFH_EXTRA_MARGIN_BYTES: 0,
  MAX_COALESCE_GAP_BYTES: 0,
  WARM_PREFETCH_BUDGET_BYTES: 0,
  L2_CACHE_MAX_BYTES: 0,
  L1_MAX_PAGES: 0,
  DECODE_WORKER_POOL_SIZE: 0,
  COVER_BG_MAX_PER_SECOND: 0,
};
