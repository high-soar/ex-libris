import type { ReactNode } from "react";
import { APP_VERSION } from "../../shared/constants/app";

export interface SeriesDetailHeaderProps {
  readonly title?: string | null;
  readonly onBack: () => void;
}

export function SeriesDetailHeader({
  title,
  onBack,
}: SeriesDetailHeaderProps): ReactNode {
  const trimmedTitle = title?.trim() ?? "";
  const displayTitle = trimmedTitle.length > 0 ? trimmedTitle : "シリーズ詳細";

  return (
    <header
      style={{ paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))" }}
      className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/90 px-4 py-4 sm:px-6"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          data-testid="series-detail-back-button"
          onClick={onBack}
          className="shrink-0 touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 sm:text-sm"
        >
          本棚へ戻る
        </button>
        <h1
          data-testid="series-detail-header-title"
          className="min-w-0 truncate text-base font-bold tracking-tight text-white sm:text-lg"
        >
          {displayTitle}
        </h1>
      </div>
      <span
        data-testid="series-detail-app-version"
        className="shrink-0 rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-medium text-indigo-300"
      >
        v{APP_VERSION}
      </span>
    </header>
  );
}
