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

export function resolveEffectiveSpreadMode(
  _spreadMode: SpreadMode,
  _viewportWidth: number,
  _viewportHeight: number,
): EffectiveSpreadMode {
  throw new Error("Not implemented");
}

export function isLandscapeDimensions(
  _dims: PageDimensions | null | undefined,
): boolean {
  throw new Error("Not implemented");
}

export function getCandidateFetchPages(
  _params: CandidateFetchPagesParams,
): number[] {
  throw new Error("Not implemented");
}

export function computeViewportSlotLayout(
  _params: ViewportSlotLayoutParams,
): ViewportSlotLayout {
  throw new Error("Not implemented");
}

export function buildSpreadProtectedWindow(
  _visiblePages: readonly number[],
  _effectiveSpreadMode: EffectiveSpreadMode,
  _totalPages: number,
): number[] {
  throw new Error("Not implemented");
}

export function buildSpreadNeighborTargets(
  _visiblePages: readonly number[],
  _effectiveSpreadMode: EffectiveSpreadMode,
  _totalPages: number,
): number[] {
  throw new Error("Not implemented");
}

export function buildSpreadPrefetchTargets(
  _visiblePages: readonly number[],
  _totalPages: number,
): number[] {
  throw new Error("Not implemented");
}

export function computePreviousAnchorIndex(
  _currentPageIndex: number,
  _effectiveSpreadMode: EffectiveSpreadMode,
  _spreadPageOffset: SpreadPageOffset,
  _knownDimensions?: ReadonlyMap<number, PageDimensions>,
): number {
  throw new Error("Not implemented");
}

export function computeShiftedAnchorOnOffsetToggle(
  _currentPageIndex: number,
  _nextOffset: SpreadPageOffset,
  _totalPages: number,
): number {
  throw new Error("Not implemented");
}

export function formatPageIndicator(
  _slots: readonly ViewportSlot[],
  _totalPages: number,
  _fallbackPageIndex?: number,
): string {
  throw new Error("Not implemented");
}

export function resolveDirectionActionForTapRatio(
  _ratio: number,
  _readingDirection: ReadingDirection,
): TapDirectionAction {
  throw new Error("Not implemented");
}

export function resolveDirectionActionForSwipe(
  _dx: number,
  _dy: number,
  _readingDirection: ReadingDirection,
): DirectionNavigationAction | null {
  throw new Error("Not implemented");
}

export function resolveDirectionActionForKey(
  _key: string,
  _readingDirection: ReadingDirection,
): KeyDirectionAction | null {
  throw new Error("Not implemented");
}
