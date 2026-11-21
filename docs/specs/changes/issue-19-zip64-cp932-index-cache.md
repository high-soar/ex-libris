---
type: spec-delta
title: "Issue #19 差分仕様: ZIP64・CP932（Shift_JIS）・zipIndexCache 0RTT 解析基盤"
description: "ZIP64 フル対応、CP932（Shift_JIS）フォールバック＋セグメント自然順ソート、HO-03 前半 2RTT コピー削減、Dexie v2（500件 LRU zipIndexCache）0RTT 統合を定義する差分仕様"
status: "Review (#19)"
updated: "2026-11-20"
issue: "#19"
tags:
  [delta, v0.1, zip64, cp932, shift-jis, dexie, zip-index-cache, ho-03, 0rtt]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/zip-streaming.md
  - docs/specs/features/reader.md
  - docs/guidelines/workflow.md
  - docs/guidelines/testing.md
  - docs/quality/bug-and-handover-log.md
related_tests:
  - src/engine/zip/zipParser.test.ts
  - src/engine/zip/errors.test.ts
  - src/engine/workers/CoordinatorCore.test.ts
  - src/engine/workers/comlinkErrorHandler.test.ts
  - src/storage/db.test.ts
  - src/app/ServiceProvider.test.tsx
  - src/features/reader/ReaderPage.test.tsx
  - src/features/reader/readerErrors.test.ts
  - test/it/local-reader.spec.ts
---

# Issue #19 差分仕様: ZIP64・CP932（Shift_JIS）・`zipIndexCache` 0RTT 解析基盤

## 1. 背景・目的（Why）

- Phase 3 PoC で先行実装した標準 ZIP 最小パーサー（`src/engine/zip/zipParser.ts`）を `v0.1` 実運用レベルへ引き上げ、4GB 超 **ZIP64** アーカイブ、日本語環境で頻出する **Shift_JIS（CP932）** ファイル名、および同一アーカイブの 2 回目以降 **0 RTT オープン** を実現する `zipIndexCache`（Dexie.js `version(2)`）を構築する。
- あわせて、Phase 3 横断レビューの申し送り事項 [`HO-03`](../../quality/bug-and-handover-log.md) の前半である `readCompressedPageSlice` での無駄なメモリコピー削減を実施し、次 Issue（`#20` `[v0.1][3/5]`）の 80MB `L2ByteCache` ＋ 10MB Warm Prefetch 導入基盤を整える。

### 1.1 Step 1 合意事項（Open Questions 確定内容）

1. **`db.ts` `version(2)` 構成と `zipIndexCache` 読み書き主体**:
   - `db.ts` の `version(2)` で `zipIndexCache` と `readingProgress` の両テーブルを先行定義する（`readingProgress` の Repository / UI 利用は `#22` `[5/5]` で実装）。
   - `zipIndexCache` の読み書き・整理は UI スレッド側（`ReaderPage` ＋ `ServiceProvider` 注入 `ZipIndexCacheRepository`）が担当し、既存の `CoordinatorWorkerApi.openArchive(source, cachedEntries, epoch)` 契約をそのまま活用する。
2. **`zipIndexCache` の LRU 上限と破損キャッシュ時フォールバック**:
   - 保持上限は **最大 500 件の LRU**（キャッシュヒット時に `cachedAt` を現在時刻で更新し、`put` 保存時に 500 件超過分を `cachedAt` 昇順で削除）とする。
   - キャッシュレコードが空配列・構造不正（必須フィールド欠落・非有限数値・`entries.length !== pageCount` 等）と検知された場合は、該当レコードを自動削除した上で通常の `parseZipDirectory`（`openArchive(source, null, epoch)`）へ透過フォールバックする。
