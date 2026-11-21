---
type: spec-engine
title: "ZIPストリーミング・I/O・Worker エンジン仕様書"
description: "LocalFileReader、標準ZIP/ZIP64/CP932対応パーサー、Coordinator/Decode Worker構成、zipIndexCache 0RTTオープン、およびrequestEpoch世代キャンセル制御の正本"
status: "Review (#19)"
updated: "2026-11-20"
tags: [engine, zip, zip64, cp932, streaming, web-worker, comlink, cache, epoch]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/engine/webgl2-renderer.md
  - docs/specs/features/reader.md
  - docs/guidelines/testing.md
related_tests:
  - src/engine/constants.test.ts
  - src/engine/io/LocalFileReader.test.ts
  - src/engine/zip/errors.test.ts
  - src/engine/zip/zipIndexValidation.test.ts
  - src/engine/zip/zipParser.test.ts
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

本ドキュメントは、ExLibris の **Layer 1（Streaming & I/O）** および **Layer 2（Engine Worker）** に属するランダムアクセス読込、ZIP 解析・1 RTT スライス切り出し、Coordinator / Decode Worker 連携、ならびに世代キャンセル制御（`requestEpoch`）の正本（Single Source of Truth）です。

---

## 1. モジュール構成と責務分離（4層・純粋テスト規約）

Worker グローバル（`self`）への直接依存を避けて Vitest による C0/C1/Functions/Lines 100% 単体テストを可能にするため、ロジック本体（`*Core.ts` および純関数モジュール）と Worker ブートストラップ（`*.worker.ts`）を厳格に分離します。

