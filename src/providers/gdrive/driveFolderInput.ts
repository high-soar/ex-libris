const DRIVE_FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const DRIVE_FOLDER_PATH_PATTERN =
  /^\/drive(?:\/u\/\d+)?\/folders\/([A-Za-z0-9_-]{3,128})\/?$/;
const DRIVE_OPEN_PATH_PATTERN = /^\/open\/?$/;

function acceptFolderId(candidate: string): string | null {
  if (
    !DRIVE_FOLDER_ID_PATTERN.test(candidate) ||
    candidate.toLowerCase() === "root"
  ) {
    return null;
  }
  return candidate;
}

export function parseDriveFolderInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (DRIVE_FOLDER_ID_PATTERN.test(trimmed)) {
    return acceptFolderId(trimmed);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== "drive.google.com") {
    return null;
  }

  const pathMatch = DRIVE_FOLDER_PATH_PATTERN.exec(parsed.pathname);
  if (pathMatch !== null) {
    return acceptFolderId(pathMatch[1]!);
  }

  if (DRIVE_OPEN_PATH_PATTERN.test(parsed.pathname)) {
    const idParam = parsed.searchParams.get("id")?.trim() ?? "";
    return acceptFolderId(idParam);
  }

  return null;
}
