import {
  generateInitialTitleReading,
  normalizeSeriesTitleKey,
} from "./textNormalization";
import type { ParseMangaFilenameInput, ParsedMangaFilename } from "./types";

const ARCHIVE_EXTENSION_PATTERN = /\.(?:zip|cbz)$/i;
const WHITESPACE_RUN_PATTERN = /\s+/g;
const BRACKET_TOKEN_PATTERN =
  /(?:\(([^()]*)\)|（([^（）]*)）|\[([^[\]]*)\]|［([^［］]*)］|【([^【】]*)】)/g;

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
  /^(?:第?\s*\d+(?:\.\d+)?\s*巻|第?\s*\d+\s*巻?\s*[-~〜～‐‑‒–—―−]\s*第?\s*\d+\s*巻|全\s*\d+\s*巻|全巻合本|全巻セット|合本版?|vol\.?\s*\d+|v\s*\d+)$/i;

const AUTHOR_SEPARATOR_SET = new Set(["×", "・", "&", "＆", ",", "、", "/"]);

const RANGE_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s_])?(?:第\s*)?([0-9０-９]+)\s*巻?\s*[-~〜～‐‑‒–—―−]\s*(?:第\s*)?([0-9０-９]+)\s*巻(?:\s*(?:合本版?|セット))?/u,
  /(?:^|[\s_])(?:vol\.?|v)\s*([0-9０-９]+)\s*[-~〜～‐‑‒–—―−]\s*(?:vol\.?|v)?\s*([0-9０-９]+)(?:\s*(?:合本版?|セット))?/iu,
  /(?:^|[\s_])([0-9０-９]+)\s*[-~〜～‐‑‒–—―−]\s*([0-9０-９]+)\s*(?:合本版?|セット)/u,
];

const ALL_VOLUMES_PATTERN =
  /(?:^|[\s_])?全\s*([0-9０-９]+)\s*巻(?:\s*(?:合本版?|セット))?/u;

const OMNIBUS_WITHOUT_NUMBER_PATTERN =
  /(?:^|[\s_])?(?:[[［【(（]\s*)?(?:全巻合本|全巻セット|合本版?)(?:\s*[\]］】)）])?(?=$|[\s_])/u;

