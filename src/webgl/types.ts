import type { DecodedPageFrame } from "../engine/types";

export type ReadingDirection = "rtl" | "ltr";
export type SpreadMode = "auto" | "single" | "spread";
export type EffectiveSpreadMode = "single" | "spread";
export type SpreadPageOffset = 0 | 1;
export type SlotPosition = "center" | "left" | "right";

export interface ViewportSlot {
  readonly pageIndex: number;
  readonly position: SlotPosition;
}

export interface ViewportSlotLayout {
  readonly slots: readonly ViewportSlot[];
}

export interface RenderSlotFrame {
  readonly slot: ViewportSlot;
  readonly frame: DecodedPageFrame | null;
}

export interface PageDimensions {
  readonly width: number;
  readonly height: number;
}
