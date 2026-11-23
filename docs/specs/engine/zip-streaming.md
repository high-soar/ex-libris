---
type: spec-engine
title: "ZIPストリーミング・I/O・Worker エンジン仕様書"
description: "LocalFileReader、標準ZIP/ZIP64/CP932パーサー、80MB L2ByteCache LRU、10MB/64KB結合 AdaptivePrefetcher、Coordinator/Decode Worker構成、zipIndexCache 0RTT、HO-03所有権分離、およびrequestEpoch世代キャンセル制御の正本"
status: "Approved"
updated: "2026-11-23"
tags:
  [
    engine,
    zip,
    zip64,
    cp932,
    streaming,
    web-worker,
    comlink,
    cache,
    prefetch,
    lru,
    epoch,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/webgl2-renderer.md
  - docs/specs/features/reader.md
  - docs/guidelines/testing.md
related_tests:
  - src/engine/constants.test.ts
  - src/engine/io/LocalFileReader.test.ts
  - src/engine/zip/errors.test.ts
  - src/engine/zip/zipIndexValidation.test.ts
  - src/engine/zip/zipParser.test.ts
  - src/engine/cache/L2ByteCache.test.ts
  - src/engine/prefetch/AdaptivePrefetcher.test.ts
  - src/engine/workers/DecodeWorkerCore.test.ts
  - src/engine/workers/DecodeWorkerPool.test.ts
  - src/engine/workers/CoordinatorCore.test.ts
  - src/engine/workers/comlinkErrorHandler.test.ts
  - src/engine/workers/coordinatorTransfer.test.ts
  - src/app/coordinatorClient.test.ts
  - src/storage/repositories/zipIndexCacheRepository.test.ts
  - test/it/local-reader.spec.ts
---

# ZIP ストリーミング・I/O・Worker エンジン仕様書

本ドキュメントは、ExLibris の **Layer 1（Streaming & I/O）** および **Layer 2（Engine Worker）** に属するランダムアクセス読込、ZIP 解析・1 RTT スライス切り出し、80MB `L2ByteCache`、10MB 予算・64KB ギャップ結合 `AdaptivePrefetcher`、Coordinator / Decode Worker 連携、ならびに世代キャンセル制御（`requestEpoch`）の正本（Single Source of Truth）です。

---

## 1. モジュール構成と責務分離（4層・純粋テスト規約）

Worker グローバル（`self`）への直接依存を避けて Vitest による C0/C1/Functions/Lines 100% 単体テストを可能にするため、ロジック本体（`*Core.ts` および純関数モジュール）と Worker ブートストラップ（`*.worker.ts`）を厳格に分離します。

| モジュールパス                              | レイヤー | 責務                                                                                                                                                                                                                                                                                                             |
| :------------------------------------------ | :------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/constants.ts`                   | 共通定数 | ストリーミング読込・先読み・L1/L2 キャッシュ・Worker プール数・表紙抽出レートの予算定数（`ENGINE_BUDGETS`）定義                                                                                                                                                                                                  |
| `src/engine/io/LocalFileReader.ts`          | Layer 1  | 端末ローカル `File` を `File.slice` で範囲読込する `RandomAccessReader` 実装（Web / Android WebView 共通）                                                                                                                                                                                                       |
| `src/engine/zip/zipParser.ts`               | Layer 2  | 論理名 `ZipParserCore`（実装関数: `parseZipDirectory`, `readCompressedPageSlice`, `computeEntryFetchSpan`, `extractCompressedSliceFromBuffer`）。EOCD/CDH 解析、画像フィルタ・ゴミ除外、自然順ソート、LFH 可変長ヘッダスキップ＆2 RTT 補完、および 80MB 超ページのヘッダ先行独立抽出                             |
| `src/engine/zip/zipIndexValidation.ts`      | Layer 2  | `zipIndexCache` 復元時および `CoordinatorCore.openArchive` 入口での `ZipPageEntry[]` 構造・境界検証純関数                                                                                                                                                                                                        |
| `src/engine/zip/errors.ts`                  | Layer 2  | 型付きエンジンエラー（`ZipArchiveError` / エラーコード列挙 / `isAbortError`）                                                                                                                                                                                                                                    |
| `src/engine/cache/L2ByteCache.ts`           | Layer 2  | 80MB 上限（`L2_CACHE_MAX_BYTES`）の未デコード圧縮 `Uint8Array` LRU キャッシュ。単一 80MB 超表示ページのピン付き一時保持・表示外即時退避、独立 `Uint8Array` 正規化、および `markSharedBuffer` 自動付与                                                                                                            |
| `src/engine/prefetch/AdaptivePrefetcher.ts` | Layer 2  | 閲覧優先順 10MB 予算選抜（単一 10MB 超〜80MB 以下単独許容・80MB 超除外）＋物理オフセット昇順・ギャップ 64KB 以内・実 Range 長 10MB 以内の結合取得および L2 格納エンジン                                                                                                                                          |
| `src/engine/workers/DecodeWorkerCore.ts`    | Layer 2  | Store (`0`) / Deflate (`8`: `DecompressionStream('deflate-raw')` ＋ `fflate` フォールバック) 伸長 ＋ `createImageBitmap` デコード                                                                                                                                                                                |
| `src/engine/workers/DecodeWorkerPool.ts`    | Layer 2  | `DecodeWorkerApi` を実装し、複数 Decode Worker 間の最小負荷＋ラウンドロビン割り当て、対象 Worker の `error` / `messageerror` 検知時の `broken` 隔離・保留 RPC 即時 `DECODE_FAILED` reject・健全スロット継続、および `dispose()` ライフサイクル制御を行うプール                                                   |
| `src/engine/workers/CoordinatorCore.ts`     | Layer 2  | `CoordinatorWorkerApi` 実装。アーカイブオープン、L2 0RTT ヒット、Fast-Path 最優先実行、ページ単位 In-Flight 共有、10MB Warm Prefetch 非同期起動、`requestEpoch` 世代キャンセル                                                                                                                                   |
| `src/engine/workers/comlinkErrorHandler.ts` | Layer 2  | Worker 側・UI クライアント側双方の Comlink `throw` ハンドラを拡張し、`ZipArchiveError.code` および `DOMException`（`AbortError` 等）を RPC 越しに保持・復元する純関数シリアライザ                                                                                                                                |
| `src/engine/workers/coordinatorTransfer.ts` | Layer 2  | `WeakSet<ArrayBuffer>` 共有バッファ保護（`markSharedBuffer` / `isSharedBuffer` / `HO-03` 対応）を含む Decode Worker 送信ペイロード構築（`prepareDecodeTransfer`）、`ready` フレームの `ImageBitmap` 抽出（`collectFrameTransferables`）、および転送ラッパー（`transferDecodedFrames`）純関数モジュール           |
| `src/engine/workers/decode.worker.ts`       | Layer 2  | `registerZipArchiveErrorTransferHandler()` 登録、`DecodeWorkerCore` 初期化、`Comlink.transfer` 返却および `Comlink.expose` のみの薄いブートストラップ（数行のみ、条件分岐禁止）                                                                                                                                  |
| `src/engine/workers/coordinator.worker.ts`  | Layer 2  | `registerZipArchiveErrorTransferHandler()` 登録、`DecodeWorker` 毎の `error` / `messageerror` 購読結線（`subscribeError`）・`DecodeWorkerPool`・`CoordinatorCore`・`coordinatorTransfer`（`prepareDecodeTransfer` / `transferDecodedFrames`）の結線（`options` 透過中継含む）と `Comlink.expose`（条件分岐ゼロ） |

---

## 2. `LocalFileReader`（Layer 1）仕様

`architecture.md §2.2` の `RandomAccessReader` 契約を実装します。

1. **プロパティ**:
   - `sourceId`: `"local:${file.name}:${file.size}"`
   - `totalSize`: `file.size`
2. **`readRange(offset, length, signal?)` 契約**:
   - `signal?.aborted === true` の場合、即座に `DOMException("Aborted", "AbortError")` を送出する。
   - `offset < 0` または `length < 0` または整数でない場合は `ZipArchiveError("READ_ERROR")` を送出する。
   - `length === 0` または `offset >= totalSize` の場合は空の `Uint8Array(0)` を返す。
   - `end = Math.min(offset + length, totalSize)` にクランプし、`file.slice(offset, end).arrayBuffer()` を読み込む。
   - 読込完了後にも `signal?.aborted === true` を再確認し、キャンセル済みなら結果を返さず `AbortError` を送出する。

---

## 3. 標準 ZIP パーサー（`src/engine/zip/`）仕様

### 3.1 エラー種別（`ZipErrorCode`）

破損や非対応アーカイブを推測で握り潰さず、以下の明示的コードを持つ `ZipArchiveError` を送出します。

| エラーコード              | 発生条件                                                                                                           |
| :------------------------ | :----------------------------------------------------------------------------------------------------------------- |
| `CORRUPT_ZIP`             | EOCD シグネチャ（`0x06054b50`）不在、CD/LFH/ZIP64 構造不整合、マルチディスク ZIP、オフセット境界超過、安全整数超過 |
| `EMPTY_ARCHIVE`           | ゴミ除外・拡張子フィルタ後の有効画像ページが 0 件                                                                  |
| `ENCRYPTED_ZIP`           | CDH の General Purpose Bit Flag Bit 0（暗号化フラグ `0x0001`）が立っている                                         |
| `UNSUPPORTED_COMPRESSION` | 画像エントリの圧縮方式が `0`（Store）および `8`（Deflate）以外（例: Deflate64 等）                                 |
| `DECODE_FAILED`           | `DecompressionStream` / `fflate` 伸長失敗または `createImageBitmap` デコード失敗                                   |
| `READ_ERROR`              | `RandomAccessReader.readRange` の不正引数または I/O 失敗                                                           |

### 3.2 EOCD ＋ Central Directory 読込手順

1. 末尾 `tailLength = Math.min(totalSize, ENGINE_BUDGETS.INITIAL_TAIL_READ_BYTES)`（`131_072` バイト）を `readRange(totalSize - tailLength, tailLength)` で 1 RTT 取得する。
2. 末尾バッファを後方走査して EOCD シグネチャ `0x06054b50`（最小 22 バイト、ZIP コメント長 `commentLength` と末尾長の一致を確認）を特定する。
   - 見つからない場合は `CORRUPT_ZIP`。
   - 先に `hasLocator = eocdRelOffset >= 20 && readUint32LE(tailView, eocdRelOffset - 20) === 0x07064b50` で ZIP64 EOCD Locator の有無を判定する：
     - **Locator 不在時**: 標準 EOCD のマルチディスク値（`diskNumber !== 0 || cdDiskNumber !== 0 || diskEntries !== totalEntries`）または `0xFFFF` / `0xFFFFFFFF` 飽和値（`diskEntries === 0xffff || totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff`）のいずれかが含まれる場合は `CORRUPT_ZIP` を送出する。
     - **Locator 存在時**: Locator の `locatorDiskNumber === 0`・`totalDisks === 1`（不一致は `CORRUPT_ZIP`）、および標準 EOCD の非飽和ディスク番号（`diskNumber !== 0xffff && diskNumber !== 0` 等）を検証した上で 64bit `zip64EocdOffset` を `readSafeUint64`（`> BigInt(Number.MAX_SAFE_INTEGER)` なら `CORRUPT_ZIP`）で読み取る。さらに `zip64EocdOffset + 56 > eocdAbsoluteOffset - 20`（Locator 直前に最小 56 バイトの ZIP64 EOCD Record を収容できない境界違反）は即時 `CORRUPT_ZIP` とする。
     - `zip64EocdOffset >= tailStart` なら `tailBuf` 内から、`zip64EocdOffset < tailStart` なら追加 1 RTT `reader.readRange(zip64EocdOffset, 56, signal)` で ZIP64 EOCD Record（シグネチャ `0x06064b50`, `sizeOfZip64Eocd >= 44`, 単一ディスク `0`, `diskEntries === totalEntries`, `cdOffset + cdSize <= zip64EocdOffset`, 全値安全整数範囲）を解決する。
   - 最後に `totalEntries * 46 > cdSize` の場合は構造不正／OOM 防御として `CORRUPT_ZIP` を送出する。
3. `cdOffset` および `cdSize` が既に取得済みの末尾バッファ内に収まっている場合は追加 I/O ゼロで解析する。
   - 末尾 128KB を超過する巨大な Central Directory の場合は、`readRange(cdOffset, cdSize)` で不足分を追加 1 RTT 取得する。
   - `cdOffset + cdSize > eocdAbsoluteOffset` 等の境界違反は `CORRUPT_ZIP`。

### 3.3 CDH 解析・不要エントリ除外・文字コード・自然順ソート

1. Central Directory Header（シグネチャ `0x02014b50`）を順次走査する。
2. **ファイル名デコード（CP932 / Shift_JIS フォールバック対応）**:
   - GPBF Bit 11（`0x0800`）が立っている場合は `new TextDecoder("utf-8", { fatal: false }).decode(nameBytes)` でデコードする。
   - GPBF Bit 11 が `0` の場合はまず `new TextDecoder("utf-8", { fatal: true }).decode(nameBytes)` を試行し、`TypeError`（不正 UTF-8 バイト列）発生時のみ `new TextDecoder("shift-jis", { fatal: false }).decode(nameBytes)`（CP932）へフォールバックする。
   - LFH の `fileNameLength` スキップ計算および 1 RTT 取得長算出のため、デコード前の生バイト長 `entryNameByteLength` を保持する。
3. **不要エントリ除外・対象画像判定**:
   - 以下のいずれかに該当するエントリは除外する：
     - パス末尾が `/`（ディレクトリエントリ）、または外部属性のディレクトリビットが立っているエントリ
     - `__MACOSX/` で始まるパス、またはパス内の任意セグメントが `__MACOSX` のもの
     - ベースファイル名が `._` で始まる AppleDouble メタファイル
     - ベースファイル名が `.DS_Store`, `Thumbs.db`, `desktop.ini`（大文字小文字非区別）
   - 残ったエントリのうち、拡張子（大文字小文字非区別）が `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif` のもののみを画像ページ候補とする。
4. **暗号化・圧縮方式・ZIP64 チェック（有効画像エントリ対象）**:
   - GPBF Bit 0 (`flags & 0x0001`) が立っている場合は `ENCRYPTED_ZIP`。
   - `compressionMethod !== 0 && compressionMethod !== 8` の場合は `UNSUPPORTED_COMPRESSION`。
   - **ZIP64 Extra Field (`0x0001`) 先行解決 ＆ マルチディスク拒否**: 全 CDH エントリに対し、`physicalOffsets` 収集および `isJunkOrNonImageEntry` 除外の前に `diskStartNumber` チェックおよび `extraField` TLV 走査を実施する（非画像エントリの `localHeaderOffset` も `0xFFFFFFFF` 飽和し得るため）。非飽和・飽和を問わず `diskStartNumber !== 0`（`diskStartNumber !== 0xffff && diskStartNumber !== 0`、または `0x0001` 内 `diskStartNumber !== 0`）はマルチディスク ZIP として `CORRUPT_ZIP` を送出する。`uncompressedSize === 0xFFFFFFFF` / `compressedSize === 0xFFFFFFFF` / `localHeaderOffset === 0xFFFFFFFF` / `diskStartNumber === 0xFFFF` のいずれかが飽和している場合は Header ID `0x0001` ブロックを探索し、飽和項目のみ **PKWARE APPNOTE 順（`uncompressedSize` 8B → `compressedSize` 8B → `localHeaderOffset` 8B → `diskStartNumber` 4B）** で安全整数読み取りする。`0x0001` 不在・長不足・安全整数超過・`diskStartNumber !== 0` はすべて `CORRUPT_ZIP` とする。
5. **物理終了位置（`physicalEnd`）の算出**:
   - ゴミ・非画像除外前の全 CDH エントリから `cdOffset` 未満の物理 `localHeaderOffset` を収集して昇順ソートする。全 CDH エントリの `localHeaderOffset` が `cdOffset` 未満の範囲で同一オフセット重複・逆転がある場合は `ZipArchiveError("CORRUPT_ZIP")` を送出する。
   - 各有効画像エントリの直後に位置する全 CDH エントリの物理配置順に基づく次の物理エントリ先頭（`localHeaderOffset < off < cdOffset` の最小 `off`、存在しない末尾エントリは `cdOffset`）を `physicalEnd` として設定する。
6. **論理ページ順のセグメント単位自然順ソート**:
   - 有効画像エントリが 0 件の場合は `EMPTY_ARCHIVE` を送出する。
   - `entryName.split(/[\\/]/)` でパスセグメント配列へ分割し、先頭セグメントから順に `new Intl.Collator("ja", { numeric: true, sensitivity: "base" }).compare(segA, segB)` で比較（共通接頭辞が同値ならセグメント数が少ない方を先）し、0 始まりの `pageIndex` を付与する。

### 3.4 LFH 可変長 1 RTT スライス切り出しと共通抽出ヘルパ

1. `computeEntryFetchSpan(entry)`:
   - `maxSpan = entry.physicalEnd - entry.localHeaderOffset` に対し、通常サイズエントリ向けの 1 RTT 取得目安長 `Math.min(maxSpan, 30 + entry.entryNameByteLength + entry.compressedSize + ENGINE_BUDGETS.LFH_EXTRA_MARGIN_BYTES)` を返す純関数（`readCompressedPageSlice` の通常サイズ経路および `AdaptivePrefetcher` で共通利用）。
2. `readCompressedPageSlice(reader, entry, signal?)` および `extractCompressedSliceFromBuffer(reader, entry, initialBuf, signal?)`:
   - まず `maxSpan = entry.physicalEnd - entry.localHeaderOffset` を算出し、`entry.localHeaderOffset < 0 || maxSpan < 30` の場合は即座に `ZipArchiveError("CORRUPT_ZIP")` を送出する。
   - **通常サイズページ（`entry.compressedSize <= ENGINE_BUDGETS.L2_CACHE_MAX_BYTES`）の単一ページ取得時**: `fetchLength = computeEntryFetchSpan(entry)` を算出し、`readRange(entry.localHeaderOffset, fetchLength, signal)` を 1 回呼び出して `initialBuf` を得る（結合先読み時は結合バッファ内の該当ページ部分 `subarray` を `initialBuf` として渡す）。
   - **80MB 超ページ（`entry.compressedSize > ENGINE_BUDGETS.L2_CACHE_MAX_BYTES`）の単一ページ取得時**: ペイロード全体を `1KB` マージン付き `initialBuf` として丸ごと確保してから `slice()` 複製する二重メモリ確保を避けるため、1 回目の `readRange` では LFH ヘッダ先頭目安長のみ（`Math.min(maxSpan, 30 + entry.entryNameByteLength + ENGINE_BUDGETS.LFH_EXTRA_MARGIN_BYTES)`）を取得し、`extractCompressedSliceFromBuffer` 経由でケース 2a / ケース 2b により圧縮ペイロード本体のみを独立 `ArrayBuffer`（`byteOffset === 0 && byteLength === entry.compressedSize === buffer.byteLength`）として切り出す。
   - `initialBuf.byteLength < 30` または Local File Header シグネチャ `0x04034b50` 不一致の場合は `CORRUPT_ZIP` を送出する。
   - LFH 側の `fileNameLength`（offset 26）と `extraFieldLength`（offset 28）を読み取って実データ開始相対位置 `dataStart = 30 + lfhFileNameLength + lfhExtraFieldLength` を算出する（CDH と LFH の `extraFieldLength` が異なる ZIP にも対応）。
   - `dataStart + entry.compressedSize > maxSpan` の場合は境界違反として `ZipArchiveError("CORRUPT_ZIP")` を送出する。
   - `dataStart + entry.compressedSize <= initialBuf.byteLength` であれば `initialBuf.subarray(dataStart, dataStart + entry.compressedSize)` を返却する（1 RTT 完了、ゼロコピービュー）。
   - LFH `extraField` が 1KB マージンを超過した通常サイズページ、または 80MB 超ページで `dataStart + entry.compressedSize > initialBuf.byteLength`（かつ `maxSpan` 内に収まる）となった場合は、以下の 2 ケースに分岐して 2 RTT 補完取得を行う：
     - **ケース 2a（`dataStart < initialBuf.byteLength`）**: 未取得の末尾差分 `[entry.localHeaderOffset + initialBuf.byteLength, entry.compressedSize - (initialBuf.byteLength - dataStart)]` のみを `readRange` で追加取得し、`new Uint8Array(entry.compressedSize)` を直接確保して先頭に `initialBuf.subarray(dataStart)`・後続に末尾差分をコピーした `byteOffset === 0` の独立バッファを返却する（不要なヘッダ確保と `prepareDecodeTransfer` での再コピーを排除）。
     - **ケース 2b（`dataStart >= initialBuf.byteLength`：LFH 先頭読込バッファに圧縮本体を一切含まない）**: `readRange(entry.localHeaderOffset + dataStart, entry.compressedSize, signal)` で圧縮本体のみを直接追加取得し、`initialBuf` と結合せずそのまま返却する（`RangeError` と余剰コピーを防止）。

---

## 4. `L2ByteCache`・`AdaptivePrefetcher`・`DecodeWorkerCore`・`CoordinatorCore`（Layer 2）仕様

### 4.1 `L2ByteCache`（80MB 圧縮バイト LRU キャッシュ / `src/engine/cache/L2ByteCache.ts`）

1. **容量予算と状態管理**:
   - 上限 `maxBytes` はデフォルトで `ENGINE_BUDGETS.L2_CACHE_MAX_BYTES`（`83_886_080` = 80MB、任意の正整数注入可、非有限値はデフォルト、1 未満は `1` にクランプ）。
   - 現在開いているアーカイブ内の論理 `pageIndex` をキーとして未デコード圧縮 `Uint8Array` を保持し、`size`（件数）・`totalBytes`（保持合計バイト数）・`has(pageIndex)`・`peek(pageIndex)`・`get(pageIndex)`（ヒット時に MRU 昇格）・`delete(pageIndex)`・`clear()` を提供する。
2. **独立 `Uint8Array` 正規化 ＆ `HO-03` 共有バッファ印付与**:
   - 10MB 結合バッファからの部分 `subarray` をそのまま保持すると 9 ページ退避後も裏側の 10MB `ArrayBuffer` 全体が GC されず Worker RAM を圧迫するため、`put` 時は `byteOffset !== 0 || byteLength !== data.buffer.byteLength || !(data.buffer instanceof ArrayBuffer)` のスライスを必ず `data.slice()` で独立 `Uint8Array` に正規化する。
   - 格納確定した `stored.buffer` には必ず `markSharedBuffer(stored.buffer)` を付与し、`Comlink.transfer` によるデタッチ破壊を防止する。
3. **LRU 退避と単一 80MB 超例外ページの表示中一時保持（`NFR-02`）**:
   - `setPinnedPages(pageIndices)`: 現在表示中のページ集合 `pinnedPages` を更新し、保持中に `entry.byteLength > maxBytes` の 80MB 超例外エントリがあって新 `pinnedPages` から外れた場合は即座に退避して `totalBytes <= maxBytes` へ復帰させる。
   - `put(pageIndex, data, options?: { allowOversized?: boolean })`:
     - 同一 `pageIndex` の既存エントリがある場合は先に削除して `totalBytes` から減算する。
     - **単一 80MB 超（`data.byteLength > maxBytes`）**: `allowOversized === true` かつ `hasOversizedPinnedEntry() === false`（別ページの 80MB 超ピン中エントリが未保持）の場合のみ、既存エントリを全退避して当該 1 件の一時保持を許容する。それ以外（`allowOversized !== true` または別ページの 80MB 超ピン中エントリ保持中）は既存キャッシュを退避せず格納をスキップ（`false` 返却）する。
     - **通常サイズ（`data.byteLength <= maxBytes`）**: 同一 `pageIndex` 既存分削除後に `hasOversizedPinnedEntry() === true`（別ページの 80MB 超ピン中エントリが保持中）の間は、**`allowOversized` の真偽を問わず** 当該ピン中エントリを保護し退避不能ループや追い出し競合を防ぐため格納をスキップ（`false` 返却）する。通常時は `totalBytes + data.byteLength <= maxBytes` になるまで非ピン最古エントリから優先して LRU 退避（全候補がピン中通常ページの場合のみ最古エントリを退避して `maxBytes` を厳守）し、MRU として格納する。
   - `hasOversizedPinnedEntry()` を提供し、80MB 超ページ表示中の不要な Warm Prefetch 起動を抑止する。

### 4.2 `AdaptivePrefetcher`（10MB 予算・64KB ギャップ結合先読み / `src/engine/prefetch/AdaptivePrefetcher.ts`）

1. **2 段階バッチ計画（`planPrefetchBatches`）**:
   - `l2Cache.hasOversizedPinnedEntry() === true` の場合は空配列 `[]` を返す。
   - **Step 1（閲覧優先順 10MB 予算選抜）**:
     - `prefetchIndices` の優先順で非整数・範囲外・重複・除外集合（表示中・`l2Cache.has`・同世代 In-Flight 取得中）・構造不正（`localHeaderOffset < 0 || physicalEnd - localHeaderOffset < 30`）・単一 `compressedSize > l2Cache.maxBytes`（80MB 超）を除外する。
     - 各候補の `span = computeEntryFetchSpan(entry)` を積算し、先頭 1 件目が単独で `span > WARM_PREFETCH_BUDGET_BYTES`（10MB 超〜80MB 以下）の場合はその 1 件のみを選抜して打ち切る。通常時は `accumulatedBytes + span <= WARM_PREFETCH_BUDGET_BYTES`（`10_485_760` = 10MB）を満たす連続候補のみを選抜し、最初の予算超過で打ち切る。
   - **Step 2（物理オフセット昇順ソート ＆ 結合判定）**:
     - 選抜されたエントリ群を `localHeaderOffset` 昇順へ並べ替え、隣接する `prev` と `next` が以下 2 条件を同時に満たす限り単一の `PrefetchBatch`（`{ entries, rangeOffset, rangeLength }`）へ結合する（満たさない境界で次バッチへ分割）：
       1. 物理ギャップ `gap = next.localHeaderOffset - prev.physicalEnd` が `0 <= gap <= ENGINE_BUDGETS.MAX_COALESCE_GAP_BYTES`（`65_536` = 64KB）
       2. ブロック実 Range 長 `(next.localHeaderOffset + computeEntryFetchSpan(next)) - currentBatch.rangeOffset <= ENGINE_BUDGETS.WARM_PREFETCH_BUDGET_BYTES`（`10_485_760` = 10MB）
2. **全バッチ先行 In-Flight 登録・非同期実行と異常系部分救済**:
   - Warm Prefetch 起動直後・**最初の `await` に入る前** に、全計画バッチの対象ページ（`batches.flatMap(b => b.entries)` のうち `l2Cache` 未保持かつ同世代 `inflightPageReads` 未登録分）を一括で In-Flight 待機マップへ先行登録し、複数バッチ分割時に後続バッチ分へ到着する L1 近傍要求も二重 `readRange` なしで合流できるようにする。
   - バッチごとに `signal.aborted` を確認し、バッチ内全ページが既に `l2Cache.has` 済みなら `readRange` をスキップする。未取得分がある場合は `reader.readRange(batch.rangeOffset, batch.rangeLength, signal)` を 1 RTT 実行し、未格納の各エントリ（`!l2Cache.has(entry.pageIndex)`）について `[entry.localHeaderOffset - batch.rangeOffset, Math.min(buf.byteLength, entry.physicalEnd - batch.rangeOffset))` から `extractCompressedSliceFromBuffer` で圧縮スライスを抽出して `l2Cache.put(entry.pageIndex, slice, { allowOversized: false })` に格納する（末尾エントリで LFH `extraField` が 1KB を超えた場合はケース 2a/2b で不足分のみ補完読込する）。
   - 投機的先読みのため、結合バッファ内の一部エントリで LFH 破損（`CORRUPT_ZIP`）が発生しても正常な他エントリの L2 格納は継続し、通信失敗（`READ_ERROR`）や `AbortError` 時も未処理例外を送出せず、未解決の全 In-Flight 待機者に `null` を解決通知して安全に停止する（実表示到達時の Fast-Path で既存のページ単位エラーとして確定させる）。

### 4.3 `DecodeWorkerCore`（2 Worker プール）

1. `decodePageSlice(compressedData, compressionMethod)`:
   - `compressionMethod === 0`（Store）: `compressedData` をそのまま画像 Blob 化。
   - `compressionMethod === 8`（Deflate）: `DecompressionStream("deflate-raw")` が利用可能であれば優先使用し、非対応環境（テスト JSDOM 等）や失敗時の互換フォールバックとして `fflate.inflateSync` を使用する。
   - 伸長済みバイト列から `new Blob([rawBytes])` を生成し、`createImageBitmap(blob)` でオフスレッドデコードを行う（失敗時は `ZipArchiveError("DECODE_FAILED")`）。
   - 返却値 `{ bitmap, width: bitmap.width, height: bitmap.height }`。Worker ラッパー側では `Comlink.transfer(result, [result.bitmap])` で所有権ごと親側へ Zero-Copy 転送する。

### 4.4 `CoordinatorCore`（L2 0RTT ヒット・In-Flight 共有・Warm Prefetch・世代キャンセル）

1. **状態管理**:
   - `activeReader: RandomAccessReader | null`
   - `entries: ZipPageEntry[]`
   - `l2Cache: L2ByteCache`（アーカイブ単位、80MB 上限）
   - `minActiveEpoch: number`
   - `inflightAbortControllers: Map<number, Set<AbortController>>`（epoch 単位の Fast-Path および Warm Prefetch 進行中 I/O 中断管理）
   - `inflightPageReads: Map<number, InflightPageRead>`（`{ epoch, signal, promise, consumerCount }` を保持するページ単位の進行中スライス取得共有マップ。`AbortController.abort()` 発火時に `abort` リスナーで同期的にエントリ削除＆`null` 解決を行い、`LocalFileReader` の旧世代読込完了を待たずに新世代要求を解放する）
2. **`openArchive(source, cachedEntries, epoch)`**:
   - `epoch < minActiveEpoch` の場合は即キャンセルエラー。
   - 既存アーカイブがあれば `closeArchive()` 相当のクリーンアップ（進行中全 I/O 中断・`inflightPageReads` 全クリア・`l2Cache.clear()`）を実施。
   - `source.kind === "local-session"` に対し `LocalFileReader(source.file)` を生成する。`cachedEntries` に非空配列かつ基本構造検証（`validateZipIndexEntries`：必須フィールド型・非負有限数値・`localHeaderOffset < physicalEnd` 等）を通過した配列が渡された場合のみ `parseZipDirectory` をスキップして 0 RTT（`fromIndexCache: true`）で即座に完了し、`null`・空配列・不整合配列の場合は自動的に `parseZipDirectory` へフォールバックする（`fromIndexCache: false`）。
   - UI スレッド（`ReaderPage` + `ZipIndexCacheRepository`）が `source.indexCacheKey`（`local:${rawFileName}:${fileSize}`）で Dexie `zipIndexCache`（最大 500 件 LRU）を参照し、不整合キャッシュ検知時は自動削除して `cachedEntries = null` へ透過フォールバックし、通常オープン成功時に `entries` を非ブロッキング保存する。
   - さらに `fromIndexCache: true` でオープンしたセッションにおいて後続の `requestVisiblePages`（`ReaderPage.fetchAndStorePages`）で `CORRUPT_ZIP` または `DECODE_FAILED` を検知した場合は、`ReaderPage` 側で同一セッション 1 回限り `zipIndexCacheRepo.delete(source.indexCacheKey)`・新 `repairEpoch` 発行・L1/WebGL2 全破棄の上で `openArchive(source, null, repairEpoch)`（`cachedEntries = null` による `parseZipDirectory` 再解析）へ自己修復フォールバックする連携を行う（`R1-06`）。
3. **`requestVisiblePages(pageIndices, prefetchIndices, epoch, options?)`**:
   - `epoch < minActiveEpoch` または `activeReader === null` の場合は `[]` を返却する。
   - 進行中の古い世代（`activePrefetchEpoch < epoch`）の Warm Prefetch が存在する場合は即座に `abort()` して Fast-Path 帯域と旧 `inflightPageReads` を解放し、`effectiveVisible = options?.visiblePageIndices ?? pageIndices` で `l2Cache.setPinnedPages(effectiveVisible)` を更新する。
   - `pageIndices` の各ページを以下の優先順で取得し、`DecodeWorkerPool`（2 Worker）でデコードして `DecodedPageFrame[]` を返却する：
     1. **`L2ByteCache` ヒット**: `l2Cache.get(pageIndex)` で MRU 昇格しつつ `readRange` 0 回で即座に Decode Worker へ投入する。
     2. **In-Flight 共有ヒット**: `inflightPageReads` に **同一世代かつ未中断（`inflight.epoch === epoch && !inflight.signal.aborted`）** の進行中取得がある場合はその完了を待機して二重 `readRange` を防ぐ（複数待機者で共有されるバッファには `markSharedBuffer` を適用し、`null` 解決かつ自身の `signal` が未中断の場合のみ直接 `readCompressedPageSlice` へフォールバックする）。
     3. **Fast-Path 直接取得**: （`compressedSize <= l2Cache.maxBytes` なら同世代 `inflightPageReads` へ登録しつつ）`readCompressedPageSlice` を実行し、`l2Cache.put(pageIndex, slice, { allowOversized: isVisiblePage })` でキャッシュ格納を試行した上で Decode Worker へ投入する。
     - 成功時: `{ status: "ready", pageIndex, epoch, width, height, bitmap }`
     - 個別ページ失敗時（`DECODE_FAILED` / `CORRUPT_ZIP` / `READ_ERROR` 等、`AbortError` 除く）: 同一バッチ内の他ページを巻き込まず `{ status: "error", pageIndex, epoch, errorCode, message }` を返却する。
   - **バックグラウンド Warm Prefetch 起動（1 `epoch` 最大 1 サイクル）**:
     - `pageIndices` の処理完了後（`pageIndices.length === 0` の L2 補充呼び出し時を含む）、未中断かつ `prefetchIndices.length > 0` かつ当該 `epoch` で Warm Prefetch 未起動であれば、`epoch` に紐づく専用 `AbortController` を登録し、全計画バッチの `inflightPageReads` 先行登録を同期実行した上で `AdaptivePrefetcher` をバックグラウンド非同期起動し、RPC 自体は待たずに `DecodedPageFrame[]` を返却する。
   - **世代チェックと即時破棄**: `DecodeWorker` から `ImageBitmap` が戻った時点で中断済み（`epoch < minActiveEpoch`）になっていた場合、**UI スレッドへ返却せず Coordinator 側で即座に `bitmap.close()` を実行して破棄する**。
   - **Worker ブートストラップ中継と Zero-Copy 転送**: `coordinator.worker.ts` ラッパーは `core.requestVisiblePages(pageIndices, prefetchIndices, epoch, options)` へ第 4 引数 `options` まで透過中継した上で、条件分岐を持たず無条件で `coordinatorTransfer.transferDecodedFrames(frames)` へ委譲する。`transferDecodedFrames` は `collectFrameTransferables(frames)` により `status === "ready"` の `frame.bitmap` のみを抽出し、`transferables.length > 0` の場合のみ `Comlink.transfer(frames, transferables)`（それ以外は `frames` をそのまま返却）で UI スレッドへ転送する。
4. **`cancelEpochBelow(minActiveEpoch)` / `closeArchive()`**:
   - `cancelEpochBelow`: `minActiveEpoch` 未満の Fast-Path および進行中 Warm Prefetch の `AbortController.abort()` をすべて即時発火する（連動して該当世代の `inflightPageReads` も同期的に削除・`null` 解決される）。
   - `closeArchive()`: 進行中全ジョブを中断し、`inflightPageReads` クリアおよび `l2Cache.clear()` で L2 保持メモリを全破棄した上で `activeReader` および `entries` を解放する。
5. **Worker 異常終了・ロード失敗時のライフサイクル保護**:
   - `Coordinator` / `Decode` 各 Worker のロード失敗や実行時クラッシュ（`error` / `messageerror`）をハングさせずに捕捉し、該当 RPC 呼び出し元へ型付きエラー（`READ_ERROR` / `DECODE_FAILED`）を即時返却する（詳細は `§4.5.3`）。

### 4.5 Worker 間 Zero-Copy 転送所有権規約（`HO-03`）・Comlink エラーシリアライズ・Worker 異常終了検知契約

1. **Decode 送信時の `ArrayBuffer` 所有権分離規約（`prepareDecodeTransfer` / `markSharedBuffer`）**:
   - `coordinatorTransfer.ts` は `WeakSet<ArrayBuffer>` ベースの `markSharedBuffer(buffer)` / `isSharedBuffer(buffer)` および `prepareDecodeTransfer(compressedData, options?: { shared?: boolean })` を提供する。
   - `options?.shared === true` または `isSharedBuffer(compressedData.buffer) === true`（`L2ByteCache` 格納済みバッファまたは複数待機者共有バッファ）、あるいは部分 `subarray`（`byteOffset !== 0 || byteLength !== buffer.byteLength`：通常サイズ L2 非格納ページの 1 RTT `readCompressedPageSlice` が返す `initialBuf.subarray(...)` 等）・非 `ArrayBuffer`（`SharedArrayBuffer` 等）の場合は、元バッファのデタッチ破壊や余剰ヘッダ・結合領域の転送を防ぐため、必ず `compressedData.slice()` で独立した新 `ArrayBuffer` を複製して `transferables` に設定する。
   - 非共有かつ `byteOffset === 0 && byteLength === buffer.byteLength && buffer instanceof ArrayBuffer` の独立バッファ（L2 非格納の 80MB 超ページのヘッダ先行抽出結果、および L2 未登録状態の 2 RTT ケース 2a/2b 結果等）のみ、元 `ArrayBuffer` を複製せずそのまま Zero-Copy 転送する。
   - `coordinator.worker.ts` は条件分岐を一切持たず、`prepareDecodeTransfer(compressedData)` の戻り値を `Comlink.transfer` へ渡し、応答側も `transferDecodedFrames(frames)` を無条件で返却する。
2. **Comlink 例外シリアライズ契約（`registerZipArchiveErrorTransferHandler`）**:
   - Worker 側（`src/engine/workers/decode.worker.ts`, `src/engine/workers/coordinator.worker.ts`）および UI クライアント側（`src/app/coordinatorClient.ts`）の双方で起動時に `registerZipArchiveErrorTransferHandler()` を冪等登録する。
   - Comlink の標準 `"throw"` ハンドラをラップし、`ZipArchiveError` の `code`・`name`・`message`・`stack` および `DOMException`（`AbortError` 等の `name`・`message`・`stack`）を Worker RPC 越しに保持・復元する。
3. **Coordinator Worker ＆ Decode Worker 異常終了・ロード失敗（`error` / `messageerror`）時の RPC 即時 reject 契約**:
   - **Coordinator Worker 監視（`src/app/coordinatorClient.ts`）**:
     - `CoordinatorWorkerHandle` はオプショナルな `addEventListener` / `removeEventListener`（`"error"` / `"messageerror"` 対象）を持ち、最小 DI モック（`{ terminate }` のみ）との後方互換性を維持する。
     - `createCoordinatorSession` 内で Coordinator Worker の `"error"` / `"messageerror"` を購読し、発火時は ①`diagnosticLogger.error("engine", "Coordinator Workerが異常終了しました", detail)` を記録（`ErrorEvent` の `message` / `filename` / `lineno` / `colno` や `Event.type` から安全に構築）、②`ZipArchiveError("READ_ERROR", "Coordinator Workerが異常終了しました")` を生成・保持してリスナーを解除、③保留中の非同期 RPC（`openArchive`, `requestVisiblePages`, `closeArchive`）および以後の非同期 RPC 呼び出しを即座に同エラーで reject する（ただし `dispose()` 済みセッションは既存 Comlink 契約通り同期的に `rawApi` へフォワードし、`wrapWorker` 例外送出時および `dispose()` 実行時も `removeEventListener` を漏れなく実行する）。
   - **Decode Worker 監視（`src/engine/workers/DecodeWorkerPool.ts` ＆ `src/engine/workers/coordinator.worker.ts`）**:
     - `DecodeWorkerHandle` はオプショナルな `subscribeError?: (listener: (event: unknown) => void) => () => void` を持ち、`coordinator.worker.ts` からは条件分岐ゼロで `worker.addEventListener("error", listener)` / `worker.addEventListener("messageerror", listener)` と解除関数を返す純粋結線のみを行う。
     - `DecodeWorkerPool` はコンストラクタで `handle.subscribeError` を購読し、対象スロットでエラーが発生した場合は当該スロットを `broken = true` にして購読解除・`activeCount = 0` リセットを行い、当該スロットで実行中の保留 `decodePageSlice` を即座に `ZipArchiveError("DECODE_FAILED", ...)` で reject する。他の健全スロット（`!slot.broken`）が生存していれば後続の `decodePageSlice` は健全スロットのみへ最小負荷＋ラウンドロビンでルーティングし、全スロットが `broken` の場合は後続呼び出しを即座に `ZipArchiveError("DECODE_FAILED", ...)` で reject する。`dispose()` 時は全スロットの `unsubscribeError?.()` を呼び、保留中呼び出しを `DECODE_FAILED` で解放した上で `terminate?.()` する。

---

## 5. 受け入れ条件（`AC-ENG-xx`）

|    AC ID    | 受け入れ条件                                                                                                                                                                                                                                                                                                                                                                                                         |
| :---------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-ENG-01` | `LocalFileReader` は `File.slice` で指定範囲を読み取り、ファイル末尾超過時は実サイズまで安全にクランプし、`AbortSignal` で中断できる。                                                                                                                                                                                                                                                                               |
| `AC-ENG-02` | `zipParser.ts`（論理名 `ZipParserCore`: `parseZipDirectory`）は末尾 128KB から標準 ZIP の EOCD と CDH を解析し、128KB 超の巨大 CD も追加 1 RTT で完全解析できる。                                                                                                                                                                                                                                                    |
| `AC-ENG-03` | 画像拡張子（`.jpg/.jpeg/.png/.webp/.avif` 大小非区別）のみ抽出し、`__MACOSX/`・`._*`・`Thumbs.db`・`.DS_Store`・`desktop.ini`・ディレクトリを除外し、`/`・`\` セグメント単位の日本語自然順でソートする。                                                                                                                                                                                                             |
| `AC-ENG-04` | GPBF Bit 11 判定＋UTF-8 非厳格／strict 失敗時 CP932（Shift_JIS）フォールバックで日本語ファイル名も正しくデコードし、暗号化・未対応圧縮・空アーカイブ・破損／マルチディスク ZIP には明示的 `ZipErrorCode` を返す。                                                                                                                                                                                                    |
| `AC-ENG-05` | LFH 可変長 `extraFieldLength` を LFH 先頭から実読取りし、全 CDH 基準の `physicalEnd` 境界内で 1 RTT（`+1KB` マージン）により正確な圧縮ペイロードを切り出せる。                                                                                                                                                                                                                                                       |
| `AC-ENG-06` | `DecodeWorkerCore` は Store (`0`) と Deflate (`8`: `DecompressionStream` ＋ `fflate` フォールバック) の双方を `ImageBitmap` へデコードできる。                                                                                                                                                                                                                                                                       |
| `AC-ENG-07` | `CoordinatorCore` は古い `requestEpoch` の進行中 `readRange`（Fast-Path および Warm Prefetch 双方）を `AbortController` で即時中断し、遅延到着した `ImageBitmap` は即 `bitmap.close()` して破棄する。                                                                                                                                                                                                                |
| `AC-ENG-08` | §1 の `*.worker.ts` を除く全純粋 TypeScript モジュール（`constants` / `LocalFileReader` / `zipParser.ts`［論理名 `ZipParserCore`］ / `zipIndexValidation` / `errors` / `L2ByteCache` / `AdaptivePrefetcher` / `DecodeWorkerCore` / `DecodeWorkerPool` / `CoordinatorCore` / `comlinkErrorHandler` / `coordinatorTransfer`）および `coordinatorClient` のすべてが C0/C1/Functions/Lines 100% 単体テストを PASS する。 |
| `AC-ENG-09` | ZIP64 EOCD Locator / ZIP64 EOCD Record（4GB 超オフセット・`0x0001` Extra Field 全 CDH 先行解決含む）を安全整数範囲内で完全解析し、マルチディスク ZIP・`Number.MAX_SAFE_INTEGER` 超過・`totalEntries * 46 > cdSize` を `CORRUPT_ZIP` として拒否できる。                                                                                                                                                               |
| `AC-ENG-10` | GPBF Bit 11 未設定の Shift_JIS（CP932）日本語ファイル名を文字化けせず復元でき、`readCompressedPageSlice` の 2 RTT 経路も `byteOffset === 0` の独立バッファ直接返却により不要な二重コピーを発生させない（`HO-03` 前半）。                                                                                                                                                                                             |
| `AC-ENG-11` | `DexieZipIndexCacheRepository`（Dexie `version(2)` `zipIndexCache`・最大 500 件 LRU・不整合レコード自動削除フォールバック）と `ReaderPage` / `CoordinatorCore.openArchive` の連携により、同一アーカイブ 2 回目以降を 0 RTT（`fromIndexCache: true`）で開ける。                                                                                                                                                       |
| `AC-ENG-12` | `L2ByteCache` は `L2_CACHE_MAX_BYTES`（80MB）上限で独立 `Uint8Array` を LRU 保持・退避し、単一 80MB 超例外画像は現在表示ページ（`allowOversized: true`）のみ一時保持して表示対象外移動時および `closeArchive()` 時に即座に解放する。                                                                                                                                                                                 |
| `AC-ENG-13` | `AdaptivePrefetcher` は優先順 10MB 予算選抜（単一 10MB 超〜80MB 以下単独許容・80MB 超除外）後に `localHeaderOffset` 昇順・物理ギャップ 64KB 以内・実 Range 長 10MB 以内で `readRange` を結合し、末尾 LFH 1KB 超過補完および一部破損時の正常ページ救済を行える。                                                                                                                                                      |
| `AC-ENG-14` | `markSharedBuffer` / `prepareDecodeTransfer`（`HO-03` 後半）により `L2ByteCache` 保持バッファが `Comlink.transfer` でデタッチ破壊されず、同世代 In-Flight 共有で重複 `readRange` を防ぎつつ L1 退避後の再めくりでも L2 から 0 RTT で再デコードできる。                                                                                                                                                               |
