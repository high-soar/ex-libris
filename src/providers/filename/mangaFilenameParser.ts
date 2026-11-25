import {
  generateInitialTitleReading,
  normalizeSeriesTitleKey,
} from "./textNormalization";
import type { ParseMangaFilenameInput, ParsedMangaFilename } from "./types";

const ARCHIVE_EXTENSION_PATTERN = /\.(?:zip|cbz)$/i;
const WHITESPACE_RUN_PATTERN = /\s+/g;
const BRACKET_TOKEN_PATTERN =
  /(?:\([^()]*\)|（[^（）]*）|\[[^[\]]*\]|［[^［］]*］|【[^【】]*】)/g;

const NOISE_TAGS = new Set<string>([
  "一般コミック",
  "成年コミック",
  "成人コミック",
  "同人誌",
  "商業誌",
  "雑誌",
  "青年コミック",
  "少年コミック",
  "少女コミック",
  "女性コミック",
  "単行本",
  "デジタル版",
  "電子版",
  "dl版",
  "完結",
  "raw",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "avif",
  "jp",
  "jpn",
  "japanese",
  "日本語",
]);

const EDITION_NOTES = new Set<string>([
  "初回限定版",
  "電子限定版",
  "フルカラー版",
  "小冊子付き",
  "特装版",
  "限定版",
  "特別版",
  "完全版",
  "新装版",
  "愛蔵版",
  "ワイド版",
  "カラー版",
]);

const STANDALONE_EDITION_PATTERN =
  /(?:^|[\s_]|(?<=巻))(初回限定版|電子限定版|フルカラー版|小冊子付き|特装版|限定版|特別版|完全版|新装版|愛蔵版|ワイド版|カラー版)(?=$|[\s_])/g;

const LEADING_AUTHOR_BRACKET_PATTERN =
  /^(?:\[([^[\]]+)\]|［([^［］]+)］|【([^【】]+)】)\s*(.*)$/;

const VOLUME_BLOCK_PATTERN =
  /^(?:第?\s*\d+(?:\.\d+)?\s*巻|第?\s*\d+\s*巻?\s*[-~〜‐‑‒–—―−]\s*第?\s*\d+\s*巻(?:\s*(?:合本版?|セット))?|(?:vol\.?|v)\s*\d+\s*[-~〜‐‑‒–—―−]\s*(?:vol\.?|v)?\s*\d+(?:\s*(?:合本版?|セット))?|\d+\s*[-~〜‐‑‒–—―−]\s*\d+\s*(?:合本版?|セット)|全\s*\d+\s*巻(?:\s*(?:合本版?|セット))?|全巻合本|全巻セット|合本版?|(?:vol\.?|v|no\.?|#|その)\s*\d+(?:\.\d+)?)$/i;

const AUTHOR_SEPARATOR_SET = new Set(["×", "・", "&", "＆", ",", "、", "/"]);

const RANGE_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s_])?(?:[[【]\s*)?(?:第\s*)?(\d+)\s*巻?\s*[-~〜‐‑‒–—―−]\s*(?:第\s*)?(\d+)\s*巻(?:\s*(?:合本版?|セット))?(?:\s*[\]】])?/u,
  /(?:^|[\s_])(?:[[【]\s*)?(?:vol\.?|v)\s*(\d+)\s*[-~〜‐‑‒–—―−]\s*(?:vol\.?|v)?\s*(\d+)(?:\s*(?:合本版?|セット))?(?:\s*[\]】])?(?=$|[\s_])/iu,
  /(?:^|[\s_])(?:[[【]\s*)?(\d+)\s*[-~〜‐‑‒–—―−]\s*(\d+)\s*(?:合本版?|セット)(?:\s*[\]】])?(?=$|[\s_])/u,
];

const ALL_VOLUMES_PATTERN =
  /(?:^|[\s_])?(?:[[【]\s*)?全\s*(\d+)\s*巻(?:\s*(?:合本版?|セット))?(?:\s*[\]】])?/u;

const OMNIBUS_WITHOUT_NUMBER_PATTERN =
  /(?:^|[\s_])?(?:[[【(]\s*)?(?:全巻合本|全巻セット|合本版?)(?:\s*[\]】)])?(?=$|[\s_])/u;

