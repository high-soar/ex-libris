import type { ReactNode, SyntheticEvent } from "react";

export interface ReaderHudOverlayProps {
  readonly isOpen: boolean;
  readonly fileName: string;
  readonly currentPageIndex: number;
  readonly totalPages: number;
  readonly onClose: () => void;
  readonly onNextPage: () => void;
  readonly onPrevPage: () => void;
}

function stopEventPropagation(event: SyntheticEvent<HTMLElement>): void {
  event.stopPropagation();
}

export function ReaderHudOverlay({
  isOpen,
  fileName,
  currentPageIndex,
  totalPages,
  onClose,
  onNextPage,
  onPrevPage,
}: ReaderHudOverlayProps): ReactNode {
  if (!isOpen) {
    return null;
  }

  const isNextDisabled = totalPages === 0 || currentPageIndex >= totalPages - 1;
  const isPrevDisabled = totalPages === 0 || currentPageIndex <= 0;
  const displayPage = totalPages > 0 ? currentPageIndex + 1 : 0;

  return (
    <>
      <header
        data-testid="reader-hud-top"
        onClick={stopEventPropagation}
        onPointerDown={stopEventPropagation}
        onPointerUp={stopEventPropagation}
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
        className="absolute inset-x-0 top-0 z-20 flex items-center gap-3 border-b border-slate-800/80 bg-slate-950/90 px-4 py-3 text-slate-100 backdrop-blur-sm"
      >
        <button
          type="button"
          data-testid="reader-back-button"
          onClick={onClose}
          className="shrink-0 touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700 transition-colors"
        >
          戻る
        </button>
        <p
          data-testid="reader-file-name"
          title={fileName}
          className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200"
        >
          {fileName}
        </p>
      </header>

      <footer
        data-testid="reader-hud-bottom"
        onClick={stopEventPropagation}
        onPointerDown={stopEventPropagation}
        onPointerUp={stopEventPropagation}
        style={{
          paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
        }}
        className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-slate-800/80 bg-slate-950/90 px-4 py-3 text-slate-100 backdrop-blur-sm"
      >
        <button
          type="button"
          data-testid="reader-next-button"
          disabled={isNextDisabled}
          onClick={onNextPage}
          className="touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← 次へ
        </button>
        <span
          data-testid="reader-page-indicator"
          className="text-sm font-mono font-medium text-slate-200"
        >
          {displayPage} / {totalPages}
        </span>
        <button
          type="button"
          data-testid="reader-prev-button"
          disabled={isPrevDisabled}
          onClick={onPrevPage}
          className="touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          前へ →
        </button>
      </footer>
    </>
  );
}
