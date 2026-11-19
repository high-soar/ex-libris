import type { ReactNode } from "react";

export interface ReaderErrorViewProps {
  readonly mode: "archive" | "page";
  readonly message: string;
  readonly errorCode?: string;
  readonly onBackToHome?: () => void;
}

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
      className={`${marginClass} font-mono text-xs text-slate-400`}
    >
      エラーコード: {errorCode}
    </p>
  );
}

export function ReaderErrorView({
  mode,
  message,
  errorCode,
  onBackToHome,
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
            className="mt-6 w-full rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 transition-colors"
          >
            ホームへ戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div
        role="alert"
        data-testid="reader-page-error"
        className="max-w-sm w-full rounded-2xl border border-amber-500/40 bg-slate-900/90 p-6 text-center text-slate-100 shadow-xl"
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
          ページ読込エラー
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
