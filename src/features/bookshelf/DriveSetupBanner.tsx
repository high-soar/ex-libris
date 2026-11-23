import type { ReactNode } from "react";

export type DriveSetupBannerState =
  | { readonly kind: "loading" }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "no-roots"; readonly email: string }
  | { readonly kind: "ready" };

export interface DriveSetupBannerProps {
  readonly state: DriveSetupBannerState;
  readonly onOpenSettings: () => void;
}

export function DriveSetupBanner({
  state,
  onOpenSettings,
}: DriveSetupBannerProps): ReactNode {
  if (state.kind === "loading" || state.kind === "ready") {
    return null;
  }

  const isUnauthenticated = state.kind === "unauthenticated";

  return (
    <section
      data-testid="drive-setup-banner"
      data-banner-kind={state.kind}
      className={`w-full max-w-2xl rounded-2xl border bg-slate-900/80 p-5 shadow-lg sm:p-6 ${
        isUnauthenticated ? "border-indigo-500/30" : "border-amber-500/30"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          {isUnauthenticated ? (
            <p className="text-xs font-semibold text-indigo-300">
              Google Drive 連携
            </p>
          ) : (
            <p className="text-xs text-amber-300">
              連携済み:{" "}
              <span
                data-testid="drive-setup-banner-email"
                className="font-semibold text-slate-100"
              >
                {state.email}
              </span>
            </p>
          )}
          <h2 className="mt-1 text-base font-bold text-white">
            {isUnauthenticated
              ? "Google アカウントが未連携です"
              : "マンガ保管ルートフォルダが未設定です"}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400 sm:text-sm">
            {isUnauthenticated
              ? "Google Drive と連携すると、クラウド上の .zip / .cbz マンガを端末へ事前保存せずに直接ストリーミング閲覧できます。"
              : "設定画面から同期対象の Google Drive フォルダを 1 つ以上登録または有効化してください。"}
          </p>
        </div>
        <button
          type="button"
          data-testid="drive-setup-banner-cta"
          onClick={onOpenSettings}
          className="shrink-0 touch-manipulation rounded-xl bg-indigo-500 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-400 sm:text-sm"
        >
          {isUnauthenticated ? "設定を開いて連携する" : "フォルダを設定する"}
        </button>
      </div>
    </section>
  );
}
