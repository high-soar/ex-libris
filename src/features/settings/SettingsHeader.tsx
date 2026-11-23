import type { ReactNode } from "react";
import { APP_VERSION } from "../../shared/constants/app";

export interface SettingsHeaderProps {
  readonly isBackBlocked?: boolean;
  readonly onBack: () => void;
}

export function SettingsHeader({
  isBackBlocked = false,
  onBack,
}: SettingsHeaderProps): ReactNode {
  return (
    <header
      style={{ paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))" }}
      className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/90 px-6 py-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="settings-back-button"
          disabled={isBackBlocked}
          onClick={onBack}
          className="touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm"
        >
          本棚へ戻る
        </button>
        <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">
          ストレージ連携・設定
        </h1>
      </div>
      <span
        data-testid="settings-app-version"
        className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-medium text-indigo-300"
      >
        v{APP_VERSION}
      </span>
    </header>
  );
}
