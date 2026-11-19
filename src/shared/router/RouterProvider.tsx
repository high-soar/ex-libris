import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { matchRoute, resolveInitialPath } from "./routeMatcher";
import { RouterContext, type RouterContextValue } from "./routerContext";

export interface RouterProviderProps {
  readonly children?: ReactNode;
  readonly initialPath?: string;
}

export function RouterProvider({ children, initialPath }: RouterProviderProps) {
  const [currentPath, setCurrentPath] = useState<string>(() =>
    resolveInitialPath(
      initialPath,
      `${window.location.pathname}${window.location.search}`,
    ),
  );
  const currentPathRef = useRef<string>(currentPath);

  useEffect(() => {
    if (initialPath !== undefined) {
      currentPathRef.current = initialPath;
      setCurrentPath(initialPath);
    }
  }, [initialPath]);

  useEffect(() => {
    const handlePopState = () => {
      const nextPath = `${window.location.pathname}${window.location.search}`;
      currentPathRef.current = nextPath;
      setCurrentPath(nextPath);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const navigate = useCallback(
    (to: string, options?: { replace?: boolean }) => {
      if (currentPathRef.current === to) {
        return;
      }

      if (options?.replace) {
        window.history.replaceState(null, "", to);
      } else {
        window.history.pushState(null, "", to);
      }
      currentPathRef.current = to;
      setCurrentPath(to);
    },
    [],
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
      navigate("/", { replace: true });
    }
  }, [route.name, navigate]);

  const contextValue = useMemo<RouterContextValue>(
    () => ({
      currentPath,
      route,
      navigate,
      replace,
      back,
    }),
    [currentPath, route, navigate, replace, back],
  );

  return (
    <RouterContext.Provider value={contextValue}>
      {children}
    </RouterContext.Provider>
  );
}
