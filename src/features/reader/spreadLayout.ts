import type {
  EffectiveSpreadMode,
  PageDimensions,
  ReadingDirection,
  SpreadMode,
  SpreadPageOffset,
  ViewportSlot,
  ViewportSlotLayout,
} from "../../webgl/types";

export type DirectionNavigationAction = "next" | "prev";
export type TapDirectionAction = DirectionNavigationAction | "toggle-hud";
export type KeyDirectionAction = DirectionNavigationAction | "close";

export interface CandidateFetchPagesParams {
  readonly currentPageIndex: number;
  readonly totalPages: number;
  readonly effectiveSpreadMode: EffectiveSpreadMode;
  readonly spreadPageOffset: SpreadPageOffset;
  readonly knownDimensions?: ReadonlyMap<number, PageDimensions>;
}

export interface ViewportSlotLayoutParams extends CandidateFetchPagesParams {
  readonly readingDirection: ReadingDirection;
}

const TAP_LEFT_BOUNDARY = 0.3;
const TAP_RIGHT_BOUNDARY = 0.7;
const SWIPE_THRESHOLD_PX = 40;
const PREFETCH_FORWARD_PAGES = 20;
const PREFETCH_BACKWARD_PAGES = 2;

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clampPageIndex(pageIndex: number, totalPages: number): number {
  if (!Number.isFinite(pageIndex)) {
    return 0;
  }
  return Math.min(totalPages - 1, Math.max(0, Math.floor(pageIndex)));
}

function shouldUseSingleSlot(
  basePageIndex: number,
  totalPages: number,
  effectiveSpreadMode: EffectiveSpreadMode,
  spreadPageOffset: SpreadPageOffset,
  knownDimensions?: ReadonlyMap<number, PageDimensions>,
): boolean {
  if (effectiveSpreadMode === "single") {
    return true;
  }
  if (basePageIndex === 0 && spreadPageOffset === 0) {
    return true;
  }
  if (basePageIndex + 1 >= totalPages) {
    return true;
  }
  return (
    isLandscapeDimensions(knownDimensions?.get(basePageIndex)) ||
    isLandscapeDimensions(knownDimensions?.get(basePageIndex + 1))
  );
}

export function resolveEffectiveSpreadMode(
  spreadMode: SpreadMode,
  viewportWidth: number,
  viewportHeight: number,
): EffectiveSpreadMode {
  if (spreadMode !== "auto") {
    return spreadMode;
  }
  if (
    isPositiveFinite(viewportWidth) &&
    isPositiveFinite(viewportHeight) &&
    viewportWidth > viewportHeight
  ) {
    return "spread";
  }
  return "single";
}

export function isLandscapeDimensions(
  dims: PageDimensions | null | undefined,
): boolean {
  if (dims === null || dims === undefined) {
    return false;
  }
  if (!isPositiveFinite(dims.width) || !isPositiveFinite(dims.height)) {
    return false;
  }
  return dims.width > dims.height;
}

export function getCandidateFetchPages(
  params: CandidateFetchPagesParams,
): number[] {
  const {
    currentPageIndex,
    totalPages,
    effectiveSpreadMode,
    spreadPageOffset,
    knownDimensions,
  } = params;

  if (totalPages <= 0) {
    return [];
  }

  const base = clampPageIndex(currentPageIndex, totalPages);
  if (
    shouldUseSingleSlot(
      base,
      totalPages,
      effectiveSpreadMode,
      spreadPageOffset,
      knownDimensions,
    )
  ) {
    return [base];
  }
  return [base, base + 1];
}

export function computeViewportSlotLayout(
  params: ViewportSlotLayoutParams,
): ViewportSlotLayout {
  const {
    currentPageIndex,
    totalPages,
    effectiveSpreadMode,
    readingDirection,
    spreadPageOffset,
    knownDimensions,
  } = params;

  if (totalPages <= 0) {
    return { slots: [] };
  }

  const base = clampPageIndex(currentPageIndex, totalPages);
  if (
    shouldUseSingleSlot(
      base,
      totalPages,
      effectiveSpreadMode,
      spreadPageOffset,
      knownDimensions,
    )
  ) {
    return {
      slots: [{ pageIndex: base, position: "center" }],
    };
  }

  if (readingDirection === "rtl") {
    return {
      slots: [
        { pageIndex: base + 1, position: "left" },
        { pageIndex: base, position: "right" },
      ],
    };
  }

  return {
    slots: [
      { pageIndex: base, position: "left" },
      { pageIndex: base + 1, position: "right" },
    ],
  };
}

export function buildSpreadProtectedWindow(
  visiblePages: readonly number[],
  effectiveSpreadMode: EffectiveSpreadMode,
  totalPages: number,
): number[] {
  if (totalPages <= 0 || visiblePages.length === 0) {
    return [];
  }

  const first = Math.min(...visiblePages);
  const last = Math.max(...visiblePages);

  const rawCandidates =
    effectiveSpreadMode === "single"
      ? [first - 1, first, first + 1, first + 2]
      : last > first
        ? [first - 1, first, last, last + 1, last + 2]
        : [first - 1, first, first + 1, first + 2];

  return rawCandidates.filter(
    (candidate) => candidate >= 0 && candidate < totalPages,
  );
}

