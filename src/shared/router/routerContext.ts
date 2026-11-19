import { createContext } from "react";
import type { AppRoute } from "./routeMatcher";

export interface RouterContextValue {
  readonly currentPath: string;
  readonly route: AppRoute;
  readonly navigate: (to: string, options?: { replace?: boolean }) => void;
  readonly replace: (to: string) => void;
  readonly back: () => void;
}

export const RouterContext = createContext<RouterContextValue | null>(null);

export function useRouter(): RouterContextValue {
  throw new Error("Not implemented");
}
