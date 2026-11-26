import type { ReactNode } from "react";
import type { SlotPosition } from "../../webgl/types";

export interface ReaderErrorViewProps {
  readonly mode: "archive" | "page";
  readonly message: string;
  readonly errorCode?: string;
  readonly backLabel?: string;
  readonly onBackToHome?: () => void;
  readonly slotPosition?: SlotPosition;
  readonly pageNumber?: number;
}

const PAGE_ERROR_WRAPPER_POSITION_CLASS: Record<SlotPosition, string> = {
  center: "inset-0 p-6",
  left: "inset-y-0 left-0 w-1/2 p-4",
  right: "inset-y-0 right-0 w-1/2 p-4",
};

function ErrorCodeCaption({
  errorCode,
  marginClass,
}: {
  readonly errorCode?: string;
  readonly marginClass: string;
}): ReactNode {
  if (errorCode === undefined) {
    return null;
  }

  return (
    <p
      data-testid="reader-error-code"
      className={`${marginClass} font-mono text-xs break-words text-slate-400`}
    >
      エラーコード: {errorCode}
    </p>
  );
}

export function ReaderErrorView({
  mode,
  message,
  errorCode,
  backLabel = "ホームへ戻る",
  onBackToHome,
  slotPosition = "center",
  pageNumber,
}: ReaderErrorViewProps): ReactNode {
  if (mode === "archive") {
    return (
      <div
        role="alert"
        data-testid="reader-error-view"
        className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/95 p-6 text-slate-100"
      >
        <div className="max-w-md w-full rounded-2xl border border-rose-500/40 bg-slate-900/90 p-8 text-center shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-rose-300">
            リーダーエラー
          </p>
          <h2 className="mt-2 text-lg font-bold text-white">
            アーカイブを開けませんでした
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-200">
            {message}
          </p>
          <ErrorCodeCaption errorCode={errorCode} marginClass="mt-3" />
          <button
            type="button"
            data-testid="reader-error-back-button"
            onClick={onBackToHome}
            className="mt-6 w-full touch-manipulation rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 transition-colors"
          >
            {backLabel}
          </button>
        </div>
      </div>
    );
  }

  const wrapperPositionClass = PAGE_ERROR_WRAPPER_POSITION_CLASS[slotPosition];
  const cardPaddingClass = slotPosition === "center" ? "p-6" : "p-4 sm:p-6";
  const pageErrorTitle =
    pageNumber !== undefined
      ? `ページ読込エラー (p.${pageNumber})`
      : "ページ読込エラー";

  return (
    <div
      className={`pointer-events-none absolute z-10 flex items-center justify-center ${wrapperPositionClass}`}
    >
      <div
        role="alert"
        data-testid="reader-page-error"
        data-slot-position={slotPosition}
        className={`max-w-sm w-full rounded-2xl border border-amber-500/40 bg-slate-900/90 ${cardPaddingClass} text-center text-slate-100 shadow-xl`}
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
          {pageErrorTitle}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-200">{message}</p>
        <ErrorCodeCaption errorCode={errorCode} marginClass="mt-2" />
        <p className="mt-4 text-xs text-slate-400">
          左右のタップ・スワイプまたは矢印キーで前後のページへ移動できます
        </p>
      </div>
    </div>
  );
}