3. **`ZIP64_NOT_SUPPORTED` 撤去・マルチディスク拒否・セグメント自然順ソート**:
   - ZIP64 本対応に伴い `ZipErrorCode` および `READER_ERROR_MESSAGES` から `ZIP64_NOT_SUPPORTED` を撤去し、ZIP64 構造破損は `CORRUPT_ZIP` へ統一する。
   - マルチディスク／分割 ZIP（`diskNumber !== 0`, `cdDiskNumber !== 0`, `diskEntries !== totalEntries`, ZIP64 `totalDisks > 1`, `diskNumberStart !== 0` 等）は `CORRUPT_ZIP` として拒否する。
   - 論理ページ自然順ソートは `docs/guidelines/testing.md §2.1` 準拠の **`/`（および `\`）セグメント単位 `Intl.Collator("ja", { numeric: true, sensitivity: "base" })` 比較** へ統一する。
4. **`HO-03`（前半）`readCompressedPageSlice` コピー削減の範囲（案 A）**:
   - 2 RTT 経路（LFH `extraField` が 1KB マージン超過時）で不要なヘッダ領域（`0..dataStart`）まで確保・二重コピーしていた `new Uint8Array(dataEnd)` を廃止し、`new Uint8Array(entry.compressedSize)` を直接確保して圧縮スライス本体のみを詰め、`byteOffset === 0 && byteLength === buffer.byteLength` の独立バッファを返すことで `prepareDecodeTransfer` 側の再コピーをゼロ化する。
   - 1 RTT 経路は `initialBuf.subarray(dataStart, dataEnd)`（ゼロコピービュー）を維持し、`DecodeWorkerApi`（`Uint8Array` 引数）の契約は変更せず、`L2ByteCache` 共有スライス非破壊（`HO-03` 後半）は `#20` で完結させる。

---

## 2. 変更対象の App 全体正本一覧

|   種別   | 正本ファイル                                                     | 変更概要                                                                                                                                                                               |
| :------: | :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **更新** | [zip-streaming.md](../engine/zip-streaming.md)                   | `ZIP64_NOT_SUPPORTED` 撤去、ZIP64 Locator/EOCD/ExtraField `0x0001`・マルチディスク・安全整数・CP932・セグメント自然順・`HO-03` 前半・`openArchive` 0RTT を反映、`AC-ENG-09`〜`11` 追加 |
| **更新** | [architecture.md](../architecture.md)                            | `ZipErrorCode` から `ZIP64_NOT_SUPPORTED` 削除、Storage 層 `ZipIndexCacheRepository` 追記、`openArchive` JSDoc 同期                                                                    |
| **更新** | [db-schema.md](../db-schema.md)                                  | `zipIndexCache`（最大 500 件 LRU・不正キャッシュ自動削除フォールバック）と `version(2)` 段階実装範囲を具体化                                                                           |
| **更新** | [reader.md](../features/reader.md)                               | `ZIP64_NOT_SUPPORTED` エラー削除、`ReaderPage` の `ZipIndexCacheRepository` 連携（0RTT・透過フォールバック）を追記                                                                     |
| **更新** | [screen-transitions.md](../screen-transitions.md)                | `SCN-02` 保証範囲に ZIP64・CP932・`zipIndexCache` 0RTT 再オープンを追加                                                                                                                |
| **更新** | [bug-and-handover-log.md](../../quality/bug-and-handover-log.md) | `HO-05`（区分 B / 完了ゲート: `Milestone v0.1 完了前`）を新規登録                                                                                                                      |

---

## 3. 追加・変更する仕様の差分サマリー

### 3.1 ZIP64 フル解析（`src/engine/zip/zipParser.ts` / `AC-ENG-02`, `AC-ENG-04`, `AC-ENG-09`）

1. **EOCD ＋ ZIP64 EOCD Locator / Record 解決**:
   - 末尾 `min(totalSize, 131_072)` バイト取得後、EOCD (`0x06054b50`) を特定し、先に `hasLocator = eocdRelOffset >= 20 && readUint32LE(tailView, eocdRelOffset - 20) === 0x07064b50` を判定する。
   - Locator 不在時は、マルチディスク値（`diskNumber !== 0 || cdDiskNumber !== 0 || diskEntries !== totalEntries`）および標準 EOCD 飽和値（`0xFFFF` / `0xFFFFFFFF`）をすべて `CORRUPT_ZIP` として拒否する。
   - Locator 存在時は、`locatorDiskNumber` (`+4`, uint32) `!== 0`・`totalDisks` (`+16`, uint32) `!== 1`・標準 EOCD 非飽和ディスク異常（`diskNumber !== 0xffff && diskNumber !== 0` 等）を `CORRUPT_ZIP` として拒否した上で、`zip64EocdOffset` (`+8`, uint64) を `readSafeUint64`（`> BigInt(Number.MAX_SAFE_INTEGER)` なら `CORRUPT_ZIP`）で読み取る。
   - 事前境界検証として `zip64EocdOffset + 56 > eocdAbsoluteOffset - 20` の場合は即 `CORRUPT_ZIP` とし、`zip64EocdOffset >= tailStart` なら `tailBuf` 内から、`zip64EocdOffset < tailStart` なら追加 1 RTT `reader.readRange(zip64EocdOffset, 56, signal)` で読み取る。
   - ZIP64 EOCD シグネチャ `0x06064b50`、サイズフィールド `sizeOfZip64Eocd >= 44`（`+4`, uint64）、`diskNumber === 0`、`cdDiskNumber === 0`、`diskEntries === totalEntries`、`cdOffset + cdSize <= zip64EocdOffset`、および全 64bit 値が安全整数範囲内であることを検証する。
   - OOM / 無限ループ防御として `totalEntries * 46 > cdSize` の場合は即 `CORRUPT_ZIP` を送出する。
