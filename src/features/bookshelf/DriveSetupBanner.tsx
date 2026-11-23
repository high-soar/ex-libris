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

export function DriveSetupBanner({ state }: DriveSetupBannerProps): ReactNode {
  if (state.kind === "loading" || state.kind === "ready") {
    return null;
  }
  return <section />;
}
