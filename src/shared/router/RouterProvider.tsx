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
  buildSeriesDetailPath,
  matchRoute,
  resolveInitialPath,
} from "./routeMatcher";
import {
  type NavigateOptions,
  type ReaderOrigin,
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
  readonly readerOrigin?: unknown;
  readonly seriesId?: unknown;
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

function normalizeOptionalId(value?: string | null): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseReaderOriginState(rawState: unknown): ReaderOriginState {
  if (typeof rawState !== "object" || rawState === null) {
    return EMPTY_READER_ORIGIN_STATE;
  }
  const state = rawState as ExLibrisHistoryState;
  const readerOrigin: ReaderOrigin | null =
    state.readerOrigin === "bookshelf" || state.readerOrigin === "series-detail"
      ? state.readerOrigin
      : null;
  const seriesId =
    typeof state.seriesId === "string" && state.seriesId.trim().length > 0
      ? state.seriesId
      : null;
  const canGoBackFrom =
    typeof state.exLibrisCanGoBackFrom === "string" &&
    state.exLibrisCanGoBackFrom.length > 0
      ? state.exLibrisCanGoBackFrom
      : null;
  return { readerOrigin, seriesId, canGoBackFrom };
}

function buildNextHistoryState(
  previousPath: string | null,
  options?: NavigateOptions,
): ExLibrisHistoryState | null {
  const hasOrigin = options?.readerOrigin !== undefined;
  const hasSeriesId = options?.seriesId !== undefined;
  if (previousPath === null && !hasOrigin && !hasSeriesId) {
    return null;
  }
  return {
    ...(previousPath !== null ? { exLibrisCanGoBackFrom: previousPath } : {}),
    ...(hasOrigin ? { readerOrigin: options.readerOrigin } : {}),
    ...(hasSeriesId ? { seriesId: options.seriesId } : {}),
  };
}

export function RouterProvider({ children, initialPath }: RouterProviderProps) {
  const [currentPath, setCurrentPath] = useState<string>(() =>
    resolveInitialPath(initialPath, readWindowPath()),
  );
  const [readerOriginState, setReaderOriginState] = useState<ReaderOriginState>(
    () => parseReaderOriginState(window.history.state),
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
      setReaderOriginState(parseReaderOriginState(window.history.state));
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

      const nextState = buildNextHistoryState(
        options?.replace ? null : currentPathRef.current,
        options,
      );
      lastHistoryStateRef.current = nextState;
      if (options?.replace) {
        window.history.replaceState(nextState, "", target);
      } else {
        window.history.pushState(nextState, "", target);
      }
      setReaderOriginState(parseReaderOriginState(nextState));
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
    if (
      route.name === "reader-local" ||
      route.name === "settings" ||
      route.name === "series-detail"
    ) {
      const originState = parseReaderOriginState(window.history.state);
      if (originState.canGoBackFrom === BOOKSHELF_ROUTE.path) {
        window.history.back();
        return;
      }
      navigate(BOOKSHELF_ROUTE.path, { replace: true });
    }
  }, [route.name, navigate]);

  const exitReader = useCallback(
    (fallbackSeriesId?: string | null) => {
      if (isBackBlockedRef.current) {
        return;
      }
      if (route.name === "reader-local") {
        back();
        return;
      }
      if (route.name !== "reader-volume") {
        return;
      }

      const originState = parseReaderOriginState(window.history.state);
      const resolvedFallbackSeriesId = normalizeOptionalId(fallbackSeriesId);

      if (originState.readerOrigin === "bookshelf") {
        if (originState.canGoBackFrom === BOOKSHELF_ROUTE.path) {
          window.history.back();
          return;
        }
        navigate(BOOKSHELF_ROUTE.path, { replace: true });
        return;
      }

      if (originState.readerOrigin === "series-detail") {
        if (
          originState.canGoBackFrom !== null &&
          matchRoute(originState.canGoBackFrom).name === "series-detail"
        ) {
          window.history.back();
          return;
        }
        const targetSeriesId = originState.seriesId ?? resolvedFallbackSeriesId;
        if (targetSeriesId !== null) {
          navigate(buildSeriesDetailPath(targetSeriesId), { replace: true });
          return;
        }
        navigate(BOOKSHELF_ROUTE.path, { replace: true });
        return;
      }

      if (resolvedFallbackSeriesId !== null) {
        navigate(buildSeriesDetailPath(resolvedFallbackSeriesId), {
          replace: true,
        });
        return;
      }
      navigate(BOOKSHELF_ROUTE.path, { replace: true });
    },
    [route.name, back, navigate],
  );

  const contextValue = useMemo<RouterContextValue>(
    () => ({
      currentPath,
      route,
      readerOriginState,
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
      readerOriginState,
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
