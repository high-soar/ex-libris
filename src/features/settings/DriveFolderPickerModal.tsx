import { type ReactNode, useRef } from "react";
import type { DriveFolderMetadata } from "../../providers/gdrive/types";
import { useModalFocusTrap } from "../../shared/ui/useModalFocusTrap";
import type { DriveFolderBreadcrumbItem } from "./types";

export interface DriveFolderPickerModalProps {
  readonly isOpen: boolean;
  readonly breadcrumbs: readonly DriveFolderBreadcrumbItem[];
  readonly folders: readonly DriveFolderMetadata[];
  readonly nextPageToken: string | null;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly isSaving: boolean;
  readonly errorMessage: string | null;
  readonly onNavigateBreadcrumb: (index: number) => void;
  readonly onOpenFolder: (folder: DriveFolderMetadata) => void;
  readonly onSelectFolder: (folder: DriveFolderMetadata) => void;
  readonly onConfirmCurrentFolder: () => void;
  readonly onLoadMore: () => void;
  readonly onClose: () => void;
}

const ROOT_BREADCRUMB: DriveFolderBreadcrumbItem = {
  id: "root",
  name: "マイドライブ",
};

function FolderPickerBreadcrumbs({
  breadcrumbs,
  isSaving,
  onNavigateBreadcrumb,
}: {
  readonly breadcrumbs: readonly DriveFolderBreadcrumbItem[];
  readonly isSaving: boolean;
  readonly onNavigateBreadcrumb: (index: number) => void;
}): ReactNode {
  return (
    <nav
      aria-label="フォルダ階層パンくず"
      data-testid="folder-picker-breadcrumbs"
      className="mt-3 flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300"
    >
      {breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1;
        return (
          <span key={crumb.id} className="inline-flex items-center gap-1">
            {index > 0 && (
              <span aria-hidden="true" className="text-slate-600">
                /
              </span>
            )}
            {isLast ? (
              <span aria-current="page" className="font-semibold text-white">
                {crumb.name}
              </span>
            ) : (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => onNavigateBreadcrumb(index)}
                className="touch-manipulation rounded px-1.5 py-0.5 text-indigo-300 transition-colors hover:bg-slate-800 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {crumb.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function FolderPickerListBody({
  folders,
  isLoading,
  isSaving,
  hasError,
  onOpenFolder,
  onSelectFolder,
}: {
  readonly folders: readonly DriveFolderMetadata[];
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly hasError: boolean;
  readonly onOpenFolder: (folder: DriveFolderMetadata) => void;
  readonly onSelectFolder: (folder: DriveFolderMetadata) => void;
}): ReactNode {
  if (isLoading) {
    return (
      <div
        data-testid="folder-picker-loading"
        role="status"
        className="flex items-center justify-center gap-2 py-10 text-sm text-slate-300"
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4 animate-spin text-indigo-300"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
        <span>フォルダ一覧を読み込み中...</span>
      </div>
    );
  }

  if (folders.length === 0) {
    if (hasError) {
      return null;
    }
    return (
      <p
        data-testid="folder-picker-empty"
        className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 px-4 py-8 text-center text-xs text-slate-400"
      >
        この階層にサブフォルダはありません
      </p>
    );
  }

  return (
    <ul data-testid="folder-picker-list" className="space-y-2">
      {folders.map((folder) => (
        <li
          key={folder.id}
          data-testid="folder-picker-item"
          className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5"
        >
          <span
            title={folder.name}
            className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100"
          >
            {folder.name}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              data-testid="open-subfolder-button"
              disabled={isSaving}
              aria-label={`${folder.name} を開く`}
              onClick={() => onOpenFolder(folder)}
              className="touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              開く
            </button>
            <button
              type="button"
              data-testid="select-subfolder-button"
              disabled={isSaving}
              aria-label={`${folder.name} を選択して追加`}
              onClick={() => onSelectFolder(folder)}
              className="touch-manipulation rounded-lg bg-indigo-500 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              選択して追加
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DriveFolderPickerModal({
  isOpen,
  breadcrumbs,
  folders,
  nextPageToken,
  isLoading,
  isLoadingMore,
  isSaving,
  errorMessage,
  onNavigateBreadcrumb,
  onOpenFolder,
  onSelectFolder,
  onConfirmCurrentFolder,
  onLoadMore,
  onClose,
}: DriveFolderPickerModalProps): ReactNode {
  const dialogRef = useRef<HTMLElement | null>(null);
  useModalFocusTrap({ isOpen, containerRef: dialogRef });

  if (!isOpen) {
    return null;
  }

  const resolvedBreadcrumbs =
    breadcrumbs.length > 0 ? breadcrumbs : [ROOT_BREADCRUMB];
  const currentFolder = resolvedBreadcrumbs[resolvedBreadcrumbs.length - 1];
  const isAtRoot = currentFolder.id === "root";
  const isConfirmDisabled = isAtRoot || isSaving || isLoading;
  const hasError = errorMessage !== null && errorMessage.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        data-testid="folder-picker-backdrop"
        aria-hidden="true"
        onClick={() => {
          if (!isSaving) {
            onClose();
          }
        }}
        className="fixed inset-0 bg-slate-950/80"
      />
      <section
        ref={dialogRef}
        tabIndex={-1}
        data-testid="drive-folder-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Google Drive フォルダを選択"
        style={{
          paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))",
        }}
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-slate-700/80 bg-slate-900 p-5 text-slate-100 shadow-2xl focus:outline-none"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 text-sm font-bold text-white sm:text-base">
            Google Drive フォルダを選択
          </h2>
          <button
            type="button"
            data-testid="close-folder-picker-button"
            disabled={isSaving}
            onClick={onClose}
            className="shrink-0 whitespace-nowrap touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            閉じる
          </button>
        </div>

        <FolderPickerBreadcrumbs
          breadcrumbs={resolvedBreadcrumbs}
          isSaving={isSaving}
          onNavigateBreadcrumb={onNavigateBreadcrumb}
        />

        {hasError && (
          <p
            role="alert"
            data-testid="folder-picker-error"
            className="mt-3 rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-xs font-medium text-rose-300"
          >
            {errorMessage}
          </p>
        )}

        <div className="mt-3 min-h-[180px] flex-1 overflow-y-auto pr-0.5">
          <FolderPickerListBody
            folders={folders}
            isLoading={isLoading}
            isSaving={isSaving}
            hasError={hasError}
            onOpenFolder={onOpenFolder}
            onSelectFolder={onSelectFolder}
          />

          {!isLoading && nextPageToken !== null && (
            <button
              type="button"
              data-testid="folder-picker-load-more"
              disabled={isLoadingMore || isSaving}
              onClick={onLoadMore}
              className="mt-3 w-full touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLoadingMore ? "読み込み中..." : "さらに読み込む"}
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-400">
            {isAtRoot
              ? "マイドライブ直下は登録できません。サブフォルダを選択してください。"
              : `選択中の階層: ${currentFolder.name}`}
          </p>
          <button
            type="button"
            data-testid="confirm-current-folder-button"
            disabled={isConfirmDisabled}
            onClick={onConfirmCurrentFolder}
            className="shrink-0 touch-manipulation rounded-lg bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSaving ? "保存中..." : "このフォルダを追加"}
          </button>
        </div>
      </section>
    </div>
  );
}
