import { describe, expect, it } from "vitest";
import type { PageDimensions } from "../../webgl/types";
import {
  buildSpreadNeighborTargets,
  buildSpreadPrefetchTargets,
  buildSpreadProtectedWindow,
  computePreviousAnchorIndex,
  computeShiftedAnchorOnOffsetToggle,
  computeViewportSlotLayout,
  formatPageIndicator,
  getCandidateFetchPages,
  isLandscapeDimensions,
  resolveDirectionActionForKey,
  resolveDirectionActionForSwipe,
  resolveDirectionActionForTapRatio,
  resolveEffectiveSpreadMode,
} from "./spreadLayout";

describe("spreadLayout", () => {
  describe("resolveEffectiveSpreadMode", () => {
    it("autoモード時は正の有限寸法で横長ならspread、縦長・正方形・不正寸法ならsingleを返すこと (AC-RD-10)", () => {
      expect(resolveEffectiveSpreadMode("auto", 1280, 800)).toBe("spread");
      expect(resolveEffectiveSpreadMode("auto", 375, 667)).toBe("single");
      expect(resolveEffectiveSpreadMode("auto", 800, 800)).toBe("single");
      expect(resolveEffectiveSpreadMode("auto", 0, 800)).toBe("single");
      expect(resolveEffectiveSpreadMode("auto", 1280, 0)).toBe("single");
      expect(resolveEffectiveSpreadMode("auto", -1280, 800)).toBe("single");
      expect(resolveEffectiveSpreadMode("auto", 1280, -800)).toBe("single");
      expect(resolveEffectiveSpreadMode("auto", Number.NaN, 800)).toBe(
        "single",
      );
      expect(
        resolveEffectiveSpreadMode("auto", Number.POSITIVE_INFINITY, 800),
      ).toBe("single");
      expect(
        resolveEffectiveSpreadMode("auto", 1280, Number.POSITIVE_INFINITY),
      ).toBe("single");
    });

    it("singleおよびspread明示指定時はビューポート寸法に依存せず固定値を返すこと (AC-RD-10)", () => {
      expect(resolveEffectiveSpreadMode("single", 1280, 800)).toBe("single");
      expect(resolveEffectiveSpreadMode("spread", 375, 667)).toBe("spread");
      expect(resolveEffectiveSpreadMode("spread", 0, 0)).toBe("spread");
    });
  });

  describe("isLandscapeDimensions", () => {
    it("正の有限寸法でwidth > heightのときのみtrueを返し、正方形・縦長・不正値・未定義はfalseを返すこと (AC-RD-10)", () => {
      expect(isLandscapeDimensions({ width: 1600, height: 1200 })).toBe(true);
      expect(isLandscapeDimensions({ width: 1200, height: 1200 })).toBe(false);
      expect(isLandscapeDimensions({ width: 800, height: 1200 })).toBe(false);
      expect(isLandscapeDimensions(undefined)).toBe(false);
      expect(isLandscapeDimensions(null)).toBe(false);
      expect(isLandscapeDimensions({ width: 0, height: 1200 })).toBe(false);
      expect(isLandscapeDimensions({ width: 1200, height: 0 })).toBe(false);
      expect(isLandscapeDimensions({ width: -100, height: 100 })).toBe(false);
      expect(isLandscapeDimensions({ width: Number.NaN, height: 100 })).toBe(
        false,
      );
      expect(
        isLandscapeDimensions({
          width: 1200,
          height: Number.POSITIVE_INFINITY,
        }),
      ).toBe(false);
    });
  });

  describe("computeViewportSlotLayout & getCandidateFetchPages", () => {
    it("totalPages<=0時は空配列を返し、単ページ時や境界外インデックスは安全に単一centerスロットを返すこと", () => {
      expect(
        computeViewportSlotLayout({
          currentPageIndex: 0,
          totalPages: 0,
          effectiveSpreadMode: "spread",
          readingDirection: "rtl",
          spreadPageOffset: 0,
        }),
      ).toEqual({ slots: [] });
      expect(
        getCandidateFetchPages({
          currentPageIndex: 0,
          totalPages: 0,
          effectiveSpreadMode: "spread",
          spreadPageOffset: 0,
        }),
      ).toEqual([]);

      expect(
        computeViewportSlotLayout({
          currentPageIndex: 3,
          totalPages: 10,
          effectiveSpreadMode: "single",
          readingDirection: "rtl",
          spreadPageOffset: 0,
        }),
      ).toEqual({ slots: [{ pageIndex: 3, position: "center" }] });

      expect(
        computeViewportSlotLayout({
          currentPageIndex: -2,
          totalPages: 5,
          effectiveSpreadMode: "single",
          readingDirection: "ltr",
          spreadPageOffset: 0,
        }),
      ).toEqual({ slots: [{ pageIndex: 0, position: "center" }] });

      expect(
        computeViewportSlotLayout({
          currentPageIndex: 99,
          totalPages: 5,
          effectiveSpreadMode: "single",
          readingDirection: "ltr",
          spreadPageOffset: 0,
        }),
      ).toEqual({ slots: [{ pageIndex: 4, position: "center" }] });

      expect(
        computeViewportSlotLayout({
          currentPageIndex: Number.NaN,
          totalPages: 5,
          effectiveSpreadMode: "single",
          readingDirection: "rtl",
          spreadPageOffset: 0,
        }),
      ).toEqual({ slots: [{ pageIndex: 0, position: "center" }] });
    });

    it("表紙先頭・自身横長・相方横長・末尾頁では単一centerスロット、通常2頁見開きはrtl/ltrで左右配置を反転すること (AC-RD-10)", () => {
      const dimensions = new Map<number, PageDimensions>([
        [0, { width: 800, height: 1200 }],
        [1, { width: 800, height: 1200 }],
        [2, { width: 800, height: 1200 }],
        [3, { width: 1000, height: 1000 }], // 正方形は縦長扱い
        [4, { width: 1600, height: 1000 }], // 横長スキャン
        [5, { width: 800, height: 1200 }],
        [6, { width: 800, height: 1200 }],
      ]);

      // 1. 表紙先頭 (0 && offset===0) -> 単独中央 & 取得候補 [0]
      expect(
        computeViewportSlotLayout({
          currentPageIndex: 0,
          totalPages: 7,
          effectiveSpreadMode: "spread",
          readingDirection: "rtl",
          spreadPageOffset: 0,
          knownDimensions: dimensions,
        }),
      ).toEqual({ slots: [{ pageIndex: 0, position: "center" }] });
      expect(
        getCandidateFetchPages({
          currentPageIndex: 0,
          totalPages: 7,
          effectiveSpreadMode: "spread",
          spreadPageOffset: 0,
          knownDimensions: dimensions,
        }),
      ).toEqual([0]);

      // 2. 表紙先頭でも offset===1 なら [0, 1] 見開き
      expect(
        computeViewportSlotLayout({
          currentPageIndex: 0,
          totalPages: 7,
          effectiveSpreadMode: "spread",
          readingDirection: "rtl",
          spreadPageOffset: 1,
          knownDimensions: dimensions,
        }),
      ).toEqual({
        slots: [
          { pageIndex: 1, position: "left" },
          { pageIndex: 0, position: "right" },
        ],
      });
      expect(
        getCandidateFetchPages({
          currentPageIndex: 0,
          totalPages: 7,
          effectiveSpreadMode: "spread",
          spreadPageOffset: 1,
          knownDimensions: dimensions,
        }),
      ).toEqual([0, 1]);

      // 3. 通常見開き (rtl: [N+1@left, N@right], ltr: [N@left, N+1@right])
      expect(
        computeViewportSlotLayout({
          currentPageIndex: 1,
          totalPages: 7,
          effectiveSpreadMode: "spread",
          readingDirection: "rtl",
          spreadPageOffset: 0,
          knownDimensions: dimensions,
        }),
      ).toEqual({
        slots: [
          { pageIndex: 2, position: "left" },
          { pageIndex: 1, position: "right" },
        ],
      });
      expect(
        computeViewportSlotLayout({
          currentPageIndex: 1,
          totalPages: 7,
          effectiveSpreadMode: "spread",
          readingDirection: "ltr",
          spreadPageOffset: 0,
          knownDimensions: dimensions,
        }),
      ).toEqual({
        slots: [
          { pageIndex: 1, position: "left" },
          { pageIndex: 2, position: "right" },
        ],
      });

      // 4. 相方 (page 4) が横長なので page 3 (正方形) は単独中央表示
      expect(
        computeViewportSlotLayout({
          currentPageIndex: 3,
          totalPages: 7,
          effectiveSpreadMode: "spread",
          readingDirection: "rtl",
          spreadPageOffset: 0,
          knownDimensions: dimensions,
        }),
      ).toEqual({ slots: [{ pageIndex: 3, position: "center" }] });
      expect(
        getCandidateFetchPages({
          currentPageIndex: 3,
          totalPages: 7,
          effectiveSpreadMode: "spread",
          spreadPageOffset: 0,
          knownDimensions: dimensions,
        }),
      ).toEqual([3]);

      // 5. 自身 (page 4) が横長なので単独中央表示
      expect(
        computeViewportSlotLayout({
          currentPageIndex: 4,
          totalPages: 7,
          effectiveSpreadMode: "spread",
          readingDirection: "ltr",
          spreadPageOffset: 0,
          knownDimensions: dimensions,
        }),
      ).toEqual({ slots: [{ pageIndex: 4, position: "center" }] });

      // 6. 後続ページ (page 5-6) は自動的に再ペアリングされる
      expect(
        computeViewportSlotLayout({
          currentPageIndex: 5,
          totalPages: 7,
          effectiveSpreadMode: "spread",
          readingDirection: "rtl",
          spreadPageOffset: 0,
          knownDimensions: dimensions,
        }),
      ).toEqual({
        slots: [
          { pageIndex: 6, position: "left" },
          { pageIndex: 5, position: "right" },
        ],
      });

      // 7. 末尾頁 (page 6) は次頁が存在しないため単独中央表示
      expect(
        computeViewportSlotLayout({
          currentPageIndex: 6,
          totalPages: 7,
          effectiveSpreadMode: "spread",
          readingDirection: "rtl",
          spreadPageOffset: 0,
          knownDimensions: dimensions,
        }),
      ).toEqual({ slots: [{ pageIndex: 6, position: "center" }] });
    });
  });

  describe("buildSpreadProtectedWindow / Neighbor / Prefetch", () => {
    it("L1保護ウィンドウが単枚時最大4枚・見開き時最大5枚(L1_MAX_PAGES)を昇順端基準で構築すること (AC-RD-12)", () => {
      // totalPages<=0 または visiblePages 空時は空配列
      expect(buildSpreadProtectedWindow([], "spread", 10)).toEqual([]);
      expect(buildSpreadProtectedWindow([0], "single", 0)).toEqual([]);

      // 単ページ時: [N-1, N, N+1, N+2] 最大4枚
      expect(buildSpreadProtectedWindow([0], "single", 10)).toEqual([0, 1, 2]);
      expect(buildSpreadProtectedWindow([3], "single", 10)).toEqual([
        2, 3, 4, 5,
      ]);
      expect(buildSpreadProtectedWindow([9], "single", 10)).toEqual([8, 9]);

      // 見開きモードで単独表示（表紙0 / 横長N）時は [N-1, N, N+1, N+2] 最大4枚
      expect(buildSpreadProtectedWindow([0], "spread", 10)).toEqual([0, 1, 2]);
      expect(buildSpreadProtectedWindow([4], "spread", 10)).toEqual([
        3, 4, 5, 6,
      ]);

      // 見開き2頁時（rtl配列順 [2, 1] でも昇順端 first=1, last=2 基準）: [0, 1, 2, 3, 4] 最大5枚
      expect(buildSpreadProtectedWindow([2, 1], "spread", 10)).toEqual([
        0, 1, 2, 3, 4,
      ]);
      expect(buildSpreadProtectedWindow([8, 9], "spread", 10)).toEqual([
        7, 8, 9,
      ]);
    });

    it("近傍ターゲットおよび20件前方+2件後方の先読みターゲットを構築すること (AC-RD-12)", () => {
      expect(buildSpreadNeighborTargets([], "spread", 10)).toEqual([]);
      expect(buildSpreadNeighborTargets([0], "single", 0)).toEqual([]);
      expect(buildSpreadNeighborTargets([3], "single", 10)).toEqual([4, 5, 2]);
      expect(buildSpreadNeighborTargets([0], "spread", 10)).toEqual([1, 2]);
      expect(buildSpreadNeighborTargets([2, 1], "spread", 10)).toEqual([
        3, 4, 0,
      ]);
      expect(buildSpreadNeighborTargets([8, 9], "spread", 10)).toEqual([7]);

      expect(buildSpreadPrefetchTargets([], 10)).toEqual([]);
      expect(buildSpreadPrefetchTargets([0], 0)).toEqual([]);
      expect(buildSpreadPrefetchTargets([2, 1], 30)).toEqual([
        3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
        0,
      ]);
      expect(buildSpreadPrefetchTargets([3, 4], 7)).toEqual([5, 6, 2, 1]);
    });
  });

  describe("computePreviousAnchorIndex", () => {
    it("単ページ・先頭ガード(<=1)・通常2頁戻り・表紙/横長画像跨ぎの1頁戻りを決定論的に計算すること (AC-RD-10)", () => {
      expect(computePreviousAnchorIndex(0, "spread", 0)).toBe(0);
      expect(computePreviousAnchorIndex(1, "spread", 0)).toBe(0);
      expect(computePreviousAnchorIndex(1, "spread", 1)).toBe(0);
      expect(computePreviousAnchorIndex(3, "single", 0)).toBe(2);

      const dims = new Map<number, PageDimensions>([
        [3, { width: 1600, height: 1000 }], // 横長
      ]);

      // 通常見開き: 3 -> 1, 5 -> 3 (4・3の判定: 3が横長なら4)
      expect(computePreviousAnchorIndex(3, "spread", 0)).toBe(1);
      // offset=0 で index=2 から戻る場合は prev2=0 が表紙単独のため prev1=1 へ
      expect(computePreviousAnchorIndex(2, "spread", 0)).toBe(1);
      // offset=1 で index=2 から戻る場合は 0-1 ペアがあるため 0 へ
      expect(computePreviousAnchorIndex(2, "spread", 1)).toBe(0);
      // prev1 (page 3) が横長なら 4 -> 3
      expect(computePreviousAnchorIndex(4, "spread", 0, dims)).toBe(3);
      // prev2 (page 3) が横長なら 5 -> 4
      expect(computePreviousAnchorIndex(5, "spread", 0, dims)).toBe(4);
    });
  });

  describe("computeShiftedAnchorOnOffsetToggle", () => {
    it("1ページずらし切替時の境界・可逆シフト・1頁目3頁以上特例を厳密計算すること (AC-RD-10)", () => {
      // 0〜1ページ本・表紙0ページ目
      expect(computeShiftedAnchorOnOffsetToggle(0, 1, 0)).toBe(0);
      expect(computeShiftedAnchorOnOffsetToggle(0, 1, 1)).toBe(0);
      expect(computeShiftedAnchorOnOffsetToggle(0, 1, 10)).toBe(0);
      expect(computeShiftedAnchorOnOffsetToggle(0, 0, 10)).toBe(0);

      // nextOffset === 1: 原則 +1、最終頁のみ -1
      expect(computeShiftedAnchorOnOffsetToggle(1, 1, 5)).toBe(2);
      expect(computeShiftedAnchorOnOffsetToggle(3, 1, 5)).toBe(4);
      expect(computeShiftedAnchorOnOffsetToggle(4, 1, 5)).toBe(3);
      expect(computeShiftedAnchorOnOffsetToggle(1, 1, 2)).toBe(0);

      // nextOffset === 0: 原則 -1、currentPageIndex===1 は3頁以上なら2・2頁本なら0
      expect(computeShiftedAnchorOnOffsetToggle(2, 0, 5)).toBe(1);
      expect(computeShiftedAnchorOnOffsetToggle(4, 0, 5)).toBe(3);
      expect(computeShiftedAnchorOnOffsetToggle(1, 0, 5)).toBe(2);
      expect(computeShiftedAnchorOnOffsetToggle(1, 0, 2)).toBe(0);

      // 境界外クランプ安全性
      expect(computeShiftedAnchorOnOffsetToggle(99, 1, 5)).toBe(3);
    });
  });

  describe("formatPageIndicator", () => {
    it("単頁・見開き(rtl/ltr双方昇順)・0頁・未ロードフォールバックの表記を整形すること (AC-RD-04)", () => {
      expect(formatPageIndicator([], 0)).toBe("0 / 0");
      expect(formatPageIndicator([], 24)).toBe("1 / 24");
      expect(formatPageIndicator([], 24, 5)).toBe("6 / 24");
      expect(
        formatPageIndicator([{ pageIndex: 0, position: "center" }], 24),
      ).toBe("1 / 24");
      // rtl スロット順でも昇順 "2-3 / 24"
      expect(
        formatPageIndicator(
          [
            { pageIndex: 2, position: "left" },
            { pageIndex: 1, position: "right" },
          ],
          24,
        ),
      ).toBe("2-3 / 24");
      // ltr スロット順でも昇順 "2-3 / 24"
      expect(
        formatPageIndicator(
          [
            { pageIndex: 1, position: "left" },
            { pageIndex: 2, position: "right" },
          ],
          24,
        ),
      ).toBe("2-3 / 24");
      // 同一ページ番号の重複スロットは単表記
      expect(
        formatPageIndicator(
          [
            { pageIndex: 4, position: "left" },
            { pageIndex: 4, position: "right" },
          ],
          24,
        ),
      ).toBe("5 / 24");
    });
  });

  describe("rtl/ltr 入力判定関数群", () => {
    it("タップ位置比率をrtl/ltrに応じて次頁・前頁・HUD切替へ判定すること (AC-RD-03)", () => {
      // rtl: 左30%次、中央40%HUD、右30%前
      expect(resolveDirectionActionForTapRatio(0, "rtl")).toBe("next");
      expect(resolveDirectionActionForTapRatio(0.29, "rtl")).toBe("next");
      expect(resolveDirectionActionForTapRatio(0.3, "rtl")).toBe("toggle-hud");
      expect(resolveDirectionActionForTapRatio(0.5, "rtl")).toBe("toggle-hud");
      expect(resolveDirectionActionForTapRatio(0.7, "rtl")).toBe("toggle-hud");
      expect(resolveDirectionActionForTapRatio(0.71, "rtl")).toBe("prev");
      expect(resolveDirectionActionForTapRatio(1, "rtl")).toBe("prev");

      // ltr: 左30%前、中央40%HUD、右30%次
      expect(resolveDirectionActionForTapRatio(0.1, "ltr")).toBe("prev");
      expect(resolveDirectionActionForTapRatio(0.5, "ltr")).toBe("toggle-hud");
      expect(resolveDirectionActionForTapRatio(0.9, "ltr")).toBe("next");

      // 非有限比率は安全に HUD 切替
      expect(resolveDirectionActionForTapRatio(Number.NaN, "rtl")).toBe(
        "toggle-hud",
      );
    });

    it("横スワイプをrtl/ltrに応じて判定し閾値未満・縦移動優位・非有限値を無効化すること (AC-RD-03)", () => {
      expect(resolveDirectionActionForSwipe(40, 0, "rtl")).toBe("next");
      expect(resolveDirectionActionForSwipe(-40, 10, "rtl")).toBe("prev");
      expect(resolveDirectionActionForSwipe(-40, 0, "ltr")).toBe("next");
      expect(resolveDirectionActionForSwipe(40, -10, "ltr")).toBe("prev");

      expect(resolveDirectionActionForSwipe(39, 0, "rtl")).toBeNull();
      expect(resolveDirectionActionForSwipe(50, 50, "rtl")).toBeNull();
      expect(resolveDirectionActionForSwipe(50, -60, "ltr")).toBeNull();
      expect(resolveDirectionActionForSwipe(Number.NaN, 0, "rtl")).toBeNull();
      expect(resolveDirectionActionForSwipe(50, Number.NaN, "ltr")).toBeNull();
    });

    it("キーボード入力をrtl/ltrに応じて次頁・前頁・終了・無関係キーへ判定すること (AC-RD-03)", () => {
      expect(resolveDirectionActionForKey("ArrowLeft", "rtl")).toBe("next");
      expect(resolveDirectionActionForKey("ArrowRight", "rtl")).toBe("prev");
      expect(resolveDirectionActionForKey("ArrowLeft", "ltr")).toBe("prev");
      expect(resolveDirectionActionForKey("ArrowRight", "ltr")).toBe("next");
      expect(resolveDirectionActionForKey("Escape", "rtl")).toBe("close");
      expect(resolveDirectionActionForKey("Escape", "ltr")).toBe("close");
      expect(resolveDirectionActionForKey("Enter", "rtl")).toBeNull();
    });
  });
});
