import type { ReactNode } from "react";

export interface SettingsHeaderProps {
  readonly isBackBlocked?: boolean;
  readonly onBack: () => void;
}

export function SettingsHeader({
  isBackBlocked: _isBackBlocked = false,
  onBack: _onBack,
}: SettingsHeaderProps): ReactNode {
  return <header />;
}
