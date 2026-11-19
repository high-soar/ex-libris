export type AppRoute =
  | { readonly name: "bookshelf"; readonly path: "/" }
  | { readonly name: "reader-local"; readonly path: "/read/local" };

export function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "") {
    return "/";
  }
  const [withoutHash] = trimmed.split("#");
  const [pathnameRaw] = withoutHash.split("?");
  const stripped = pathnameRaw.replace(/\/+$/, "");
  return stripped === "" ? "/" : stripped;
}

export function matchRoute(path: string): AppRoute {
  const normalized = normalizePath(path);
  if (normalized === "/read/local") {
    return { name: "reader-local", path: "/read/local" };
  }
  return { name: "bookshelf", path: "/" };
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
  return "/";
}
