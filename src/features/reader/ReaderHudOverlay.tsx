import type { ReactNode, SyntheticEvent } from "react";
import type {
  EffectiveSpreadMode,
  ReadingDirection,
  SpreadMode,
  SpreadPageOffset,
} from "../../webgl/types";

export interface ReaderHudOverlayProps {
  readonly isOpen: boolean;
  readonly fileName: string;
  readonly currentPageIndex: number;
  readonly totalPages: number;
  readonly onClose: () => void;
  readonly onNextPage: () => void;
  readonly onPrevPage: () => void;
  readonly readingDirection?: ReadingDirection;
  readonly spreadMode?: SpreadMode;
  readonly effectiveSpreadMode?: EffectiveSpreadMode;
  readonly spreadPageOffset?: SpreadPageOffset;
  readonly pageIndicatorText?: string;
  readonly maxDisplayedPageIndex?: number;
  readonly onCycleSpreadMode?: () => void;
  readonly onToggleSpreadPageOffset?: () => void;
  readonly onToggleReadingDirection?: () => void;
}

const DEFAULT_BUTTON_COLOR_CLASS =
  "border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700";

const ACTIVE_OFFSET_BUTTON_COLOR_CLASS =
  "border-indigo-400 bg-indigo-500/30 text-indigo-100 hover:bg-indigo-500/40";

const NAV_BUTTON_CLASS = `shrink-0 whitespace-nowrap touch-manipulation rounded-lg border ${DEFAULT_BUTTON_COLOR_CLASS} px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:px-3.5 sm:text-sm`;

const CONTROL_BUTTON_BASE_CLASS =
  "shrink-0 whitespace-nowrap touch-manipulation rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:px-3 sm:text-sm";

function stopEventPropagation(event: SyntheticEvent<HTMLElement>): void {
  event.stopPropagation();
}

function getSpreadModeLabel(
  spreadMode: SpreadMode,
  effectiveSpreadMode: EffectiveSpreadMode,
): string {
  if (spreadMode === "auto") {
    return effectiveSpreadMode === "spread" ? "自動(見開き)" : "自動(単頁)";
  }
  return spreadMode === "spread" ? "見開き" : "単ページ";
}

export function ReaderHudOverlay({
  isOpen,
  fileName,
  currentPageIndex,
  totalPages,
  onClose,
  onNextPage,
  onPrevPage,
  readingDirection = "rtl",
  spreadMode = "auto",
  effectiveSpreadMode = "single",
  spreadPageOffset = 0,
  pageIndicatorText,
  maxDisplayedPageIndex,
  onCycleSpreadMode,
  onToggleSpreadPageOffset,
  onToggleReadingDirection,
}: ReaderHudOverlayProps): ReactNode {
  if (!isOpen) {
    return null;
  }

  const isPrevDisabled = totalPages === 0 || currentPageIndex <= 0;
  const isNextDisabled =
    totalPages === 0 ||
    (maxDisplayedPageIndex ?? currentPageIndex) >= totalPages - 1;
  const displayPage = totalPages > 0 ? currentPageIndex + 1 : 0;
  const indicatorText = pageIndicatorText ?? `${displayPage} / ${totalPages}`;
  const isOffsetToggleDisabled =
    totalPages <= 1 || effectiveSpreadMode === "single";
  const isOffsetActive = spreadPageOffset === 1;
  const spreadModeLabel = getSpreadModeLabel(spreadMode, effectiveSpreadMode);
  const isRtl = readingDirection === "rtl";
  const directionLabel = isRtl ? "右開き" : "左開き";

  const nextButton = (
    <button
      key="next"
      type="button"
      data-testid="reader-next-button"
      disabled={isNextDisabled}
      onClick={onNextPage}
      className={NAV_BUTTON_CLASS}
    >
      {isRtl ? "← 次へ" : "次へ →"}
    </button>
  );

  const prevButton = (
    <button
      key="prev"
      type="button"
      data-testid="reader-prev-button"
      disabled={isPrevDisabled}
      onClick={onPrevPage}
      className={NAV_BUTTON_CLASS}
    >
      {isRtl ? "前へ →" : "← 前へ"}
    </button>
  );

  const pageIndicator = (
    <span
      key="indicator"
      data-testid="reader-page-indicator"
      className="whitespace-nowrap font-mono text-xs font-medium tabular-nums text-slate-200 sm:text-sm"
    >
      {indicatorText}
    </span>
  );

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
          className={`shrink-0 whitespace-nowrap touch-manipulation rounded-lg border ${DEFAULT_BUTTON_COLOR_CLASS} px-3 py-1.5 text-sm font-medium transition-colors`}
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
        className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 border-t border-slate-800/80 bg-slate-950/90 px-3 py-2.5 text-slate-100 backdrop-blur-sm sm:px-4 sm:py-3"
      >
        <div
          data-testid="reader-hud-nav-row"
          className="flex w-full items-center justify-between gap-2 sm:gap-3"
        >
          {isRtl ? nextButton : prevButton}
          {pageIndicator}
          {isRtl ? prevButton : nextButton}
        </div>

        <div
          data-testid="reader-hud-controls-row"
          className="flex w-full items-center justify-center gap-1.5 sm:gap-3"
        >
          <button
            type="button"
            data-testid="reader-spread-mode-button"
            data-spread-mode={spreadMode}
            data-effective-spread-mode={effectiveSpreadMode}
            onClick={onCycleSpreadMode}
            className={`${CONTROL_BUTTON_BASE_CLASS} ${DEFAULT_BUTTON_COLOR_CLASS}`}
          >
            {spreadModeLabel}
          </button>
          <button
            type="button"
            data-testid="reader-offset-toggle-button"
            aria-pressed={isOffsetActive}
            disabled={isOffsetToggleDisabled}
            onClick={onToggleSpreadPageOffset}
            className={`${CONTROL_BUTTON_BASE_CLASS} ${
              isOffsetActive
                ? ACTIVE_OFFSET_BUTTON_COLOR_CLASS
                : DEFAULT_BUTTON_COLOR_CLASS
            }`}
          >
            1ページずらし
          </button>
          <button
            type="button"
            data-testid="reader-direction-button"
            data-reading-direction={readingDirection}
            onClick={onToggleReadingDirection}
            className={`${CONTROL_BUTTON_BASE_CLASS} ${DEFAULT_BUTTON_COLOR_CLASS}`}
          >
            {directionLabel}
          </button>
        </div>
      </footer>
    </>
  );
}
