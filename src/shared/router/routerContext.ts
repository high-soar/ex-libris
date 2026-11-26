import { createContext, useContext } from "react";
import type { AppRoute } from "./routeMatcher";

export type ReaderOrigin = "bookshelf" | "series-detail";

export interface ReaderOriginState {
  readonly readerOrigin: ReaderOrigin | null;
  readonly seriesId: string | null;
  readonly canGoBackFrom: string | null;
}

export interface NavigateOptions {
  readonly replace?: boolean;
  readonly readerOrigin?: ReaderOrigin;
  readonly seriesId?: string;
}

export interface RouterContextValue {
  readonly currentPath: string;
  readonly route: AppRoute;
  readonly readerOriginState: ReaderOriginState;
  readonly navigate: (to: string, options?: NavigateOptions) => void;
  readonly replace: (to: string) => void;
  readonly back: () => void;
  readonly exitReader: (fallbackSeriesId?: string | null) => void;
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