2. **CDH Extra Field（`0x0001`）の全エントリ先行解決 ＆ マルチディスク拒否**:
   - 全 CDH エントリに対し、`physicalOffsets.push(...)` および `isJunkOrNonImageEntry(...)` の **前** に `diskStartNumber` チェックおよび Extra Field TLV 走査を実施する（非画像エントリの `localHeaderOffset` も `0xFFFFFFFF` 飽和し得るため）。
   - 非飽和時を含め `diskStartNumber !== 0`（`diskStartNumber !== 0xffff && diskStartNumber !== 0`、および `0x0001` 内 `diskStartNumber !== 0`）はすべてマルチディスク ZIP として `CORRUPT_ZIP` で拒否する。
   - `uncompressedSize === 0xFFFFFFFF` / `compressedSize === 0xFFFFFFFF` / `localHeaderOffset === 0xFFFFFFFF` / `diskStartNumber === 0xFFFF` のいずれかが飽和している場合、Extra Field 内の Header ID `0x0001` ブロックを探索し、飽和項目のみ **PKWARE APPNOTE 順（`uncompressedSize` 8B → `compressedSize` 8B → `localHeaderOffset` 8B → `diskStartNumber` 4B）** で読み取り、不足・`0x0001` 不在・安全整数超過・`diskStartNumber !== 0` はすべて `CORRUPT_ZIP` とする。
3. **`ZIP64_NOT_SUPPORTED` 撤去**:
   - `ZipErrorCode`（`src/engine/types.ts`）、`comlinkErrorHandler.ts`、`ReaderPage.tsx`、`readerErrors.ts` から `ZIP64_NOT_SUPPORTED` を削除する。

### 3.2 Shift_JIS（CP932）デコード ＆ セグメント自然順ソート（`AC-ENG-03`, `AC-ENG-10`）

1. **GPBF Bit 11 (`0x0800`) に基づく文字コード判定**:
   - `(flags & 0x0800) !== 0`: `new TextDecoder("utf-8", { fatal: false }).decode(nameBytes)` で確定。
   - `(flags & 0x0800) === 0`: まず `new TextDecoder("utf-8", { fatal: true }).decode(nameBytes)` を試行し、`TypeError`（不正 UTF-8 バイト列）発生時のみ `new TextDecoder("shift-jis", { fatal: false }).decode(nameBytes)`（CP932）へフォールバックする。
   - `entryNameByteLength` は LFH 1 RTT 取得長算出のため生バイト長 `fileNameLength` を維持する。
2. **セグメント単位自然順ソート**:
   - `entryName.split(/[\\/]/)` でパスセグメント配列へ分割し、先頭セグメントから順に `new Intl.Collator("ja", { numeric: true, sensitivity: "base" }).compare(segA, segB)` で比較（共通接頭辞が同値ならセグメント数が少ない方を先）する。

### 3.3 `HO-03`（前半）`readCompressedPageSlice` コピー削減（`AC-ENG-05`, `AC-ENG-10`）

- **1 RTT 経路（`dataEnd <= initialBuf.byteLength`）**: `initialBuf.subarray(dataStart, dataEnd)` のゼロコピービューを返却する。
- **2 RTT 経路（`dataEnd > initialBuf.byteLength`）**:
  - **ケース 2a（`dataStart < initialBuf.byteLength`：`initialBuf` に圧縮本体先頭を含む）**: 未取得の末尾差分 `[entry.localHeaderOffset + initialBuf.byteLength, entry.compressedSize - (initialBuf.byteLength - dataStart)]` を `readRange` で取得し、`new Uint8Array(entry.compressedSize)` を直接確保して先頭に `initialBuf.subarray(dataStart)`・後続に `tailSlice` をコピーした `byteOffset === 0` の独立バッファを返却する。
  - **ケース 2b（`dataStart >= initialBuf.byteLength`：LFH `extraField` が `compressedSize + 1KB` を上回り `initialBuf` が圧縮本体を含まない）**: `reader.readRange(entry.localHeaderOffset + dataStart, entry.compressedSize, signal)` で圧縮本体のみを直接 1 回追加取得して返却する（`initialBuf` との結合・余剰コピーを行わず `RangeError` も防止する）。

