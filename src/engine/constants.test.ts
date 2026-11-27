import { describe, expect, it } from "vitest";
import { ENGINE_BUDGETS } from "./constants";

describe("ENGINE_BUDGETS", () => {
  it("architecture.md §2.1 で定義されたメモリ・ストリーミング予算定数を公開すること", () => {
    expect(ENGINE_BUDGETS.INITIAL_TAIL_READ_BYTES).toBe(131_072);
    expect(ENGINE_BUDGETS.LFH_EXTRA_MARGIN_BYTES).toBe(1_024);
    expect(ENGINE_BUDGETS.MAX_COALESCE_GAP_BYTES).toBe(65_536);
    expect(ENGINE_BUDGETS.WARM_PREFETCH_BUDGET_BYTES).toBe(10_485_760);
    expect(ENGINE_BUDGETS.L2_CACHE_MAX_BYTES).toBe(83_886_080);
    expect(ENGINE_BUDGETS.L1_MAX_PAGES).toBe(5);
    expect(ENGINE_BUDGETS.DECODE_WORKER_POOL_SIZE).toBe(2);
    expect(ENGINE_BUDGETS.COVER_BG_MAX_PER_SECOND).toBe(2);
    expect(ENGINE_BUDGETS.COVER_MAX_LONG_EDGE_PX).toBe(350);
    expect(ENGINE_BUDGETS.COVER_WEBP_QUALITY).toBe(0.8);
    expect(ENGINE_BUDGETS.COVER_RATE_LIMIT_MAX_RETRIES).toBe(3);
    expect(ENGINE_BUDGETS.COVER_RATE_LIMIT_BASE_BACKOFF_MS).toBe(1_000);
  });
});