| モジュールパス                              | レイヤー | 責務                                                                                                                                                                                                            |
| :------------------------------------------ | :------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/constants.ts`                   | 共通定数 | ストリーミング読込・先読み・L1/L2 キャッシュ・Worker プール数・表紙抽出レートの予算定数（`ENGINE_BUDGETS`）定義                                                                                                 |
| `src/engine/io/LocalFileReader.ts`          | Layer 1  | 端末ローカル `File` を `File.slice` で範囲読込する `RandomAccessReader` 実装（Web / Android WebView 共通）                                                                                                      |
| `src/engine/zip/zipParser.ts`               | Layer 2  | 論理名 `ZipParserCore`（実装関数: `parseZipDirectory`, `readCompressedPageSlice`）。EOCD 検索、Central Directory 解析、画像フィルタ・ゴミ除外、自然順ソート、LFH 可変長ヘッダスキップによる圧縮本体スライス抽出 |
| `src/engine/zip/errors.ts`                  | Layer 2  | 型付きエンジンエラー（`ZipArchiveError` / エラーコード列挙 / `isAbortError`）                                                                                                                                   |
| `src/engine/workers/DecodeWorkerCore.ts`    | Layer 2  | Store (`0`) / Deflate (`8`: `DecompressionStream('deflate-raw')` ＋ `fflate` フォールバック) 伸長 ＋ `createImageBitmap` デコード                                                                               |
| `src/engine/workers/DecodeWorkerPool.ts`    | Layer 2  | `DecodeWorkerApi` を実装し、複数 Decode Worker 間の最小負荷＋ラウンドロビン割り当ておよび `dispose()` ライフサイクル制御を行うプール                                                                            |
| `src/engine/workers/CoordinatorCore.ts`     | Layer 2  | `CoordinatorWorkerApi` 実装。アーカイブオープン、Fast-Path 最優先実行、近傍先読みスケジューリング、`requestEpoch` 世代キャンセル                                                                                |
| `src/engine/workers/comlinkErrorHandler.ts` | Layer 2  | Worker 側・UI クライアント側双方の Comlink `throw` ハンドラを拡張し、`ZipArchiveError.code` および `DOMException`（`AbortError` 等）を RPC 越しに保持・復元する純関数シリアライザ                               |
| `src/engine/workers/coordinatorTransfer.ts` | Layer 2  | Decode Worker 送信時の `ArrayBuffer` 所有境界チェック＆必要時 `slice()` コピー（`prepareDecodeTransfer`）および `ready` フレームの `ImageBitmap` 抽出（`collectFrameTransferables`）を行う純関数モジュール      |
| `src/engine/workers/decode.worker.ts`       | Layer 2  | `registerZipArchiveErrorTransferHandler()` 登録、`DecodeWorkerCore` 初期化、`Comlink.transfer` 返却および `Comlink.expose` のみの薄いブートストラップ（数行のみ）                                               |
| `src/engine/workers/coordinator.worker.ts`  | Layer 2  | `registerZipArchiveErrorTransferHandler()` 登録、`DecodeWorkerPool`・`CoordinatorCore`・`coordinatorTransfer` の結線と `Comlink.expose` のみの薄いブートストラップ（数行のみ）                                  |

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

### 3.4 LFH 可変長 1 RTT スライス切り出し

1. `readCompressedPageSlice(reader, entry, signal?)`:
   - まず `maxSpan = entry.physicalEnd - entry.localHeaderOffset` を算出し、`entry.localHeaderOffset < 0 || maxSpan < 30` の場合は即座に `ZipArchiveError("CORRUPT_ZIP")` を送出する。
   - 取得長 `fetchLength = Math.min(maxSpan, 30 + entry.entryNameByteLength + entry.compressedSize + ENGINE_BUDGETS.LFH_EXTRA_MARGIN_BYTES)` を算出し、`readRange(entry.localHeaderOffset, fetchLength, signal)` を 1 回だけ呼び出す。
   - `initialBuf.byteLength < 30` または Local File Header シグネチャ `0x04034b50` 不一致の場合は `CORRUPT_ZIP` を送出する。
   - LFH 側の `fileNameLength`（offset 26）と `extraFieldLength`（offset 28）を読み取って実データ開始相対位置 `dataStart = 30 + lfhFileNameLength + lfhExtraFieldLength` を算出する（CDH と LFH の `extraFieldLength` が異なる ZIP にも対応）。
   - `dataStart + entry.compressedSize > maxSpan` の場合は境界違反として `ZipArchiveError("CORRUPT_ZIP")` を送出する。
   - `dataStart + entry.compressedSize <= initialBuf.byteLength` であれば `initialBuf.subarray(dataStart, dataStart + entry.compressedSize)` を返却する（1 RTT 完了、ゼロコピービュー）。
   - LFH `extraField` が 1KB マージンを超過し（かつ `maxSpan` 内に収まり）`dataStart + entry.compressedSize > initialBuf.byteLength` となった場合は、以下の 2 ケースに分岐して 2 RTT で返却する：
     - **ケース 2a（`dataStart < initialBuf.byteLength`）**: 未取得の末尾差分 `[entry.localHeaderOffset + initialBuf.byteLength, entry.compressedSize - (initialBuf.byteLength - dataStart)]` のみを `readRange` で追加取得し、`new Uint8Array(entry.compressedSize)` を直接確保して先頭に `initialBuf.subarray(dataStart)`・後続に末尾差分をコピーした `byteOffset === 0` の独立バッファを返却する（不要なヘッダ確保と `prepareDecodeTransfer` での再コピーを排除）。
     - **ケース 2b（`dataStart >= initialBuf.byteLength`：`lfhExtraFieldLength` が `compressedSize + 1KB` を上回り `initialBuf` に圧縮本体を一切含まない）**: `readRange(entry.localHeaderOffset + dataStart, entry.compressedSize, signal)` で圧縮本体のみを直接追加取得し、`initialBuf` と結合せずそのまま返却する（`RangeError` と余剰コピーを防止）。

---

## 4. `DecodeWorkerCore` と `CoordinatorCore`（Layer 2）仕様

### 4.1 `DecodeWorkerCore`（2 Worker プール）

1. `decodePageSlice(compressedData, compressionMethod)`:
   - `compressionMethod === 0`（Store）: `compressedData` をそのまま画像 Blob 化。
   - `compressionMethod === 8`（Deflate）: `DecompressionStream("deflate-raw")` が利用可能であれば優先使用し、非対応環境（テスト JSDOM 等）や失敗時の互換フォールバックとして `fflate.inflateSync` を使用する。
   - 伸長済みバイト列から `new Blob([rawBytes])` を生成し、`createImageBitmap(blob)` でオフスレッドデコードを行う（失敗時は `ZipArchiveError("DECODE_FAILED")`）。
   - 返却値 `{ bitmap, width: bitmap.width, height: bitmap.height }`。Worker ラッパー側では `Comlink.transfer(result, [result.bitmap])` で所有権ごと親側へ Zero-Copy 転送する。

### 4.2 `CoordinatorCore`（Phase 3 最小実行モデル ＋ 世代キャンセル）

1. **状態管理**:
   - `activeReader: RandomAccessReader | null`
   - `entries: ZipPageEntry[]`
   - `minActiveEpoch: number`
   - `inflightAbortControllers: Map<number, Set<AbortController>>`（epoch 単位の進行中 I/O 中断管理）
2. **`openArchive(source, cachedEntries, epoch)`**:
   - `epoch < minActiveEpoch` の場合は即キャンセルエラー。
   - 既存アーカイブがあれば `closeArchive()` 相当のクリーンアップを実施。
   - `source.kind === "local-session"` に対し `LocalFileReader(source.file)` を生成する。`cachedEntries` に非空配列かつ基本構造検証（`validateZipIndexEntries`：必須フィールド型・非負有限数値・`localHeaderOffset < physicalEnd` 等）を通過した配列が渡された場合のみ `parseZipDirectory` をスキップして 0 RTT（`fromIndexCache: true`）で即座に完了し、`null`・空配列・不整合配列の場合は自動的に `parseZipDirectory` へフォールバックする（`fromIndexCache: false`）。
   - UI スレッド（`ReaderPage` + `ZipIndexCacheRepository`）が `source.indexCacheKey`（`local:${rawFileName}:${fileSize}`）で Dexie `zipIndexCache`（最大 500 件 LRU）を参照し、不整合キャッシュ検知時は自動削除して `cachedEntries = null` へ透過フォールバックし、通常オープン成功時に `entries` を非ブロッキング保存する。
3. **`requestVisiblePages(pageIndices, prefetchIndices, epoch)`**:
   - `epoch < minActiveEpoch` の場合は `[]` を返却する。
   - `pageIndices` の各ページを `readCompressedPageSlice` ＋ `DecodeWorkerPool`（2 Worker）で処理し、`DecodedPageFrame[]` として返却する：
     - 成功時: `{ status: "ready", pageIndex, epoch, width, height, bitmap }`
     - 個別ページ失敗時（`DECODE_FAILED` / `CORRUPT_ZIP` / `READ_ERROR` 等、`AbortError` 除く）: 同一バッチ内の他ページを巻き込まず `{ status: "error", pageIndex, epoch, errorCode, message }` を返却する。
   - **Phase 3 における Fast-Path と L1 先読みの呼び出し契約**:
     - `Phase 3` では L2 キャッシュ未実装のため、UI スレッド（`ReaderPage`）が先に Fast-Path として `requestVisiblePages([N], [], epoch)` を実行して現在ページ `N` を即時描画し、その完了後に L1 窓用の近傍ページ（`[N+1]`, `[N+2]`, `[N-1]`）を個別に `requestVisiblePages([neighbor], [], epoch)` としてバックグラウンド呼び出しする（`DecodeWorkerPool` x2 で並列処理され、完了順に `L1PageCache` へ格納される）。
     - `prefetchIndices` 引数は `v0.1` の 10MB バイト予算 L2 Warm Prefetch 起動用として契約を維持し、`Phase 3` では空配列または無視（no-op）とする。
   - **世代チェックと即時破棄**: `DecodeWorker` から `ImageBitmap` が戻った時点で `epoch < minActiveEpoch` になっていた場合、**UI スレッドへ返却せず Coordinator 側で即座に `bitmap.close()` を実行して破棄する**。
   - **Zero-Copy 転送**: `coordinator.worker.ts` ラッパーは `collectFrameTransferables(frames)` により `frame.status === "ready"` の `frame.bitmap` のみを抽出し、`transferables.length > 0` の場合のみ `Comlink.transfer(frames, transferables)` で UI スレッドへ転送する。
4. **`cancelEpochBelow(minActiveEpoch)` / `closeArchive()`**:
   - `minActiveEpoch` 未満のすべての `AbortController.abort()` を即時発火する。
   - `closeArchive()` 時は進行中全ジョブを中断し、`activeReader` および `entries` を解放する。

### 4.3 Worker 間 Zero-Copy 転送所有権規約と Comlink エラーシリアライズ契約

1. **Decode 送信時の `ArrayBuffer` 所有権規約（`prepareDecodeTransfer`）**:
   - `coordinatorTransfer.ts` の `prepareDecodeTransfer(compressedData)` は、`byteOffset === 0 && byteLength === buffer.byteLength && buffer instanceof ArrayBuffer` の場合は元 `ArrayBuffer` をそのまま `Comlink.transfer` 対象としてデタッチするため、将来 `v0.1` で `L2ByteCache` 等の共有キャッシュ由来スライスを渡す際は事前にコピー（または共有フラグ導入）して元キャッシュを破壊しないこと。
   - 部分 `subarray`（`byteOffset !== 0` または `byteLength !== buffer.byteLength`）および非 `ArrayBuffer`（`SharedArrayBuffer` 等）の場合は、`compressedData.slice()` により独立した `ArrayBuffer` を複製してから転送する。
2. **Comlink 例外シリアライズ契約（`registerZipArchiveErrorTransferHandler`）**:
   - Worker 側（`src/engine/workers/decode.worker.ts`, `src/engine/workers/coordinator.worker.ts`）および UI クライアント側（`src/app/coordinatorClient.ts`）の双方で起動時に `registerZipArchiveErrorTransferHandler()` を冪等登録する。
   - Comlink の標準 `"throw"` ハンドラをラップし、`ZipArchiveError` の `code`・`name`・`message`・`stack` および `DOMException`（`AbortError` 等の `name`・`message`・`stack`）を Worker RPC 越しに保持・復元する。

---

## 5. 受け入れ条件（`AC-ENG-xx`）

|    AC ID    | 受け入れ条件                                                                                                                                                                                                                                                   |
| :---------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-ENG-01` | `LocalFileReader` は `File.slice` で指定範囲を読み取り、ファイル末尾超過時は実サイズまで安全にクランプし、`AbortSignal` で中断できる。                                                                                                                         |
| `AC-ENG-02` | `zipParser.ts`（論理名 `ZipParserCore`: `parseZipDirectory`）は末尾 128KB から標準 ZIP の EOCD と CDH を解析し、128KB 超の巨大 CD も追加 1 RTT で完全解析できる。                                                                                              |
| `AC-ENG-03` | 画像拡張子（`.jpg/.jpeg/.png/.webp/.avif` 大小非区別）のみ抽出し、`__MACOSX/`・`._*`・`Thumbs.db`・`.DS_Store`・`desktop.ini`・ディレクトリを除外し、`/`・`\` セグメント単位の日本語自然順でソートする。                                                       |
| `AC-ENG-04` | GPBF Bit 11 判定＋UTF-8 非厳格／strict 失敗時 CP932（Shift_JIS）フォールバックで日本語ファイル名も正しくデコードし、暗号化・未対応圧縮・空アーカイブ・破損／マルチディスク ZIP には明示的 `ZipErrorCode` を返す。                                              |
| `AC-ENG-05` | LFH 可変長 `extraFieldLength` を LFH 先頭から実読取りし、全 CDH 基準の `physicalEnd` 境界内で 1 RTT（`+1KB` マージン）により正確な圧縮ペイロードを切り出せる。                                                                                                 |
| `AC-ENG-06` | `DecodeWorkerCore` は Store (`0`) と Deflate (`8`: `DecompressionStream` ＋ `fflate` フォールバック) の双方を `ImageBitmap` へデコードできる。                                                                                                                 |
| `AC-ENG-07` | `CoordinatorCore` は古い `requestEpoch` の進行中 `readRange` を `AbortController` で即時中断し、遅延到着した `ImageBitmap` は即 `bitmap.close()` して破棄する。                                                                                                |
| `AC-ENG-08` | `CoordinatorCore` / `DecodeWorkerCore` / `DecodeWorkerPool` / `coordinatorTransfer` / `comlinkErrorHandler` / `zipParser.ts`（論理名 `ZipParserCore`） / `LocalFileReader` のすべてが C0/C1/Functions/Lines 100% 単体テストを PASS する。                      |
| `AC-ENG-09` | ZIP64 EOCD Locator / ZIP64 EOCD Record（4GB 超オフセット・`0x0001` Extra Field 全 CDH 先行解決含む）を安全整数範囲内で完全解析し、マルチディスク ZIP・`Number.MAX_SAFE_INTEGER` 超過・`totalEntries * 46 > cdSize` を `CORRUPT_ZIP` として拒否できる。         |
| `AC-ENG-10` | GPBF Bit 11 未設定の Shift_JIS（CP932）日本語ファイル名を文字化けせず復元でき、`readCompressedPageSlice` の 2 RTT 経路も `byteOffset === 0` の独立バッファ直接返却により不要な二重コピーを発生させない（`HO-03` 前半）。                                       |
| `AC-ENG-11` | `DexieZipIndexCacheRepository`（Dexie `version(2)` `zipIndexCache`・最大 500 件 LRU・不整合レコード自動削除フォールバック）と `ReaderPage` / `CoordinatorCore.openArchive` の連携により、同一アーカイブ 2 回目以降を 0 RTT（`fromIndexCache: true`）で開ける。 |
