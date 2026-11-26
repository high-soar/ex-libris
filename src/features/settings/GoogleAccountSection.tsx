import type { ReactNode } from "react";
import type { GoogleAccountAuthStatus } from "./types";

export interface GoogleAccountSectionProps {
  readonly status: GoogleAccountAuthStatus;
  readonly email: string | null;
  readonly errorMessage: string | null;
  readonly isSyncing?: boolean;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
}

const STATUS_BADGE: Record<
  GoogleAccountAuthStatus,
  { readonly label: string; readonly className: string }
> = {
  unlinked: {
    label: "未連携",
    className: "border border-slate-600/60 bg-slate-800 text-slate-300",
  },
  "signing-in": {
    label: "処理中",
    className: "border border-indigo-400/40 bg-indigo-500/20 text-indigo-200",
  },
  "signing-out": {
    label: "処理中",
    className: "border border-indigo-400/40 bg-indigo-500/20 text-indigo-200",
  },
  connected: {
    label: "連携済み",
    className:
      "border border-emerald-500/40 bg-emerald-500/20 text-emerald-300",
  },
};

function AuthSpinner(): ReactNode {
  return (
    <svg
      data-testid="google-auth-spinner"
      aria-hidden="true"
      className="h-4 w-4 animate-spin"
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
  );
}

export function GoogleAccountSection({
  status,
  email,
  errorMessage,
  onSignIn,
  onSignOut,
}: GoogleAccountSectionProps): ReactNode {
  const badge = STATUS_BADGE[status];
  const isConnectedOrSigningOut =
    status === "connected" || status === "signing-out";
  const isSigningIn = status === "signing-in";
  const isSigningOut = status === "signing-out";

  return (
    <section
      data-testid="google-account-section"
      aria-labelledby="google-account-heading"
      className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="google-account-heading"
          className="text-base font-bold text-white sm:text-lg"
        >
          Google アカウント連携
        </h2>
        <span
          data-testid="google-auth-status-badge"
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-400 sm:text-sm">
        読み取り専用スコープ（
        <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-indigo-300">
          drive.readonly
        </code>
        ）のみを使用し、Google Drive 上の .zip / .cbz
        ファイルを端末へ事前保存せずに直接ストリーミング閲覧します。
      </p>

      {isConnectedOrSigningOut ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-400">連携中のアカウント</p>
            <p
              data-testid="google-account-email"
              className="mt-0.5 truncate text-sm font-medium text-slate-100"
            >
              {email ?? "Google Drive 連携済み"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {isSigningOut && (
              <span
                data-testid="google-auth-processing"
                role="status"
                className="text-xs font-medium text-indigo-300"
              >
                連携解除を処理中...
              </span>
            )}
            <button
              type="button"
              data-testid="google-signout-button"
              disabled={isSigningOut}
              onClick={onSignOut}
              className="inline-flex shrink-0 items-center gap-2 touch-manipulation rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
            >
              {isSigningOut && <AuthSpinner />}
              <span>
                {isSigningOut
                  ? "ログアウト処理中..."
                  : "連携を解除（ログアウト）"}
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="google-signin-button"
            disabled={isSigningIn}
            onClick={onSignIn}
            className="inline-flex items-center gap-2 touch-manipulation rounded-lg bg-indigo-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
          >
            {isSigningIn && <AuthSpinner />}
            <span>
              {isSigningIn ? "ログイン処理中..." : "Google でログイン"}
            </span>
          </button>
          {isSigningIn && (
            <span
              data-testid="google-auth-processing"
              role="status"
              className="text-xs font-medium text-indigo-300"
            >
              Google アカウントと連携中...
            </span>
          )}
        </div>
      )}

      {errorMessage !== null && errorMessage.length > 0 && (
        <p
          role="alert"
          data-testid="google-auth-error"
          className="mt-4 rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-xs font-medium text-rose-300"
        >
          {errorMessage}
        </p>
      )}
    </section>
  );
}