export function buildSpreadNeighborTargets(
  visiblePages: readonly number[],
  effectiveSpreadMode: EffectiveSpreadMode,
  totalPages: number,
): number[] {
  if (totalPages <= 0 || visiblePages.length === 0) {
    return [];
  }

  const first = Math.min(...visiblePages);
  const last = Math.max(...visiblePages);

  const rawCandidates =
    effectiveSpreadMode === "single"
      ? [first + 1, first + 2, first - 1]
      : [last + 1, last + 2, first - 1];

  return rawCandidates.filter(
    (candidate) => candidate >= 0 && candidate < totalPages,
  );
}

export function buildSpreadPrefetchTargets(
  visiblePages: readonly number[],
  totalPages: number,
): number[] {
  if (totalPages <= 0 || visiblePages.length === 0) {
    return [];
  }

  const first = Math.min(...visiblePages);
  const last = Math.max(...visiblePages);
  const targets: number[] = [];

  for (let offset = 1; offset <= PREFETCH_FORWARD_PAGES; offset += 1) {
    const candidate = last + offset;
    if (candidate < totalPages) {
      targets.push(candidate);
    }
  }

  for (let offset = 1; offset <= PREFETCH_BACKWARD_PAGES; offset += 1) {
    const candidate = first - offset;
    if (candidate >= 0) {
      targets.push(candidate);
    }
  }

  return targets;
}

export function computePreviousAnchorIndex(
  currentPageIndex: number,
  effectiveSpreadMode: EffectiveSpreadMode,
  spreadPageOffset: SpreadPageOffset,
  knownDimensions?: ReadonlyMap<number, PageDimensions>,
): number {
  if (currentPageIndex <= 1) {
    return 0;
  }
  if (effectiveSpreadMode === "single") {
    return currentPageIndex - 1;
  }

  const prev1 = currentPageIndex - 1;
  const prev2 = currentPageIndex - 2;
  if (
    (prev2 === 0 && spreadPageOffset === 0) ||
    isLandscapeDimensions(knownDimensions?.get(prev1)) ||
    isLandscapeDimensions(knownDimensions?.get(prev2))
  ) {
    return prev1;
  }
  return prev2;
}

export function computeShiftedAnchorOnOffsetToggle(
  currentPageIndex: number,
  nextOffset: SpreadPageOffset,
  totalPages: number,
): number {
  if (totalPages <= 1 || currentPageIndex <= 0) {
    return 0;
  }

  const clamped = Math.min(totalPages - 1, currentPageIndex);
  if (nextOffset === 1) {
    return clamped + 1 < totalPages ? clamped + 1 : clamped - 1;
  }
  if (clamped - 1 >= 1) {
    return clamped - 1;
  }
  return clamped + 1 < totalPages ? clamped + 1 : 0;
}

export function formatPageIndicator(
  slots: readonly ViewportSlot[],
  totalPages: number,
  fallbackPageIndex?: number,
): string {
  if (totalPages <= 0) {
    return "0 / 0";
  }

  if (slots.length === 0) {
    const fallback = clampPageIndex(fallbackPageIndex ?? 0, totalPages);
    return `${fallback + 1} / ${totalPages}`;
  }

  if (slots.length === 1) {
    return `${slots[0].pageIndex + 1} / ${totalPages}`;
  }

  const pageIndices = slots.map((slot) => slot.pageIndex);
  const minPage = Math.min(...pageIndices);
  const maxPage = Math.max(...pageIndices);
  if (minPage === maxPage) {
    return `${minPage + 1} / ${totalPages}`;
  }
  return `${minPage + 1}-${maxPage + 1} / ${totalPages}`;
}

export function resolveDirectionActionForTapRatio(
  ratio: number,
  readingDirection: ReadingDirection,
): TapDirectionAction {
  if (!Number.isFinite(ratio)) {
    return "toggle-hud";
  }
  if (ratio < TAP_LEFT_BOUNDARY) {
    return readingDirection === "rtl" ? "next" : "prev";
  }
  if (ratio > TAP_RIGHT_BOUNDARY) {
    return readingDirection === "rtl" ? "prev" : "next";
  }
  return "toggle-hud";
}

export function resolveDirectionActionForSwipe(
  dx: number,
  dy: number,
  readingDirection: ReadingDirection,
): DirectionNavigationAction | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return null;
  }
  if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) {
    return null;
  }
  if (dx > 0) {
    return readingDirection === "rtl" ? "next" : "prev";
  }
  return readingDirection === "rtl" ? "prev" : "next";
}

export function resolveDirectionActionForKey(
  key: string,
  readingDirection: ReadingDirection,
): KeyDirectionAction | null {
  if (key === "Escape") {
    return "close";
  }
  if (key === "ArrowLeft") {
    return readingDirection === "rtl" ? "next" : "prev";
  }
  if (key === "ArrowRight") {
    return readingDirection === "rtl" ? "prev" : "next";
  }
  return null;
}