### 3.4 Dexie.js `version(2)` ＆ `ZipIndexCacheRepository` ＆ `ReaderPage` 0RTT 統合（`AC-ENG-11`）

1. **Dexie `version(2)`（`src/storage/db.ts`, `src/storage/types.ts`）**:
   - `version(2).stores({ syncMeta: "key", zipIndexCache: "cacheKey, cachedAt", readingProgress: "targetKey, volumeId, readStatus, lastReadAt, updatedAt" })` を定義する。
   - `ZipIndexCacheRecord`・`ReadingProgressRecord`・`ReadStatus` 型を `src/storage/types.ts` に追加する。
2. **`ZipIndexCacheRepository` ＆ 共有検証（`src/storage/repositories/zipIndexCacheRepository.ts`, `src/engine/zip/zipIndexValidation.ts`）**:
   - `ZIP_INDEX_CACHE_MAX_ENTRIES = 500` を定義する。
   - `validateZipIndexEntries(entries, pageCount?)`: 非空配列・各要素の必須フィールド型・非負有限数値・`localHeaderOffset < physicalEnd` 等を検証する純粋関数を `src/engine/zip/zipIndexValidation.ts` に配置し、`ZipIndexCacheRepository` と `CoordinatorCore` の双方から利用する。
   - `get(cacheKey)`: レコード取得後、`entries.length === pageCount` および `validateZipIndexEntries(entries)` を実行。不正時は該当レコードを削除して `null` を返す。有効時は `cachedAt = Date.now()` を更新して `entries` を返す。
   - `put(cacheKey, entries)`: 空配列は無視し、`{ cacheKey, pageCount: entries.length, entries, cachedAt: Date.now() }` を保存した上で、総件数が `500` を超える場合は `cachedAt` 昇順で超過件数分を削除する。
   - `delete(cacheKey)`: 指定キーを削除する。
3. **`CoordinatorCore` / `ServiceProvider` / `ReaderPage` 統合**:
   - `CoordinatorCore.openArchive(source, cachedEntries, epoch)` 側でも `cachedEntries !== null && validateZipIndexEntries(cachedEntries)` を満たす場合のみ `fromIndexCache: true` で 0 RTT オープンし、空配列・不正キャッシュ時は `parseZipDirectory` へ透過フォールバックする（`fromIndexCache: false`）。
   - `ServiceContextValue`（`src/app/serviceContext.ts`）へ `zipIndexCacheRepo: ZipIndexCacheRepository` を追加し、`ServiceProvider` で `new DexieZipIndexCacheRepository(db)`（または DI 注入）を提供する（※`window.__exLibrisServices` のテスト用契約には不要フィールドを追加しない）。
   - `ReaderPage` はアーカイブオープン時に `zipIndexCacheRepo.get(source.indexCacheKey)` を試行（失敗時はログ記録して `null` 扱い）して `coordinator.api.openArchive(source, cachedEntries, openEpoch)` へ渡す。`!result.fromIndexCache` で成功した際は `zipIndexCacheRepo.put(source.indexCacheKey, result.entries)` を非ブロッキング保存（失敗時は警告ログのみ）する。

---

## 4. テスト計画（UT / VRT / IT）

| 層                                                 | テスト手法・対象                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 合格基準                                                    |
| :------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------- |
| **MK-1: ZIP Engine UT**                            | `zipBuilder.ts` に ZIP64 EOCD/Locator/`0x0001`/仮想 4GB 超オフセットシフト機能を追加し、`zipParser.test.ts` で ZIP64（128KB 内 / 超過 3RTT / `0x0001` 飽和組合せ / ゴミエントリ 4GB超 / `Number.MAX_SAFE_INTEGER` 超過 / Multi-disk / `totalEntries * 46 > cdSize`）、CP932（Bit 11 有無・UTF-8 strict 失敗時フォールバック・半角カナ/機種依存文字）、セグメント自然順、2RTT（ケース 2a `byteOffset === 0` 非二重コピー / ケース 2b `dataStart >= initialBuf.byteLength`）を検証（`errors.test.ts`, `comlinkErrorHandler.test.ts` 更新含む）                                                               | C0 / C1 / Functions / Lines **100%** PASS                   |
| **MK-2: Storage・Coordinator・Reader UI UT / VRT** | `db.test.ts`（`version(2)` 検証・`MultiTableTestDatabase` `version(3)` 調整・`resetTestDb`）、`zipIndexValidation.test.ts`、`zipIndexCacheRepository.test.ts`（`fake-indexeddb`: ヒット時 `cachedAt` LRU 更新、500件超過時最古削除、破損/空キャッシュ削除＋`null` フォールバック）、`CoordinatorCore.test.ts`（空配列・不正 `cachedEntries` 時の `parseZipDirectory` フォールバック検証）、`ServiceProvider.test.tsx`、`ReaderPage.test.tsx`（0RTT キャッシュヒット→`openArchive(source, cachedEntries)`、ミス時 `put` 保存、DB 例外時透過継続）、`readerErrors.test.ts`（`ZIP64_NOT_SUPPORTED` 削除整合） | C0 / C1 / Functions / Lines **100%** PASS ＆ VRT 62/62 PASS |
| **Step 4: Playwright IT (`SCN-02`)**               | `test/it/local-reader.spec.ts` に ①ZIP64 構造アーカイブ（Locator + EOCD64 + `0x0001`）閲覧、②CP932（Shift_JIS）日本語ファイル名アーカイブの自然順描画、③同一アーカイブ再オープン時の `zipIndexCache` 0RTT ヒット（IndexedDB 永続化確認）を追加し全シナリオ回帰実行                                                                                                                                                                                                                                                                                                                                         | 全 `SCN-01` / `SCN-02` **100% PASS**                        |

