import type { MouseEvent, ReactNode, SyntheticEvent } from "react";
import {
  SHADER_PARAM_RANGES,
  normalizeShaderCorrectionParams,
} from "../../webgl/shaderParams";
import type { ShaderCorrectionParams } from "../../webgl/types";

export type ShaderSaveStatus = "idle" | "saved" | "error";

export interface ReaderShaderSheetProps {
  readonly isOpen: boolean;
  readonly shaderParams: ShaderCorrectionParams;
  readonly saveStatus?: ShaderSaveStatus;
  readonly onChangeShaderParams: (next: ShaderCorrectionParams) => void;
  readonly onReset: () => void;
  readonly onSaveDefault: () => void;
  readonly onClose: () => void;
}

interface SliderConfig {
  readonly key: keyof ShaderCorrectionParams;
  readonly testId: string;
  readonly label: string;
}

const SLIDER_CONFIGS: readonly SliderConfig[] = [
  {
    key: "sharpness",
    testId: "shader-sharpness-slider",
    label: "シャープネス",
  },
  {
    key: "whitePoint",
    testId: "shader-white-point-slider",
    label: "白レベル（黄ばみ除去）",
  },
  {
    key: "blackPoint",
    testId: "shader-black-point-slider",
    label: "黒レベル（裏写り除去）",
  },
  {
    key: "gamma",
    testId: "shader-gamma-slider",
    label: "ガンマ補正",
  },
];

function stopEventPropagation(event: SyntheticEvent<HTMLElement>): void {
  event.stopPropagation();
}

export function ReaderShaderSheet({
  isOpen,
  shaderParams,
  saveStatus = "idle",
  onChangeShaderParams,
  onReset,
  onSaveDefault,
  onClose,
}: ReaderShaderSheetProps): ReactNode {
  if (!isOpen) {
    return null;
  }

  const normalizedParams = normalizeShaderCorrectionParams(shaderParams);

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    onClose();
  };

  return (
    <>
      <div
        data-testid="reader-shader-backdrop"
        aria-hidden="true"
        onClick={handleBackdropClick}
        onPointerDown={stopEventPropagation}
        onPointerUp={stopEventPropagation}
        onPointerCancel={stopEventPropagation}
        className="absolute inset-0 z-30 bg-transparent"
      />
      <section
        data-testid="reader-shader-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="画質補正"
        onClick={stopEventPropagation}
        onPointerDown={stopEventPropagation}
        onPointerUp={stopEventPropagation}
        onPointerCancel={stopEventPropagation}
        style={{
          paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
        }}
        className="absolute inset-x-0 bottom-0 z-40 mx-auto w-full max-w-xl rounded-t-2xl border border-b-0 border-slate-700/80 bg-slate-950/95 px-4 pt-4 text-slate-100 shadow-2xl backdrop-blur-md sm:px-6"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-white sm:text-base">
            画質補正
          </h2>
          <button
            type="button"
            data-testid="shader-sheet-close-button"
            onClick={onClose}
            className="touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 sm:text-sm"
          >
            閉じる
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-6">
          {SLIDER_CONFIGS.map((config) => {
            const range = SHADER_PARAM_RANGES[config.key];
            const currentValue = normalizedParams[config.key];

            return (
              <div key={config.key} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <label
                    htmlFor={config.testId}
                    className="font-medium text-slate-200"
                  >
                    {config.label}
                  </label>
                  <span
                    data-testid={`${config.testId}-value`}
                    className="font-mono tabular-nums text-indigo-300"
                  >
                    {currentValue.toFixed(2)}
                  </span>
                </div>
                <input
                  id={config.testId}
                  type="range"
                  data-testid={config.testId}
                  dir="ltr"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={currentValue}
                  onChange={(event) => {
                    onChangeShaderParams(
                      normalizeShaderCorrectionParams({
                        ...shaderParams,
                        [config.key]: Number(event.currentTarget.value),
                      }),
                    );
                  }}
                  className="w-full cursor-pointer accent-indigo-400 touch-manipulation"
                />
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3">
          <div className="min-h-4 flex-1">
            {saveStatus === "saved" && (
              <p
                data-testid="shader-save-status"
                role="status"
                className="text-xs font-medium text-emerald-400"
              >
                デフォルト設定を保存しました
              </p>
            )}
            {saveStatus === "error" && (
              <p
                data-testid="shader-save-status"
                role="alert"
                className="text-xs font-medium text-rose-400"
              >
                デフォルト設定の保存に失敗しました
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="shader-reset-button"
              onClick={onReset}
              className="touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 sm:text-sm"
            >
              リセット
            </button>
            <button
              type="button"
              data-testid="shader-save-default-button"
              onClick={onSaveDefault}
              className="touch-manipulation rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-400 sm:text-sm"
            >
              デフォルト保存
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
