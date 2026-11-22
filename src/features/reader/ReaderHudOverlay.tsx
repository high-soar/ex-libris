import {
  type ChangeEvent,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  readonly shaderModified?: boolean;
  readonly onOpenShaderSheet?: () => void;
  readonly onCommitSeek?: (targetPageIndex: number) => void;
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
  shaderModified = false,
  onOpenShaderSheet,
  onCommitSeek,
}: ReaderHudOverlayProps): ReactNode {
  const maxSeekIndex = Math.max(0, totalPages - 1);
  const clampedCurrentPageIndex = Math.min(
    maxSeekIndex,
    Math.max(0, currentPageIndex),
  );

  const [seekPreviewIndex, setSeekPreviewIndex] = useState<number | null>(null);
  const seekPreviewRef = useRef<number | null>(null);
  const currentPageIndexRef = useRef(clampedCurrentPageIndex);
  currentPageIndexRef.current = clampedCurrentPageIndex;
  const onCommitSeekRef = useRef(onCommitSeek);
  onCommitSeekRef.current = onCommitSeek;

  const seekDragController = useMemo(() => {
    const detach = () => {
      window.removeEventListener("pointerup", onPointerEnd, true);
      window.removeEventListener("pointercancel", onPointerEnd, true);
    };

    function onPointerEnd(event: { readonly type: string }) {
      const targetIndex = seekPreviewRef.current;
      if (targetIndex === null) {
        return;
      }
      seekPreviewRef.current = null;
      detach();
      setSeekPreviewIndex(null);
      if (
        event.type === "pointerup" &&
        targetIndex !== currentPageIndexRef.current
      ) {
        onCommitSeekRef.current?.(targetIndex);
      }
    }

    const attach = () => {
      window.addEventListener("pointerup", onPointerEnd, true);
      window.addEventListener("pointercancel", onPointerEnd, true);
    };

    return { attach, detach, onPointerEnd };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      seekPreviewRef.current = null;
      seekDragController.detach();
      setSeekPreviewIndex(null);
    }
  }, [isOpen, seekDragController]);

  useEffect(() => {
    return () => {
      seekPreviewRef.current = null;
      seekDragController.detach();
    };
  }, [seekDragController]);

  if (!isOpen) {
    return null;
  }

  const handleSeekPointerDown = () => {
    if (totalPages <= 1) {
      return;
    }
    seekPreviewRef.current = clampedCurrentPageIndex;
    setSeekPreviewIndex(clampedCurrentPageIndex);
    seekDragController.attach();
  };

  const handleSeekChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextIndex = Number(event.currentTarget.value);
    if (seekPreviewRef.current !== null) {
      seekPreviewRef.current = nextIndex;
      setSeekPreviewIndex(nextIndex);
      return;
    }
    if (nextIndex !== clampedCurrentPageIndex) {
      onCommitSeek?.(nextIndex);
    }
  };

  const isPrevDisabled = totalPages === 0 || currentPageIndex <= 0;
  const isNextDisabled =
    totalPages === 0 ||
    (maxDisplayedPageIndex ?? currentPageIndex) >= totalPages - 1;
  const displayPage = totalPages > 0 ? currentPageIndex + 1 : 0;
  const isSeekPreview = seekPreviewIndex !== null;
  const indicatorText = isSeekPreview
    ? `${seekPreviewIndex + 1} / ${totalPages}`
    : (pageIndicatorText ?? `${displayPage} / ${totalPages}`);
  const activeSeekIndex = seekPreviewIndex ?? clampedCurrentPageIndex;
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
      data-seek-preview={String(isSeekPreview)}
      className={`whitespace-nowrap font-mono text-xs font-medium tabular-nums sm:text-sm ${
        isSeekPreview ? "text-indigo-300" : "text-slate-200"
      }`}
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
        <button
          type="button"
          data-testid="reader-shader-button"
          data-shader-modified={String(shaderModified)}
          onClick={onOpenShaderSheet}
          className={`${CONTROL_BUTTON_BASE_CLASS} ${
            shaderModified
              ? ACTIVE_OFFSET_BUTTON_COLOR_CLASS
              : DEFAULT_BUTTON_COLOR_CLASS
          }`}
        >
          画質補正
        </button>
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
          data-testid="reader-hud-seek-row"
          className="flex w-full items-center"
        >
          <input
            type="range"
            data-testid="reader-seekbar"
            aria-label="ページシークバー"
            min={0}
            max={maxSeekIndex}
            step={1}
            value={activeSeekIndex}
            dir={readingDirection}
            data-reading-direction={readingDirection}
            disabled={totalPages <= 1}
            onPointerDown={handleSeekPointerDown}
            onPointerUp={seekDragController.onPointerEnd}
            onPointerCancel={seekDragController.onPointerEnd}
            onChange={handleSeekChange}
            className="w-full cursor-pointer accent-indigo-400 touch-manipulation disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>

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