const EXPLICIT_VOLUME_PATTERNS: readonly RegExp[] = [
  /(?:[[【]\s*)?第\s*(\d+(?:\.\d+)?)\s*巻(?:\s*[\]】])?/u,
  /(?:[[【]\s*)?(?<![0-9-~〜‐‑‒–—―−全])(\d+(?:\.\d+)?)\s*巻(?:\s*[\]】])?/u,
  /(?:^|[\s_])(?:[[【]\s*)?(?:vol\.?|v|no\.?|#|その)\s*(\d+(?:\.\d+)?)(?:\s*[\]】])?(?=$|[\s_])/iu,
];

const TRAILING_PAREN_VOLUME_PATTERN = /(?:^|[\s_])\(\s*(\d+(?:\.\d+)?)\s*\)$/u;

const NAMED_PART_PATTERN =
  /(?:^|[\s_])?(上巻|中巻|下巻|前編|中編|後編)(?=$|[\s_])/u;

const TRAILING_SHORT_PART_PATTERN = /(?:^|[\s_])([上中下])$/u;

const TRAILING_NUMBER_PATTERN = /(?:^|[\s_])(\d+(?:\.\d+)?)$/u;

const PART_VOLUME_MAP: Readonly<
  Record<string, { readonly number: number; readonly label: string }>
> = {
  上巻: { number: 1, label: "上巻" },
  中巻: { number: 2, label: "中巻" },
  下巻: { number: 3, label: "下巻" },
  上: { number: 1, label: "上巻" },
  中: { number: 2, label: "中巻" },
  下: { number: 3, label: "下巻" },
  前編: { number: 1, label: "前編" },
  中編: { number: 2, label: "中編" },
  後編: { number: 3, label: "後編" },
};

interface ExtractedVolume {
  readonly title: string;
  readonly volumeNumber: number | null;
  readonly volumeRangeEnd: number | null;
  readonly isOmnibus: boolean;
  readonly volumeLabel: string;
}

interface AnalysisText {
  readonly normalized: string;
  readonly indexMap: readonly number[];
}

function collapseSpaces(value: string): string {
  return value.replace(WHITESPACE_RUN_PATTERN, " ").trim();
}

function cleanRemainingTitle(raw: string): string {
  return collapseSpaces(raw.replace(/[\s_]+$/, "").replace(/\s+[-–—]\s*$/, ""));
}

function formatVolumeNumber(value: number): string {
  return Number.isInteger(value) && value < 10
    ? String(value).padStart(2, "0")
    : String(value);
}

function appendEditionNote(label: string, editionNote: string | null): string {
  return editionNote !== null ? `${label} ${editionNote}` : label;
}

function pushUnique(target: string[], item: string): void {
  if (!target.includes(item)) {
    target.push(item);
  }
}

function stripNoiseAndEditionNotes(input: string): {
  readonly text: string;
  readonly editionNote: string | null;
} {
  const editionNotes: string[] = [];

  const withoutNoiseBrackets = input.replace(
    BRACKET_TOKEN_PATTERN,
    (fullMatch: string) => {
      const inner = collapseSpaces(fullMatch.slice(1, -1).normalize("NFKC"));
      if (NOISE_TAGS.has(inner.toLowerCase())) {
        return " ";
      }
      if (EDITION_NOTES.has(inner)) {
        pushUnique(editionNotes, inner);
        return " ";
      }
      return fullMatch;
    },
  );

  const withoutStandaloneEdition = withoutNoiseBrackets.replace(
    STANDALONE_EDITION_PATTERN,
    (_fullMatch, note: string) => {
      pushUnique(editionNotes, note);
      return " ";
    },
  );

  return {
    text: collapseSpaces(withoutStandaloneEdition),
    editionNote: editionNotes.length > 0 ? editionNotes.join(" ") : null,
  };
}

function splitAuthorTokens(rawBlock: string): string[] {
  const cleanedBlock = collapseSpaces(
    rawBlock
      .replace(/\(\s*\)|（\s*）/g, "")
      .replace(/\(\s*([^()]+?)\s*\)/g, "($1)")
      .replace(/（\s*([^（）]+?)\s*）/g, "（$1）"),
  );

  const tokens: string[] = [];
  let current = "";
  let parenDepth = 0;

  for (const ch of cleanedBlock) {
    if (ch === "(" || ch === "（") {
      parenDepth += 1;
      current += ch;
    } else if ((ch === ")" || ch === "）") && parenDepth > 0) {
      parenDepth -= 1;
      current += ch;
    } else if (parenDepth === 0 && AUTHOR_SEPARATOR_SET.has(ch)) {
      const trimmed = collapseSpaces(current);
      if (trimmed.length > 0) {
        pushUnique(tokens, trimmed);
      }
      current = "";
    } else {
      current += ch;
    }
  }

  const tail = collapseSpaces(current);
  if (tail.length > 0) {
    pushUnique(tokens, tail);
  }

  return tokens;
}

function extractLeadingAuthors(input: string): {
  readonly text: string;
  readonly authors: string[];
} {
  let remaining = input;
  const authors: string[] = [];

  while (true) {
    const match = LEADING_AUTHOR_BRACKET_PATTERN.exec(remaining);
    if (match === null) {
      break;
    }
    const inner = collapseSpaces((match[1] ?? match[2] ?? match[3])!);
    const rest = match[4]!.trim();
    if (
      rest.length === 0 ||
      VOLUME_BLOCK_PATTERN.test(inner.normalize("NFKC"))
    ) {
      break;
    }
    for (const author of splitAuthorTokens(inner)) {
      pushUnique(authors, author);
    }
    remaining = rest;
  }

  return { text: remaining, authors };
}

function buildAnalysisText(source: string): AnalysisText {
  let normalized = "";
  const indexMap: number[] = [];
  let sourceOffset = 0;

  for (const ch of source) {
    const nfkc = ch.normalize("NFKC");
    for (let i = 0; i < nfkc.length; i += 1) {
      indexMap.push(sourceOffset);
    }
    normalized += nfkc;
    sourceOffset += ch.length;
  }
  indexMap.push(source.length);

  return { normalized, indexMap };
}

function removeAnalysisMatch(
  source: string,
  analysis: AnalysisText,
  match: RegExpExecArray,
): string {
  const origStart = analysis.indexMap[match.index]!;
  const origEnd = analysis.indexMap[match.index + match[0].length]!;
  const before = source.slice(0, origStart);
  const after = source.slice(origEnd);
  return cleanRemainingTitle(`${before} ${after}`);
}

function buildOneshotResult(
  text: string,
  editionNote: string | null,
): ExtractedVolume {
  return {
    title: cleanRemainingTitle(text),
    volumeNumber: null,
    volumeRangeEnd: null,
    isOmnibus: false,
    volumeLabel: appendEditionNote("単巻", editionNote),
  };
}

function buildOmnibusRangeResult(
  text: string,
  analysis: AnalysisText,
  match: RegExpExecArray,
  start: number,
  end: number,
  editionNote: string | null,
): ExtractedVolume {
  return {
    title: removeAnalysisMatch(text, analysis, match),
    volumeNumber: start,
    volumeRangeEnd: end,
    isOmnibus: true,
    volumeLabel: appendEditionNote(
      `第${formatVolumeNumber(start)}-${formatVolumeNumber(end)}巻 合本`,
      editionNote,
    ),
  };
}

function buildSingleVolumeResult(
  text: string,
  analysis: AnalysisText,
  match: RegExpExecArray,
  volumeNumber: number,
  editionNote: string | null,
): ExtractedVolume {
  return {
    title: removeAnalysisMatch(text, analysis, match),
    volumeNumber,
    volumeRangeEnd: null,
    isOmnibus: false,
    volumeLabel: appendEditionNote(
      `第${formatVolumeNumber(volumeNumber)}巻`,
      editionNote,
    ),
  };
}

function buildPartVolumeResult(
  text: string,
  analysis: AnalysisText,
  match: RegExpExecArray,
  editionNote: string | null,
): ExtractedVolume {
  const info = PART_VOLUME_MAP[match[1]!]!;
  return {
    title: removeAnalysisMatch(text, analysis, match),
    volumeNumber: info.number,
    volumeRangeEnd: null,
    isOmnibus: false,
    volumeLabel: appendEditionNote(info.label, editionNote),
  };
}

function extractVolume(
  text: string,
  editionNote: string | null,
): ExtractedVolume {
  const analysis = buildAnalysisText(text);
  const normalized = analysis.normalized;

  // 優先順位 1: 合本・範囲巻
  for (const pattern of RANGE_PATTERNS) {
    const match = pattern.exec(normalized);
    if (match !== null) {
      const start = Number(match[1]!);
      const end = Number(match[2]!);
      if (start > 0 && end > start) {
        return buildOmnibusRangeResult(
          text,
          analysis,
          match,
          start,
          end,
          editionNote,
        );
      }
      return buildOneshotResult(text, editionNote);
    }
  }

  const allVolumesMatch = ALL_VOLUMES_PATTERN.exec(normalized);
  if (allVolumesMatch !== null) {
    const total = Number(allVolumesMatch[1]!);
    if (total >= 2) {
      return buildOmnibusRangeResult(
        text,
        analysis,
        allVolumesMatch,
        1,
        total,
        editionNote,
      );
    }
    return buildOneshotResult(text, editionNote);
  }

  // 優先順位 2: 数値なし合本
  const omnibusMatch = OMNIBUS_WITHOUT_NUMBER_PATTERN.exec(normalized);
  if (omnibusMatch !== null) {
    return {
      title: removeAnalysisMatch(text, analysis, omnibusMatch),
      volumeNumber: null,
      volumeRangeEnd: null,
      isOmnibus: true,
      volumeLabel: appendEditionNote("全巻合本", editionNote),
    };
  }

  // 優先順位 3: 明示単巻・小数巻
  for (const pattern of EXPLICIT_VOLUME_PATTERNS) {
    const match = pattern.exec(normalized);
    if (match !== null) {
      return buildSingleVolumeResult(
        text,
        analysis,
        match,
        Number(match[1]!),
        editionNote,
      );
    }
  }

  const trailingParenMatch = TRAILING_PAREN_VOLUME_PATTERN.exec(normalized);
  if (trailingParenMatch !== null) {
    const volumeNumber = Number(trailingParenMatch[1]!);
    if (volumeNumber < 1000) {
      return buildSingleVolumeResult(
        text,
        analysis,
        trailingParenMatch,
        volumeNumber,
        editionNote,
      );
    }
  }

  // 優先順位 4: 上下巻・前後編
  const partMatch =
    NAMED_PART_PATTERN.exec(normalized) ??
    TRAILING_SHORT_PART_PATTERN.exec(normalized);
  if (partMatch !== null) {
    return buildPartVolumeResult(text, analysis, partMatch, editionNote);
  }

  // 優先順位 5: 末尾数値フォールバック
  const trailingNumberMatch = TRAILING_NUMBER_PATTERN.exec(normalized);
  if (trailingNumberMatch !== null) {
    const volumeNumber = Number(trailingNumberMatch[1]!);
    if (volumeNumber > 0 && volumeNumber < 1000) {
      return buildSingleVolumeResult(
        text,
        analysis,
        trailingNumberMatch,
        volumeNumber,
        editionNote,
      );
    }
  }

  // 優先順位 6: 巻数なし単発本
  return buildOneshotResult(text, editionNote);
}

export function parseMangaFilename(
  input: ParseMangaFilenameInput,
): ParsedMangaFilename {
  // Step 1: 拡張子除去と前処理
  const rawBaseName = input.fileName
    .trim()
    .replace(ARCHIVE_EXTENSION_PATTERN, "")
    .trim();

  // Step 2: ノイズタグ除去と版付記抽出
  const stripped = stripNoiseAndEditionNotes(rawBaseName);

  // Step 3: 先頭著者タグ抽出
  const authorExtracted = extractLeadingAuthors(stripped.text);
  let authors = authorExtracted.authors;

  // Step 4: 巻数・合本・上下巻解析
  const volumeExtracted = extractVolume(
    authorExtracted.text,
    stripped.editionNote,
  );
  let title = volumeExtracted.title;

  // Step 5: 親サブフォルダ名フォールバック ＆ 安全フォールバック
  const parentFolderName = input.parentFolderName?.trim() ?? "";
  if (input.isParentSyncRoot !== true && parentFolderName.length > 0) {
    const parentStripped = stripNoiseAndEditionNotes(parentFolderName);
    const parentAuthorExtracted = extractLeadingAuthors(parentStripped.text);
    const parentTitle = cleanRemainingTitle(parentAuthorExtracted.text);

    if (title.length === 0 && parentTitle.length > 0) {
      title = parentTitle;
    }
    if (authors.length === 0 && parentAuthorExtracted.authors.length > 0) {
      authors = parentAuthorExtracted.authors;
    }
  }

  if (title.length === 0) {
    title = rawBaseName.length > 0 ? rawBaseName : "無題";
  }

  return {
    title,
    normalizedTitleKey: normalizeSeriesTitleKey(title),
    titleReading: generateInitialTitleReading(title),
    authors,
    volumeNumber: volumeExtracted.volumeNumber,
    volumeLabel: volumeExtracted.volumeLabel,
    isOmnibus: volumeExtracted.isOmnibus,
    volumeRangeEnd: volumeExtracted.volumeRangeEnd,
    editionNote: stripped.editionNote,
  };
}
