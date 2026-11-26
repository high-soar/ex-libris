export type AppRoute =
  | { readonly name: "bookshelf"; readonly path: "/" }
  | {
      readonly name: "series-detail";
      readonly path: string;
      readonly seriesId: string;
    }
  | { readonly name: "reader-local"; readonly path: "/read/local" }
  | {
      readonly name: "reader-volume";
      readonly path: string;
      readonly volumeId: string;
    }
  | { readonly name: "settings"; readonly path: "/settings" };

export const BOOKSHELF_ROUTE: AppRoute = { name: "bookshelf", path: "/" };
export const READER_LOCAL_ROUTE: AppRoute = {
  name: "reader-local",
  path: "/read/local",
};
export const SETTINGS_ROUTE: AppRoute = {
  name: "settings",
  path: "/settings",
};

export function buildSeriesDetailPath(seriesId: string): string {
  void seriesId;
  return BOOKSHELF_ROUTE.path;
}

export function buildReaderVolumePath(volumeId: string): string {
  void volumeId;
  return BOOKSHELF_ROUTE.path;
}

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
  if (normalized === SETTINGS_ROUTE.path) {
    return SETTINGS_ROUTE;
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
