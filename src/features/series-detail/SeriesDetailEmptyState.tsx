import type { ReactNode } from "react";

export interface SeriesDetailEmptyStateProps {
  readonly onBack: () => void;
}

export function SeriesDetailEmptyState({
  onBack,
}: SeriesDetailEmptyStateProps): ReactNode {
  return (
    <section
      data-testid="series-detail-empty"
      className="mx-auto max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center shadow-md sm:p-8"
    >
      <h2 className="text-base font-bold text-white sm:text-lg">
        シリーズを表示できません
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">
        指定されたシリーズが見つからないか、有効な同期フォルダ内に表示できる巻がありません。
      </p>
      <button
        type="button"
        data-testid="series-detail-empty-back-button"
        onClick={onBack}
        className="mt-6 touch-manipulation rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400"
      >
        本棚へ戻る
      </button>
    </section>
  );
}
