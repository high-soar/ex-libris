import type { FormEvent, ReactNode } from "react";
import type { DriveSyncRootRecord } from "../../storage/types";

export interface DriveSyncRootsSectionProps {
  readonly roots: readonly DriveSyncRootRecord[];
  readonly isConnected: boolean;
  readonly folderInput: string;
  readonly isSubmitting: boolean;
  readonly isSyncing?: boolean;
  readonly errorMessage: string | null;
  readonly onChangeFolderInput: (value: string) => void;
  readonly onAddFolderByInput: () => void;
  readonly onOpenFolderPicker: () => void;
  readonly onToggleRootEnabled: (
    folderId: string,
    nextEnabled: boolean,
  ) => void;
  readonly onRemoveRoot: (folderId: string) => void;
}

function SyncRootRow({
  root,
  onToggleRootEnabled,
  onRemoveRoot,
}: {
  readonly root: DriveSyncRootRecord;
  readonly onToggleRootEnabled: (
    folderId: string,
    nextEnabled: boolean,
  ) => void;
  readonly onRemoveRoot: (folderId: string) => void;
}): ReactNode {
  const isEnabled = root.enabled === 1;

  return (
    <li
      data-testid="sync-root-item"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p
          title={root.folderName}
          className="truncate text-sm font-semibold text-slate-100"
        >
          {root.folderName}
        </p>
        <p
          title={root.folderId}
          className="mt-0.5 truncate font-mono text-xs text-slate-400"
        >
          {root.folderId}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          data-testid="toggle-sync-root-button"
          aria-pressed={isEnabled}
          aria-label={`${root.folderName} の同期を${isEnabled ? "無効" : "有効"}にする`}
          onClick={() => onToggleRootEnabled(root.folderId, !isEnabled)}
          className={`touch-manipulation rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            isEnabled
              ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
              : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          {isEnabled ? "有効" : "無効"}
        </button>
        <button
          type="button"
          data-testid="remove-sync-root-button"
          aria-label={`${root.folderName} を削除`}
          onClick={() => onRemoveRoot(root.folderId)}
          className="touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-rose-500/50 hover:bg-rose-950/50 hover:text-rose-200"
        >
          削除
        </button>
      </div>
    </li>
  );
}

export function DriveSyncRootsSection({
  roots,
  isConnected,
  folderInput,
  isSubmitting,
  errorMessage,
  onChangeFolderInput,
  onAddFolderByInput,
  onOpenFolderPicker,
  onToggleRootEnabled,
  onRemoveRoot,
}: DriveSyncRootsSectionProps): ReactNode {
  const isAdditionDisabled = !isConnected || isSubmitting;
  const isSubmitDisabled =
    isAdditionDisabled || folderInput.trim().length === 0;
  const hasError = errorMessage !== null && errorMessage.length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitDisabled) {
      return;
    }
    onAddFolderByInput();
  };

  return (
    <section
      data-testid="drive-sync-roots-section"
      aria-labelledby="drive-sync-roots-heading"
      className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="drive-sync-roots-heading"
            className="text-base font-bold text-white sm:text-lg"
          >
            マンガ保管ルートフォルダ
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400 sm:text-sm">
            同期対象にする Google Drive
            フォルダを指定します（サブフォルダ配下も対象になります）。
          </p>
        </div>
        <button
          type="button"
          data-testid="open-folder-picker-button"
          disabled={isAdditionDisabled}
          onClick={onOpenFolderPicker}
          className="shrink-0 touch-manipulation rounded-lg border border-indigo-400/50 bg-indigo-500/20 px-3.5 py-2 text-xs font-semibold text-indigo-200 transition-colors hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm"
        >
          Drive からフォルダを選択
        </button>
      </div>

      {!isConnected && (
        <p
          data-testid="sync-roots-unlinked-notice"
          className="mt-3 rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-xs text-slate-300"
        >
          フォルダを追加するには先に Google アカウントと連携してください
        </p>
      )}

      <form
        onSubmit={handleSubmit}
        className="mt-4 flex flex-col gap-2 sm:flex-row"
      >
        <input
          type="text"
          data-testid="folder-input"
          aria-label="Google Drive フォルダ URL または ID"
          placeholder="https://drive.google.com/drive/folders/... または フォルダ ID"
          value={folderInput}
          disabled={isAdditionDisabled}
          onChange={(event) => onChangeFolderInput(event.currentTarget.value)}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
        />
        <button
          type="submit"
          data-testid="add-folder-by-input-button"
          disabled={isSubmitDisabled}
          className="shrink-0 touch-manipulation rounded-lg bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm"
        >
          {isSubmitting ? "追加中..." : "URL / ID で追加"}
        </button>
      </form>

      {hasError && (
        <p
          role="alert"
          data-testid="sync-roots-error"
          className="mt-3 rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-xs font-medium text-rose-300"
        >
          {errorMessage}
        </p>
      )}

      {roots.length === 0 ? (
        <p
          data-testid="sync-roots-empty"
          className="mt-4 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 px-4 py-6 text-center text-xs text-slate-400"
        >
          登録済みのマンガ保管フォルダはありません
        </p>
      ) : (
        <ul data-testid="sync-roots-list" className="mt-4 space-y-2.5">
          {roots.map((root) => (
            <SyncRootRow
              key={root.folderId}
              root={root}
              onToggleRootEnabled={onToggleRootEnabled}
              onRemoveRoot={onRemoveRoot}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
