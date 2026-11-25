import type { ParseMangaFilenameInput, ParsedMangaFilename } from "./types";

export function parseMangaFilename(
  _input: ParseMangaFilenameInput,
): ParsedMangaFilename {
  return {
    title: "",
    normalizedTitleKey: "",
    titleReading: "",
    authors: [],
    volumeNumber: null,
    volumeLabel: "",
    isOmnibus: false,
    volumeRangeEnd: null,
    editionNote: null,
  };
}
