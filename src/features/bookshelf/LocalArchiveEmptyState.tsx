import type { ReactNode } from "react";

export interface LocalArchiveEmptyStateProps {
  readonly isDragActive: boolean;
  readonly errorMessage: string | null;
  readonly onOpenLocalZip: () => void;
}

export function LocalArchiveEmptyState({
  isDragActive,
  errorMessage,
  onOpenLocalZip,
}: LocalArchiveEmptyStateProps): ReactNode {
  const cardSurfaceClass = isDragActive
    ? "border-indigo-400 bg-indigo-950/30"
    : "border-slate-800 bg-slate-900/60";

  return (
    <section
      data-testid="bookshelf-empty"
      data-drag-active={isDragActive ? "true" : "false"}
      className={`max-w-md w-full rounded-2xl border p-8 text-center shadow-lg transition-colors ${cardSurfaceClass}`}
    >
      <p className="text-sm font-semibold text-indigo-300">仮想本棚</p>
      <h2 className="mt-2 text-lg font-bold text-white">
        まだ本棚に作品が登録されていません
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">
        端末内の .zip / .cbz
        ファイルを選択するか、この画面へドラッグ＆ドロップして WebGL2
        リーダーで直接開けます。
      </p>
      <button
        type="button"
        data-testid="open-local-zip-button"
        onClick={onOpenLocalZip}
        className="mt-6 w-full rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-400 transition-colors"
      >
        ローカル ZIP を開く（.zip / .cbz）
      </button>
      {errorMessage !== null && (
        <p
          role="alert"
          data-testid="local-zip-error"
          className="mt-4 rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-xs font-medium text-rose-300"
        >
          {errorMessage}
        </p>
      )}
    </section>
  );
}
