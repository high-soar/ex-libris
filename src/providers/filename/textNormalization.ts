const WAVE_DASH_PATTERN = /[\u301C\uFF5E]/g;
const HYPHEN_VARIANT_PATTERN = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;
const WHITESPACE_RUN_PATTERN = /\s+/g;
const KATAKANA_PATTERN = /[\u30A1-\u30F6]/g;

export function normalizeSeriesTitleKey(title: string): string {
  return title
    .normalize("NFKC")
    .replace(WAVE_DASH_PATTERN, "~")
    .replace(HYPHEN_VARIANT_PATTERN, "-")
    .replace(WHITESPACE_RUN_PATTERN, " ")
    .trim()
    .toLowerCase();
}

export function generateInitialTitleReading(title: string): string {
  return title
    .normalize("NFKC")
    .replace(KATAKANA_PATTERN, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0x60),
    )
    .replace(WHITESPACE_RUN_PATTERN, " ")
    .trim()
    .toLowerCase();
}
