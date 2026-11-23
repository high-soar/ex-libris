import type { ReactNode } from "react";
import type { GoogleAccountAuthStatus } from "./types";

export interface GoogleAccountSectionProps {
  readonly status: GoogleAccountAuthStatus;
  readonly email: string | null;
  readonly errorMessage: string | null;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
}

export function GoogleAccountSection({
  status: _status,
  email: _email,
  errorMessage: _errorMessage,
  onSignIn: _onSignIn,
  onSignOut: _onSignOut,
}: GoogleAccountSectionProps): ReactNode {
  return <section />;
}
