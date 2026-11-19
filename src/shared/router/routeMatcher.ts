export type AppRoute =
  | { readonly name: "bookshelf"; readonly path: "/" }
  | { readonly name: "reader-local"; readonly path: "/read/local" };

export function normalizePath(_path: string): string {
  return "";
}

export function matchRoute(_path: string): AppRoute {
  return { name: "bookshelf", path: "/" };
}

export function resolveInitialPath(
  _initialPath?: string,
  _fallbackPath?: string,
): string {
  return "";
}
