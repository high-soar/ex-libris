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

export interface ShaderCorrectionParams {
  /** 画面空間偏微分 5タップ軽量アンシャープマスク強度（0.00 = 無補正 〜 1.00 = 強） */
  readonly sharpness: number;
  /** 紙地肌の白飛ばし上限（0.80 〜 1.00、初期値 1.00、黄ばみ除去用） */
  readonly whitePoint: number;
  /** インク引き締め・裏写りカット下限（0.00 〜 0.25、初期値 0.00） */
  readonly blackPoint: number;
  /** 標準ガンマ補正 pow(rgb, 1.0 / gamma)（0.60 〜 1.60、初期値 1.00 = 線形、1.00 未満で薄墨濃化） */
  readonly gamma: number;
}
