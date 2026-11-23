import { createContext, useContext } from "react";
import type { AppRoute } from "./routeMatcher";

export interface RouterContextValue {
  readonly currentPath: string;
  readonly route: AppRoute;
  readonly navigate: (to: string, options?: { replace?: boolean }) => void;
  readonly replace: (to: string) => void;
  readonly back: () => void;
  readonly isBackBlocked: boolean;
  readonly setBackBlocked: (blocked: boolean) => void;
}

export const RouterContext = createContext<RouterContextValue | null>(null);

export function useRouter(): RouterContextValue {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error("useRouter must be used within a RouterProvider");
  }
  return context;
}
