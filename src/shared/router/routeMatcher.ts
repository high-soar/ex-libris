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

const SERIES_DETAIL_PREFIX = "/series/";
const READER_VOLUME_PREFIX = "/read/volume/";

export function buildSeriesDetailPath(seriesId: string): string {
  return `${SERIES_DETAIL_PREFIX}${encodeURIComponent(seriesId)}`;
}

export function buildReaderVolumePath(volumeId: string): string {
  return `${READER_VOLUME_PREFIX}${encodeURIComponent(volumeId)}`;
}

function decodeSingleRouteParam(rawSegment: string): string | null {
  if (rawSegment.includes("/")) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawSegment);
  } catch {
    return null;
  }
  if (decoded.trim().length === 0 || decoded.includes("/")) {
    return null;
  }
  return decoded;
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
  if (normalized.startsWith(SERIES_DETAIL_PREFIX)) {
    const seriesId = decodeSingleRouteParam(
      normalized.slice(SERIES_DETAIL_PREFIX.length),
    );
    if (seriesId !== null) {
      return {
        name: "series-detail",
        path: buildSeriesDetailPath(seriesId),
        seriesId,
      };
    }
  }
  if (normalized.startsWith(READER_VOLUME_PREFIX)) {
    const volumeId = decodeSingleRouteParam(
      normalized.slice(READER_VOLUME_PREFIX.length),
    );
    if (volumeId !== null) {
      return {
        name: "reader-volume",
        path: buildReaderVolumePath(volumeId),
        volumeId,
      };
    }
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
