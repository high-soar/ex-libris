import type { ReactNode } from "react";
import type { DiagnosticLogger } from "../../diagnostics/types";
import type { SettingsPageInitialSnapshot } from "./types";

export interface SettingsPageProps {
  readonly initialSnapshot?: SettingsPageInitialSnapshot;
  readonly logger?: DiagnosticLogger;
  readonly onRegisterModalBack?: (closeModalFn: (() => void) | null) => void;
}

export function SettingsPage({
  initialSnapshot,
  logger,
  onRegisterModalBack,
}: SettingsPageProps): ReactNode {
  void initialSnapshot;
  void logger;
  void onRegisterModalBack;
  return <div data-testid="settings-page" />;
}
