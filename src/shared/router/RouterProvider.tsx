import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BOOKSHELF_ROUTE,
  matchRoute,
  resolveInitialPath,
} from "./routeMatcher";
import {
  type NavigateOptions,
  type ReaderOriginState,
  RouterContext,
  type RouterContextValue,
} from "./routerContext";

export interface RouterProviderProps {
  readonly children?: ReactNode;
  readonly initialPath?: string;
}

interface ExLibrisHistoryState {
  readonly exLibrisCanGoBackFrom?: unknown;
}

const EMPTY_READER_ORIGIN_STATE: ReaderOriginState = {
  readerOrigin: null,
  seriesId: null,
  canGoBackFrom: null,
};

function readWindowPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function resolveNavigationTarget(to: string): string {
  const trimmed = to.trim();
  return trimmed === "" ? BOOKSHELF_ROUTE.path : trimmed;
}

export function RouterProvider({ children, initialPath }: RouterProviderProps) {
  const [currentPath, setCurrentPath] = useState<string>(() =>
    resolveInitialPath(initialPath, readWindowPath()),
  );
  const [isBackBlocked, setIsBackBlocked] = useState<boolean>(false);
  const currentPathRef = useRef<string>(currentPath);
  const lastHistoryStateRef = useRef<unknown>(window.history.state);
  const isBackBlockedRef = useRef<boolean>(false);
  const prevInitialPathRef = useRef<string | undefined>(initialPath);

  const commitPathState = useCallback((nextPath: string) => {
    currentPathRef.current = nextPath;
    setCurrentPath(nextPath);
  }, []);

  const setBackBlocked = useCallback((blocked: boolean) => {
    isBackBlockedRef.current = blocked;
    setIsBackBlocked(blocked);
  }, []);

  useEffect(() => {
    if (prevInitialPathRef.current !== initialPath) {
      prevInitialPathRef.current = initialPath;
      if (initialPath !== undefined) {
        commitPathState(initialPath);
      }
    }
  }, [initialPath, commitPathState]);

  useEffect(() => {
    const handlePopState = () => {
      if (isBackBlockedRef.current) {
        if (readWindowPath() !== currentPathRef.current) {
          window.history.pushState(
            lastHistoryStateRef.current,
            "",
            currentPathRef.current,
          );
        }
        return;
      }
      lastHistoryStateRef.current = window.history.state;
      commitPathState(readWindowPath());
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [commitPathState]);

  const navigate = useCallback(
    (to: string, options?: NavigateOptions) => {
      const target = resolveNavigationTarget(to);
      if (currentPathRef.current === target) {
        return;
      }

      if (options?.replace) {
        lastHistoryStateRef.current = null;
        window.history.replaceState(null, "", target);
      } else {
        const nextState: ExLibrisHistoryState = {
          exLibrisCanGoBackFrom: currentPathRef.current,
        };
        lastHistoryStateRef.current = nextState;
        window.history.pushState(nextState, "", target);
      }
      commitPathState(target);
    },
    [commitPathState],
  );

  const replace = useCallback(
    (to: string) => {
      navigate(to, { replace: true });
    },
    [navigate],
  );

  const route = useMemo(() => matchRoute(currentPath), [currentPath]);

  const back = useCallback(() => {
    if (isBackBlockedRef.current) {
      return;
    }
    if (route.name === "reader-local" || route.name === "settings") {
      const state = window.history.state as ExLibrisHistoryState | null;
      if (state?.exLibrisCanGoBackFrom === BOOKSHELF_ROUTE.path) {
        window.history.back();
        return;
      }
      navigate(BOOKSHELF_ROUTE.path, { replace: true });
    }
  }, [route.name, navigate]);

  const exitReader = useCallback((fallbackSeriesId?: string | null) => {
    void fallbackSeriesId;
  }, []);

  const contextValue = useMemo<RouterContextValue>(
    () => ({
      currentPath,
      route,
      readerOriginState: EMPTY_READER_ORIGIN_STATE,
      navigate,
      replace,
      back,
      exitReader,
      isBackBlocked,
      setBackBlocked,
    }),
    [
      currentPath,
      route,
      navigate,
      replace,
      back,
      exitReader,
      isBackBlocked,
      setBackBlocked,
    ],
  );

  return (
    <RouterContext.Provider value={contextValue}>
      {children}
    </RouterContext.Provider>
  );
}
