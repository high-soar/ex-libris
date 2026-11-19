import type { ReactNode } from "react";

export interface RouterProviderProps {
  readonly children?: ReactNode;
  readonly initialPath?: string;
}

export function RouterProvider({ children }: RouterProviderProps) {
  return <>{children}</>;
}