const EXPLICIT_VOLUME_PATTERNS: readonly RegExp[] = [
  /(?:\[|［|【)?第\s*([0-9０-９]+(?:\.[0-9０-９]+)?)\s*巻(?:\]|］|】)?/u,
  /(?<![0-9０-９-~〜～‐‑‒–—―−全])([0-9０-９]+(?:\.[0-9０-９]+)?)\s*巻/u,
  /(?:^|[\s_])(?:vol\.?|v|no\.?|#|その)\s*([0-9０-９]+(?:\.[0-9０-９]+)?)(?=$|[\s_])/iu,
];

const TRAILING_PAREN_VOLUME_PATTERN =
  /(?:^|[\s_])[（(]\s*([0-9０-９]+(?:\.[0-9０-９]+)?)\s*[）)]$/u;

const NAMED_PART_PATTERN =
  /(?:^|[\s_])?(上巻|中巻|下巻|前編|中編|後編)(?=$|[\s_])/u;

const TRAILING_SHORT_PART_PATTERN = /(?:^|[\s_])([上中下])$/u;

const TRAILING_NUMBER_PATTERN = /(?:^|[\s_])([0-9０-９]+(?:\.[0-9０-９]+)?)$/u;

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

function collapseSpaces(value: string): string {
  return value.replace(WHITESPACE_RUN_PATTERN, " ").trim();
}

function cleanRemainingTitle(raw: string): string {
  return collapseSpaces(raw.replace(/[\s_]+$/, "").replace(/\s+[-–—]\s*$/, ""));
}

function parseNumericToken(token: string): number {
  return Number(token.normalize("NFKC"));
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
    (
      fullMatch,
      p1?: string,
      p2?: string,
      p3?: string,
      p4?: string,
      p5?: string,
    ) => {
      const inner = collapseSpaces(
        (p1 ?? p2 ?? p3 ?? p4 ?? p5 ?? "").normalize("NFKC"),
      );
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
    const inner = collapseSpaces(match[1] ?? match[2] ?? match[3] ?? "");
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

function removeMatch(source: string, match: RegExpExecArray): string {
  const before = source.slice(0, match.index);
  const after = source.slice(match.index + match[0].length);
  return cleanRemainingTitle(`${before} ${after}`);
}

function extractVolume(
  text: string,
  editionNote: string | null,
): ExtractedVolume {
  // 優先順位 1: 合本・範囲巻
  for (const pattern of RANGE_PATTERNS) {
    const match = pattern.exec(text);
    if (match !== null) {
      const start = parseNumericToken(match[1]!);
      const end = parseNumericToken(match[2]!);
      if (start > 0 && end > start) {
        return {
          title: removeMatch(text, match),
          volumeNumber: start,
          volumeRangeEnd: end,
          isOmnibus: true,
          volumeLabel: appendEditionNote(
            `第${formatVolumeNumber(start)}-${formatVolumeNumber(end)}巻 合本`,
            editionNote,
          ),
        };
      }
    }
  }

  const allVolumesMatch = ALL_VOLUMES_PATTERN.exec(text);
  if (allVolumesMatch !== null) {
    const total = parseNumericToken(allVolumesMatch[1]!);
    if (total >= 2) {
      return {
        title: removeMatch(text, allVolumesMatch),
        volumeNumber: 1,
        volumeRangeEnd: total,
        isOmnibus: true,
        volumeLabel: appendEditionNote(
          `第01-${formatVolumeNumber(total)}巻 合本`,
          editionNote,
        ),
      };
    }
  }

  // 優先順位 2: 数値なし合本
  const omnibusMatch = OMNIBUS_WITHOUT_NUMBER_PATTERN.exec(text);
  if (omnibusMatch !== null) {
    return {
      title: removeMatch(text, omnibusMatch),
      volumeNumber: null,
      volumeRangeEnd: null,
      isOmnibus: true,
      volumeLabel: appendEditionNote("全巻合本", editionNote),
    };
  }

  // 優先順位 3: 明示単巻・小数巻
  for (const pattern of EXPLICIT_VOLUME_PATTERNS) {
    const match = pattern.exec(text);
    if (match !== null) {
      const volumeNumber = parseNumericToken(match[1]!);
      return {
        title: removeMatch(text, match),
        volumeNumber,
        volumeRangeEnd: null,
        isOmnibus: false,
        volumeLabel: appendEditionNote(
          `第${formatVolumeNumber(volumeNumber)}巻`,
          editionNote,
        ),
      };
    }
  }

  const trailingParenMatch = TRAILING_PAREN_VOLUME_PATTERN.exec(text);
  if (trailingParenMatch !== null) {
    const volumeNumber = parseNumericToken(trailingParenMatch[1]!);
    if (volumeNumber < 1000) {
      return {
        title: removeMatch(text, trailingParenMatch),
        volumeNumber,
        volumeRangeEnd: null,
        isOmnibus: false,
        volumeLabel: appendEditionNote(
          `第${formatVolumeNumber(volumeNumber)}巻`,
          editionNote,
        ),
      };
    }
  }

  // 優先順位 4: 上下巻・前後編
  const namedPartMatch = NAMED_PART_PATTERN.exec(text);
  if (namedPartMatch !== null) {
    const info = PART_VOLUME_MAP[namedPartMatch[1]!]!;
    return {
      title: removeMatch(text, namedPartMatch),
      volumeNumber: info.number,
      volumeRangeEnd: null,
      isOmnibus: false,
      volumeLabel: appendEditionNote(info.label, editionNote),
    };
  }

  const shortPartMatch = TRAILING_SHORT_PART_PATTERN.exec(text);
  if (shortPartMatch !== null) {
    const info = PART_VOLUME_MAP[shortPartMatch[1]!]!;
    return {
      title: removeMatch(text, shortPartMatch),
      volumeNumber: info.number,
      volumeRangeEnd: null,
      isOmnibus: false,
      volumeLabel: appendEditionNote(info.label, editionNote),
    };
  }

  // 優先順位 5: 末尾数値フォールバック
  const trailingNumberMatch = TRAILING_NUMBER_PATTERN.exec(text);
  if (trailingNumberMatch !== null) {
    const volumeNumber = parseNumericToken(trailingNumberMatch[1]!);
    if (volumeNumber > 0 && volumeNumber < 1000) {
      return {
        title: removeMatch(text, trailingNumberMatch),
        volumeNumber,
        volumeRangeEnd: null,
        isOmnibus: false,
        volumeLabel: appendEditionNote(
          `第${formatVolumeNumber(volumeNumber)}巻`,
          editionNote,
        ),
      };
    }
  }

  // 優先順位 6: 巻数なし単発本
  return {
    title: cleanRemainingTitle(text),
    volumeNumber: null,
    volumeRangeEnd: null,
    isOmnibus: false,
    volumeLabel: appendEditionNote("単巻", editionNote),
  };
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
