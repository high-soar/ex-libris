import { useEffect, useState } from "react";
import { diagnosticLogger } from "./diagnostics/diagnosticLogger";
import { APP_NAME, APP_VERSION } from "./shared/constants/app";

export type CopyStatus = "idle" | "copied" | "failed";

export interface AppProps {
  initialCopyStatus?: CopyStatus;
}

export function App({ initialCopyStatus = "idle" }: AppProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>(initialCopyStatus);

  useEffect(() => {
    window.__exLibrisServices = { isReady: true };
    diagnosticLogger.info("app", "ExLibris shell initialized");
  }, []);

  const handleCopyDiagnostics = async () => {
    const report = diagnosticLogger.formatReport();
    if (!navigator.clipboard) {
      setCopyStatus("failed");
      return;
    }

    try {
      await navigator.clipboard.writeText(report);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return (
    <div
      data-testid="app-root"
      data-app-ready="true"
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col"
    >
      <header className="border-b border-slate-800 bg-slate-900/90 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight text-white">
            {APP_NAME}
          </h1>
          <span
            data-testid="app-version"
            className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-medium text-indigo-300"
          >
            v{APP_VERSION}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {copyStatus === "copied" && (
            <span
              data-testid="copy-diagnostics-status"
              role="status"
              className="text-xs font-medium text-emerald-400"
            >
              診断ログをコピーしました
            </span>
          )}
          {copyStatus === "failed" && (
            <span
              data-testid="copy-diagnostics-status"
              role="alert"
              className="text-xs font-medium text-rose-400"
            >
              クリップボードへコピーできませんでした
            </span>
          )}
          <button
            type="button"
            data-testid="copy-diagnostics-button"
            onClick={handleCopyDiagnostics}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors"
          >
            診断ログをコピー
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <section
          data-testid="bookshelf-empty"
          className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center shadow-lg"
        >
          <p className="text-sm font-semibold text-indigo-300">仮想本棚</p>
          <h2 className="mt-2 text-lg font-bold text-white">
            まだ本棚に作品が登録されていません
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            超高速ストリーミング自炊マンガビューア＆仮想本棚の初期シェルです。Google
            Drive 連携および WebGL2 リーダーは次フェーズ以降で順次構築します。
          </p>
        </section>
      </main>
    </div>
  );
}
