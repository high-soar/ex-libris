---
type: spec-provider
title: "自炊ファイル名スマートパーサー仕様書（src/providers/filename/）"
description: "日本の自炊マンガ・商業誌・同人誌 ZIP/CBZ ファイル名およびサブフォルダ名から作品タイトル・正規化名寄せキー・読み仮名初期値・著者・単巻/小数/合本/上下巻の巻数情報を決定論的に抽出する純粋 TypeScript パーサー仕様の正本"
status: "Review (#25)"
updated: "2026-11-25"
tags:
  [
    provider,
    filename-parser,
    normalization,
    series-grouping,
    volume-number,
    v0.2,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/features/bookshelf.md
  - docs/specs/features/series-detail.md
  - docs/specs/providers/google-drive.md
  - docs/guidelines/testing.md
related_tests:
  - src/providers/filename/textNormalization.test.ts
  - src/providers/filename/mangaFilenameParser.test.ts
  - test/it/drive-sync.spec.ts
---

# 自炊ファイル名スマートパーサー仕様書（`src/providers/filename/`）

本ドキュメントは、Google Drive 上の `.zip` / `.cbz` ファイル名（および必要時の親サブフォルダ名）から、仮想本棚の `series` / `volumes` 登録に必要なタイトル・正規化名寄せキー・読み仮名初期値（`titleReading`）・著者配列・巻数（`volumeNumber`）・巻表示ラベル（`volumeLabel`）を決定論的に抽出する純粋 TypeScript パーサーの正本（Single Source of Truth）です。

---

## 1. モジュール構成と設計原則

| モジュールパス                                  |      レイヤー      | 責務                                                                                                                  |
| :---------------------------------------------- | :----------------: | :-------------------------------------------------------------------------------------------------------------------- |
| `src/providers/filename/types.ts`               | Layer 1 (Provider) | `ParseMangaFilenameInput`, `ParsedMangaFilename` 等の純粋型定義                                                       |
| `src/providers/filename/textNormalization.ts`   | Layer 1 (Provider) | `normalizeSeriesTitleKey`（NFKC・空白・小文字正規化）、`generateInitialTitleReading`（カタカナ→ひらがな初期読み生成） |
| `src/providers/filename/mangaFilenameParser.ts` | Layer 1 (Provider) | `parseMangaFilename`（拡張子除去・ノイズ除去・著者抽出・巻数/合本/上下巻解析・親フォルダ補完）                        |

- **完全純粋関数・ゼロ外部依存**: React / DOM / Dexie / ネットワークに一切依存しない純粋 TypeScript とし、同一入力に対して常に同一結果を返す。
- **空タイトル禁止不変条件**: いかなる入力文字列であっても、`title`・`normalizedTitleKey`・`titleReading`・`volumeLabel` は必ず非空文字列となるよう安全フォールバックを保証する。

---

## 2. 型契約（`src/providers/filename/types.ts`）

```ts
export interface ParseMangaFilenameInput {
  /** Google Drive 上の生ファイル名（例: "[作者名] 作品名 第01巻 (一般コミック).cbz"） */
  readonly fileName: string;
  /** 直近の親フォルダ名（サブフォルダ配下時のみ補完候補として渡す） */
  readonly parentFolderName?: string | null;
  /**
   * 親フォルダが driveSyncRoots 登録ルートフォルダ自体であるか。
   * true の場合はルートフォルダ名（例: "Comics"）への誤集約を防ぐため親フォルダ名補完を行わない。
   */
  readonly isParentSyncRoot?: boolean;
}

export interface ParsedMangaFilename {
  /** 表示用シリーズタイトル（ノイズ・著者タグ・巻数除去後、非空保証） */
  readonly title: string;
  /** シリーズ自動グルーピング用の正規化名寄せキー（非空保証） */
  readonly normalizedTitleKey: string;
  /** v0.2 五十音ソート・検索用の読み仮名初期値（ひらがな統一、非空保証） */
  readonly titleReading: string;
  /** 抽出された著者名配列（トリム・重複排除済み、未検出時は空配列） */
  readonly authors: readonly string[];
  /** ソート・欠巻判定用の巻数数値（単巻/小数/合本開始巻/上下前後編、未検出時は null） */
  readonly volumeNumber: number | null;
  /** 表示用巻ラベル（例: "第01巻", "第03巻 限定版", "第01-05巻 合本", "上巻", "単巻"） */
  readonly volumeLabel: string;
  /** 合本（複数巻まとめ）判定フラグ */
  readonly isOmnibus: boolean;
  /** 合本範囲の終了巻数（例: 01-05巻 -> 5、単巻・数値なし合本は null） */
  readonly volumeRangeEnd: number | null;
  /** 限定版・特装版・新装版等の付記（未検出時は null） */
  readonly editionNote: string | null;
}
```

---

## 3. 正規化・読み仮名初期値生成ルール（`textNormalization.ts`）

### 3.1 `normalizeSeriesTitleKey(title: string): string`（シリーズ自動名寄せキー）

1. `title.normalize("NFKC")` で全角英数・記号・半角カタカナを統一する。
2. 波ダッシュ・チルダ系（`〜` U+301C, `～` U+FF5E）を `~` に、ハイフン/ダッシュ揺れ（`‐`, `‑`, `‒`, `–`, `—`, `―`, `−`）を `-` に統一する（日本語の長音符 `ー` は単語構成文字のため変換しない）。
3. 連続する空白文字（全角スペース含む）を半角スペース 1 文字へ圧縮して前後トリムし、ASCII 英字を `.toLowerCase()` で小文字化する。
4. 同一シリーズの名寄せは **正規化タイトル単独キー（`normalizedTitleKey`）** で判定する。これにより、巻によって著者表記が揺れたり省略されていたりしても、また単巻と合本が混在していても、自然に同一 `series` へ束ねられる。

### 3.2 `generateInitialTitleReading(title: string): string`（`v0.2` 読み仮名初期値）

1. `title.normalize("NFKC")` を適用する。
2. カタカナ（Unicode `U+30A1` `ァ` 〜 `U+30F6` `ヶ`）を対応するひらがな（コードポイント `- 0x60`）へ変換する。
3. ASCII 英字を小文字化し、連続空白を単一スペースへ圧縮して前後トリムする。
4. 漢字の精密な読み仮名は `v0.3` の NDL サーチ公開書誌 API 連携時に補完する。

---

## 4. 解析パイプライン仕様（`parseMangaFilename`）

入力 `fileName` に対し、以下の順序で決定論的に解析を行う。

### Step 1: 拡張子除去と前処理

- 末尾の `.zip` / `.cbz`（大小文字非区別、前後空白トリム後）を除去する。
- Unicode `NFKC` による解析用テキストの正規化（ただし表示用タイトルでは不要な記号破壊を避け、連続空白整理と前後トリムを適用する）。

### Step 2: ノイズタグ・属性括弧の除去と版付記（`editionNote`）の抽出

- 先頭・末尾・途中に現れる自炊分類タグ・フォーマットタグを除去する：
  - 例: `(一般コミック)`, `(成年コミック)`, `(同人誌)`, `(商業誌)`, `(雑誌)`, `(青年コミック)`, `(少年コミック)`, `(少女コミック)`, `[一般コミック]`, `[DL版]`, `[デジタル版]`, `[単行本]`, `[完結]`, `[RAW]`, `(RAW)`, `(JPG)`, `(PNG)`, `(WebP)`, `(AVIF)`, `(JP)`, `(日本語)` など。
- 以下の版付記語句を検出した場合は `editionNote` として保持し、タイトル本体から除去する（複数ある場合は空白結合または先頭優先で決定論的に保持）：
  - `特装版`, `限定版`, `初回限定版`, `特別版`, `完全版`, `新装版`, `愛蔵版`, `ワイド版`, `カラー版`, `フルカラー版`, `電子限定版`, `小冊子付き` 等（括弧内・末尾独立トークン双方に対応）。

### Step 3: 著者タグの抽出

- ノイズタグ除去後の **先頭側** にある `[著者名]` / `【著者名】` / `［著者名］` ブロックを著者候補として抽出し、本体文字列から除去する（例: `(一般コミック) [著者A×著者B] 作品名 第01巻.cbz` → 著者候補 `著者A×著者B`）。
- 著者ブロック内に `サークル名 (著者名)` や `著者名 (別名)` のような括弧注記がある場合、不要な空括弧を除去して著者名を整形する。
- 複数著者の区切り文字（`×`, `・`, `&`, `＆`, `,`, `、`, `/`）で分割し、各要素をトリム・空要素除外・出現順維持の重複排除を行って `authors` 配列とする。
- 先頭以外の位置にある括弧や、巻数・ノイズタグと判定されるブロックは著者と誤認しない。

### Step 4: 巻数・合本・上下巻の解析（優先順位順）

残った本体文字列に対し、以下の優先順位で最初に一致したルールを適用し、巻数部分を除去した残りを `title` 候補とする。

| 優先順位 | カテゴリ                   | 対応パターン例                                                                                                          |                      `volumeNumber`                       |  `volumeRangeEnd`   | `isOmnibus` | `volumeLabel` 例                                                                                                           |
| :------: | :------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------: | :-----------------: | :---------: | :------------------------------------------------------------------------------------------------------------------------- |
|  **1**   | **合本・範囲巻**           | `第01-05巻`, `01-05巻 合本`, `第1〜3巻`, `v01-05`, `01~05 合本`, `第1巻-第5巻`, `全5巻`                                 |                    開始巻数（例: `1`）                    | 終了巻数（例: `5`） |   `true`    | `"第01-05巻 合本"`（`editionNote` 付与可）                                                                                 |
|  **2**   | **数値なし合本**           | `全巻合本`, `合本`, `合本版`, `全巻セット`                                                                              |                          `null`                           |       `null`        |   `true`    | `"全巻合本"`                                                                                                               |
|  **3**   | **明示単巻・小数巻**       | `第0巻`, `第01巻`, `第10.5巻`, `3巻`, `10.5巻`, `Vol.01`, `vol 2`, `v03`, `#04`, `No.5`, `その1`, 末尾 `(1)` / `（02）` |    抽出数値（`0` 以上の有限数、例: `0`, `1`, `10.5`）     |       `null`        |   `false`   | 整数 0〜9 は 2 桁ゼロ埋め `"第00巻"` / `"第01巻"`、10 以上は `"第10巻"`、小数は `"第10.5巻"`（付記時は `"第03巻 限定版"`） |
|  **4**   | **上下巻・前後編**         | `上巻`/`中巻`/`下巻`, 末尾独立トークン `上`/`中`/`下`, `前編`/`中編`/`後編`                                             |     `上`/`前編`=`1`, `中`/`中編`=`2`, `下`/`後編`=`3`     |       `null`        |   `false`   | `"上巻"`, `"中巻"`, `"下巻"`, `"前編"`, `"中編"`, `"後編"`                                                                 |
|  **5**   | **末尾数値フォールバック** | `タイトル 01`, `タイトル_02`, `タイトル 10.5`, ファイル名全体が `01`〜`999` のみ                                        | 抽出数値（`0 < n < 1000`、西暦 4 桁 `1900..2099` は除外） |       `null`        |   `false`   | `"第01巻"` / `"第10.5巻"`                                                                                                  |
|  **6**   | **巻数なし単発本**         | `タイトル.zip`                                                                                                          |                          `null`                           |       `null`        |   `false`   | `"単巻"`（付記時は `"単巻 限定版"`）                                                                                       |

- **合本範囲の妥当性ガード**: 範囲抽出で `start <= 0 || end <= start`（0 以下開始、`end === start` の同値、または `end < start` の逆転範囲）となる不正範囲（例: `99-01`, `01-01`, `00-05`）は合本として誤認識せず通常処理へフォールバックする。`全N巻`（`N >= 2`）は `start = 1, end = N, isOmnibus = true` として扱う。
- **0 巻（前日譚）の扱い**: 明示的な巻表記（`第0巻`, `0巻`, `Vol.0` 等）は `volumeNumber = 0`, `volumeLabel = "第00巻"` として許容する（末尾数値単独の `0` はタイトル誤認防止のため末尾数値フォールバック対象外 `0 < n < 1000` とする）。
- **西暦・4 桁数値の誤認防止**: タイトル末尾の `(2024)` や `2024`（`1900 <= n <= 2099`）は巻数とみなさずタイトルまたはノイズとして扱う。

### Step 5: 親サブフォルダ名フォールバック ＆ 安全フォールバック

1. `isParentSyncRoot !== true` かつ `parentFolderName` が非空文字列の場合：
   - ファイル名解析後の `title` が空（例: `01.cbz`, `第02巻.zip`, `01-05巻.zip`）であれば、`parentFolderName` に対してノイズ除去・著者抽出を適用して `title` および不足時の `authors` を補完する。
   - ファイル名に `title` はあるが `authors` が空の場合も、`parentFolderName` に先頭著者タグ（例: `[作者名] 作品名`）があれば `authors` のみ補完する。
2. `isParentSyncRoot === true` の場合（`driveSyncRoots` 直下に置かれたファイル）は、ルートフォルダ名（例: `"Comics"`）への誤集約を防ぐため **親フォルダ名補完を一切行わない**。
3. 上記を経ても `title` が空文字列になる場合（例: ルート直下の `01.zip` や `.zip`）は、拡張子除去後のトリム済み生ファイル名（それも空なら `"無題"`）を `title` として採用し、非空不変条件を満たす。

---

## 5. 受け入れ条件（`AC-FP-xx`）

|   AC ID    | 受け入れ条件                                                                                                                                                                                                                                                                              |
| :--------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-FP-01` | `[作者名] 作品名 第01巻 (一般コミック).cbz` や `(一般コミック) [著者A×著者B] 作品名 02 [DL版].zip` 等の典型的自炊命名から、ノイズを除去した `title`・`authors`・`volumeNumber`・`volumeLabel` を正確に抽出できる。                                                                        |
| `AC-FP-02` | 小数巻（`第10.5巻`）、版付記（`第3巻 限定版`）、合本範囲（`01-05巻 合本` → `volumeNumber: 1, volumeRangeEnd: 5, isOmnibus: true`）、数値なし合本（`全巻合本`）、上下巻・前後編（`1/2/3` 割当）、巻数なし単発本（`volumeNumber: null, volumeLabel: "単巻"`）をすべて決定論的に解析できる。 |
| `AC-FP-03` | 単巻（例: `作品名 第01巻.cbz`）と合本（例: `(一般コミック) 作品名 01-05巻 合本.zip`）や全角・半角・著者有無が揺れたファイル群から同一の `normalizedTitleKey` を生成し、1 つの `series` へ束ねられる。                                                                                     |
| `AC-FP-04` | `01.cbz` / `第02巻.zip` のようにタイトルが空となるファイル名は、`isParentSyncRoot !== true` のサブフォルダ配下時のみ `parentFolderName` からタイトル・著者を補完し、`isParentSyncRoot === true` のルート直下ではルートフォルダ名へ誤集約しない。                                          |
| `AC-FP-05` | 西暦 4 桁（`2024`）・不正範囲（`10-05`）・空文字に近いファイル名（`.zip`）などの境界入力でも例外を送出せず、非空の `title`・`normalizedTitleKey`・`titleReading`・`volumeLabel` を返す。                                                                                                  |
| `AC-FP-06` | `src/providers/filename/` の全純粋 TypeScript モジュール（`types.ts` 除く）が実通信ゼロの単体テストで C0/C1/Functions/Lines 100% を PASS する。                                                                                                                                           |
