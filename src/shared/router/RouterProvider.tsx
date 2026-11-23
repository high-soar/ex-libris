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
import { RouterContext, type RouterContextValue } from "./routerContext";

export interface RouterProviderProps {
  readonly children?: ReactNode;
  readonly initialPath?: string;
}

interface ExLibrisHistoryState {
  readonly exLibrisCanGoBackFrom?: unknown;
}

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
  const currentPathRef = useRef<string>(currentPath);
  const prevInitialPathRef = useRef<string | undefined>(initialPath);

  const commitPathState = useCallback((nextPath: string) => {
    currentPathRef.current = nextPath;
    setCurrentPath(nextPath);
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
      commitPathState(readWindowPath());
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [commitPathState]);

  const navigate = useCallback(
    (to: string, options?: { replace?: boolean }) => {
      const target = resolveNavigationTarget(to);
      if (currentPathRef.current === target) {
        return;
      }

      if (options?.replace) {
        window.history.replaceState(null, "", target);
      } else {
        window.history.pushState(
          { exLibrisCanGoBackFrom: currentPathRef.current },
          "",
          target,
        );
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
    if (route.name === "reader-local") {
      const state = window.history.state as ExLibrisHistoryState | null;
      if (state?.exLibrisCanGoBackFrom === BOOKSHELF_ROUTE.path) {
        window.history.back();
        return;
      }
      navigate(BOOKSHELF_ROUTE.path, { replace: true });
    }
  }, [route.name, navigate]);

  const contextValue = useMemo<RouterContextValue>(
    () => ({
      currentPath,
      route,
      navigate,
      replace,
      back,
      isBackBlocked: false,
      setBackBlocked: () => {},
    }),
    [currentPath, route, navigate, replace, back],
  );

  return (
    <RouterContext.Provider value={contextValue}>
      {children}
    </RouterContext.Provider>
  );
}