---

## 5. 実装 Sub-issue 分割計画（MK 2分割 ＋ 最終 IT）

1. **MK-1: ZIP64・CP932・セグメント自然順・`HO-03` 前半コピー削減（Engine 層）**:
   - 対象: `src/engine/types.ts`, `src/engine/zip/zipParser.ts`, `src/engine/workers/comlinkErrorHandler.ts`, `src/engine/zip/__fixtures__/zipBuilder.ts`, 各 `*.test.ts`
   - 完了条件: TDD（Red→Green→Refactor）、C0/C1 100%、Gate 1〜6 完了後に AI 自律マージ（`Closes #Sub-issue`）
2. **MK-2: Dexie `version(2)`・`ZipIndexCacheRepository`・`CoordinatorCore` / `ServiceProvider` / `ReaderPage` 0RTT 統合（Storage・Worker & UI 層）**:
   - 対象: `src/storage/types.ts`, `src/storage/db.ts`, `src/engine/zip/zipIndexValidation.ts`, `src/storage/repositories/zipIndexCacheRepository.ts`, `src/engine/workers/CoordinatorCore.ts`, `src/app/serviceContext.ts`, `src/app/ServiceProvider.tsx`, `src/features/reader/ReaderPage.tsx`, `src/features/reader/readerErrors.ts`, 各 `*.test.*`
   - 完了条件: TDD（Red→Green→Refactor）、親子分離、C0/C1 100%、VRT PASS、Gate 1〜6 完了後に AI 自律マージ（`Closes #Sub-issue`）
3. **Step 4 (IT PR): Playwright `SCN-02` 拡充・差分仕様アーカイブ（`Closes #19`）**:
   - 対象: `test/it/helpers.ts`, `test/it/local-reader.spec.ts`, 本差分仕様書の `Completed (Archived)` 化 ＆ `docs/specs/changes/archive/` 移動
   - 完了条件: 全 IT PASS、Gate 1〜6 完了後に **人間レビュー・マージ** で親 Issue `#19` をクローズ

---

## 6. 申し送り事項・Android 実機検証計画

- **判定（[workflow.md §2.2](../../guidelines/workflow.md#22-android-実機検証の実施判断基準と試験項目表フォーマット)）**: **区分 B（Milestone `v0.1` 完了前に一括実施）**
  - **根拠**: 純粋な TypeScript ZIP パーサー・Dexie.js IndexedDB Repository 変更のみであり、Android ネイティブ層・OAuth・WebGL2 シェーダー・物理ジェスチャー操作の変更を含まないため。
- **登録済み申し送り**: `HO-05`（[bug-and-handover-log.md](../../quality/bug-and-handover-log.md) 登録済み、状態: `Open`、完了ゲート: `Milestone v0.1 完了前`）
- **Milestone `v0.1` 完了時の一括実機確認観点（`HO-05`）**:
  1. Shift_JIS（CP932）日本語ファイル名を含む `.zip`/`.cbz` を Android SAF から開き、文字化け・エラー停止せず自然なページ順で描画されること。
  2. ZIP64 形式（または 4GB 超構造）アーカイブを開いた際にエラーにならず閲覧できること。
  3. 同じローカルアーカイブを閉じて再度開いた際、2 回目が即座に開く（`zipIndexCache` 0RTT 動作）こと。
