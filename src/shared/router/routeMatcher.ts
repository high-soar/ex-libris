export type AppRoute =
  | { readonly name: "bookshelf"; readonly path: "/" }
  | { readonly name: "reader-local"; readonly path: "/read/local" };

export const BOOKSHELF_ROUTE: AppRoute = { name: "bookshelf", path: "/" };
export const READER_LOCAL_ROUTE: AppRoute = {
  name: "reader-local",
  path: "/read/local",
};

export function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "") {
    return BOOKSHELF_ROUTE.path;
  }
  const [withoutHash] = trimmed.split("#");
  const [pathnameRaw] = withoutHash.split("?");
  const stripped = pathnameRaw.replace(/\/+$/, "");
  return stripped === "" ? BOOKSHELF_ROUTE.path : stripped;
}

export function matchRoute(path: string): AppRoute {
  const normalized = normalizePath(path);
  if (normalized === READER_LOCAL_ROUTE.path) {
    return READER_LOCAL_ROUTE;
  }
  return BOOKSHELF_ROUTE;
}

export function resolveInitialPath(
  initialPath?: string,
  fallbackPath?: string,
): string {
  if (initialPath !== undefined) {
    return initialPath;
  }
  if (fallbackPath) {
    return fallbackPath;
  }
  return BOOKSHELF_ROUTE.path;
}
