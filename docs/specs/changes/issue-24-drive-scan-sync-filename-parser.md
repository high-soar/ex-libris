---
type: spec-delta
title: "Issue #24 差分仕様: 指定フォルダ Drive スキャン・changes差分同期・ファイル名パーサー・Dexie v3 DB"
description: "自炊ファイル名スマートパーサー（src/providers/filename/）、Series/Volumes/DriveSyncMeta Repository（Dexie version(3)）、共通 Drive JSON HTTP ヘルパ（429/403 指数バックオフ付き）、および指定ルート限定 BFS フルスキャン＆changes.list 増分差分同期エンジンを定義する差分仕様"
status: "Review (#24)"
updated: "2026-11-25"
issue: "#24"
tags:
  [
    delta,
    v0.2,
    google-drive,
    drive-sync,
    changes-api,
    filename-parser,
    dexie,
    lww-sync,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/features/settings.md
  - docs/specs/providers/google-drive.md
  - docs/specs/providers/filename-parser.md
  - docs/guidelines/workflow.md
  - docs/guidelines/testing.md
  - docs/quality/bug-and-handover-log.md
related_tests:
  - src/app/ServiceProvider.test.tsx
  - src/app/serviceContext.test.ts
  - src/providers/gdrive/googleDriveFolderClient.test.ts
  - src/storage/db.test.ts
  - src/storage/repositories/driveSyncRootsRepository.test.ts
  - src/storage/repositories/zipIndexCacheRepository.test.ts
---

# Issue #24 差分仕様: 指定フォルダ Drive スキャン・`changes.list` 差分同期・ファイル名パーサー・Dexie v3 DB

## 1. 背景・目的（Why）

- Milestone `v0.2`（Google Drive 連携 ＆ 最小仮想本棚：日常実用 MVP）の第 2 弾として、Google Drive 上の物理フォルダ構造から独立した高速な「仮想本棚」のデータ基盤を構築する。
- すでに `#23` で導入済みの `GoogleAuthBridge`（Single-Flight）・Dexie `version(3)` テーブル定義（`driveSyncRoots`, `series`, `volumes`）・`DriveSyncRootsRepository` を土台とし、**① 自炊ファイル名スマートパーサー**、**② `Series` / `Volumes` / `DriveSyncMeta` Repository**、および **③ 指定ルートフォルダ配下限定 BFS フルスキャン ＆ `changes.list` 増分差分同期エンジン** を純粋 TypeScript / IndexedDB 層として完成させる。

### 1.1 Step 1 合意事項（`/grill-me` 確定内容：Q1〜Q8）

1. **スコープ境界と進行順序（Q1）**:
   - `#24` は UI 変更を含めず **純粋ロジック・Storage・DI 層**（ファイル名パーサー・Repository・Drive 同期エンジン・モック・Playwright IT `SCN-04`）に専念し、`SCR-01` / `SCR-04` の同期ボタン・進捗表示 UI はすべて `#25`（`[v0.2][3/4]`）へ集約する。
   - PR `#82` マージ後の最新 `main`（`9a38e79`）を起点に進行する。
2. **Drive スキャン ＆ `changes.list` 探索アルゴリズム（Q2）**:
   - フルスキャン**開始前**に `changes.getStartPageToken()` を取得し、有効な `driveSyncRoots`（`enabled === 1 && deletedAt === null`）を起点とする **バッチ BFS**（最大 20 親 ID 束ね・循環防止セット）で配下フォルダ木を構築する。
   - MIME 揺れ（`.cbz` が `application/octet-stream` 等になるケース）を取りこぼさないよう、`files.list` で非フォルダ項目を取得した上で JS 側で `/\.(zip|cbz)$/i` を厳密判定する。
   - `driveStartPageToken` 未保持、`changes.list` の `410 TOKEN_EXPIRED`、または `syncMeta['syncedRootFolderIds']` に無い新規／再有効化ルート検出時は自動でフルスキャンへ切り替える。`changes.list` 処理中に未知の `parentFolderId` を検出した場合は `getFileMetadata()` で親方向へ遡り（メモ化キャッシュ＋最大深度・循環ガード）有効ルート帰属を判定する。
3. **ルート無効化・ゴミ箱・ファイル上書き時の DB 遷移（Q3）**:
   - Drive 上の削除・ゴミ箱・有効ルート外移動は `volumes.isTrashed = 1` に更新する。
   - `SCR-04` でのルート一時無効化（`enabled = 0`）や解除（`deletedAt !== null`）時は既存 `volumes` や `coverBlob` を破壊せず、本棚クエリ（`listVisibleByEnabledRoots`）側で「有効ルート所属 かつ `isTrashed === 0`」をフィルタする。
   - 同一 `driveFileId` の `md5Checksum` または `fileSize` 変化時は、旧キー `gdrive:${driveFileId}:${prev.md5Checksum ?? prev.fileSize}` の `zipIndexCache` を即時削除し、`coverBlob = null` / `coverStatus = "pending"` / `coverUpdatedAt = null` へリセットする。同期処理全体を通じて既存 `series.updatedAt` / `volumes.updatedAt` は一切更新しない（LWW 非汚染）。
4. **Drive リネーム・移動追従と空シリーズの扱い（Q4）**:
   - 同期済みファイルの `rawFileName` または `parentFolderId` が変化した場合、手動編集未実施（`series.metadataLocked === false && volume.updatedAt === volume.addedAt`）であれば新ファイル名・新親フォルダ名で再パースして `seriesId`・`volumeNumber`・`volumeLabel` を自動追従する。手動ロック／編集済みの場合は物理属性のみ更新する。
   - 有効表示巻が 0 冊になった `series` レコードは物理削除せず DB 上に保持し、本棚一覧クエリから除外する。
5. **シリーズ名寄せキー・著者補完・親フォルダ名フォールバック（Q5）**:
   - シリーズ名寄せキーは `NFKC` 正規化＋記号/空白正規化＋ASCII 小文字化による **正規化タイトル単独キー（`normalizedTitleKey`）** とし、未ロック `series` には後続巻の抽出著者を重複排除マージする。
   - ファイル名からタイトルが空になる場合（`01.cbz` 等）は、親フォルダが `driveSyncRoots` 直下でないサブフォルダ（`isParentSyncRoot !== true`）のときのみ親フォルダ名からタイトル・著者を補完する。
6. **巻数（単巻・小数・合本・上下巻・単発本）と `titleReading` 規則（Q6）**:
   - 単巻・小数巻は数値（`1`, `10.5` 等）＋ `"第01巻"`（`特装版`・`限定版` 等の付記保持）、合本範囲（`01-05巻`）は開始巻数（`1`）＋ `"第01-05巻 合本"`、上下巻・前後編は Unicode 逆転防止のため `1/2/3` を割り当て、巻数なし単発本は `volumeNumber = null, volumeLabel = "単巻"` とする。
   - `titleReading` 初期値は `NFKC` ＋ カタカナ→ひらがな変換 ＋ 英数字小文字化で生成する。
7. **レート制限リトライ・排他ロック・トークン原子性（Q7）**:
   - `DriveSyncEngine` は内部排他ロックで多重 `sync()` を直列化する。
   - `429` / `403 (rateLimitExceeded / userRateLimitExceeded)` 時は最大 3 回の指数バックオフ（`500ms → 1000ms → 2000ms`、`sleepFn` 注入可能）で自動リトライする。
   - 途中ページ失敗・`AbortError` 時は `driveStartPageToken` を一切進めず、全ページ取得と Dexie 反映完了後にのみトークン・最終同期時刻・同期済みルート ID 群を原子保存する。
8. **仕様書分割・Sub-issue 粒度・実機検証区分（Q8）**:
   - 正本仕様書として [filename-parser.md](../providers/filename-parser.md) を新設分離し、実装は **3 MK（MK-1: ファイル名パーサー / MK-2: Storage Repositories / MK-3: Drive 同期エンジン＆DI）＋ Step 4 IT（`SCN-04`）** の 4 分割とする。
   - 実機検証は **区分 B（`Milestone v0.2 完了前`：`HO-12` として `#25` 実機検証時にあわせて実施）** とする。

### 1.2 対象外スコープ

- Google OAuth・`GoogleDriveRangeReader`・`SCR-04` ルート管理 UI（→ `#23` 完了済み）
- `SCR-01` 本棚グリッド・`SCR-02` シリーズ詳細・`SCR-04` 手動同期ボタン/進捗 UI・`/read/volume/:volumeId` リーダー統合（→ `#25` `[v0.2][3/4]`）
- 2段優先度・表紙 WebP 自動抽出スケジューラ（→ `#26` `[v0.2][4/4]`）
- 公開書誌 API（NDL サーチ / AniList / Google Books）による精密読み仮名・書誌補完（→ `v0.3`）

---

## 2. 新規作成・変更対象の App 全体正本一覧

|   種別   | 正本ファイル                                                     | 変更概要                                                                                                                                              |
| :------: | :--------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **新規** | [filename-parser.md](../providers/filename-parser.md)            | 自炊ファイル名スマートパーサーの型契約・正規化/初期読み仮名・ノイズ/著者/巻数/合本/上下巻/親フォルダ補完ルール・`AC-FP-01`〜`06` を新設               |
| **更新** | [google-drive.md](../providers/google-drive.md)                  | `driveHttpClient` 共通化（`TOKEN_EXPIRED`・429/403 指数バックオフ）、`DriveSyncClient`/`DriveSyncEngine`/`MockDriveSyncClient` 仕様、`AC-GD-09`〜`14` |
| **更新** | [db-schema.md](../db-schema.md)                                  | `DriveSyncMetaRepository`（`syncMeta` 同期キー群）、`SeriesRepository`、`VolumesRepository` の FIFO 直列化・有効ルートフィルタ・LWW 保護契約を追記    |
| **更新** | [architecture.md](../architecture.md)                            | Layer 1/3/4 責務表へファイル名パーサー・Drive 同期エンジン・新設 Repository 群・`ServiceProvider` DI 契約を反映                                       |
| **更新** | [requirements.md](../requirements.md)                            | `related_specs` へ `docs/specs/providers/filename-parser.md` を双方向同期                                                                             |
| **更新** | [screen-transitions.md](../screen-transitions.md)                | `SCR-04` 同期 UI の `#25` 担当を明確化し、結合テストシナリオ **`SCN-04`**（`test/it/drive-sync.spec.ts`）を追加                                       |
| **更新** | [settings.md](../features/settings.md)                           | 冒頭 NOTE にて同期実行 UI トリガーが `#25` 担当であることを明確化                                                                                     |
| **更新** | [bug-and-handover-log.md](../../quality/bug-and-handover-log.md) | 区分 B 実機検証申し送り **`HO-12`**（完了ゲート: `Milestone v0.2 完了前`、`#25` 実機検証時に併設確認）を登録                                          |

---

## 3. 追加・変更する仕様の差分詳細

### 3.1 自炊ファイル名スマートパーサー（MK-1）

- `src/providers/filename/types.ts`: `ParseMangaFilenameInput`, `ParsedMangaFilename`
- `src/providers/filename/textNormalization.ts`: `normalizeSeriesTitleKey`, `generateInitialTitleReading`
- `src/providers/filename/mangaFilenameParser.ts`: `parseMangaFilename`（拡張子除去・ノイズ括弧除去・版付記抽出・先頭著者タグ分割・合本/単巻/小数/上下前後編/末尾数値/単発本解析・非ルート親フォルダ名補完・非空タイトル保証）

### 3.2 Dexie `version(3)` Storage Repositories（MK-2）

- `src/storage/repositories/driveSyncMetaRepository.ts`: `DriveSyncMetaRepository` / `DexieDriveSyncMetaRepository`（`getSyncState`, `saveSyncState`, `clearSyncState`、破損 JSON / 非有限数値の自己修復、単一 `rw` トランザクション原子保存）
- `src/storage/repositories/seriesRepository.ts`: `SeriesRepository` / `DexieSeriesRepository`（FIFO 直列化、`getById`, `listActive`, `findOrCreateByParsedTitle`, `mergeAuthorsIfUnlocked`, `updateLastReadAt`、正規化タイトル名寄せ、`updatedAt` 非汚染）
- `src/storage/repositories/volumesRepository.ts`: `VolumesRepository` / `DexieVolumesRepository`（FIFO 直列化、`getById`, `getByDriveFileId`, `listBySeriesId`, `listVisibleByEnabledRoots`, `listByRootFolderIds`, `upsertFromDriveSync`, `markTrashedByDriveFileIds`、決定論ソート、`md5Checksum`/`fileSize` 変化時の `invalidatedCacheKey` 返却＆表紙リセット、`updatedAt` 非汚染）

### 3.3 Drive スキャン・`changes.list` 差分同期エンジン ＆ `ServiceProvider` DI 配線（MK-3）

- `src/providers/gdrive/driveHttpClient.ts`: 既存 `GoogleDriveFolderClient` 内の通信・401 Compare-and-Refresh・エラー分類ロジックを抽出し、`TOKEN_EXPIRED`（`410` 等）および 429/403 指数バックオフ（最大 3 回、`sleepFn` 注入）をサポート。`GoogleDriveFolderClient` も本共通ヘルパを利用するようリファクタする。
- `src/providers/gdrive/googleDriveSyncClient.ts`: `DriveSyncClient` 本番実装（`getStartPageToken`, `listItemsInParents`, `getFileMetadata`, `listChanges`）。
- `src/providers/gdrive/mockDriveSyncClient.ts`: `DriveSyncClient` 決定論モック実装（初期サンプルファイル木・ページネーション・変更イベント投入・410 失効シミュレーション・ルート外ファイル混入テスト用フック付き）。
- `src/providers/gdrive/driveSyncEngine.ts`: `DefaultDriveSyncEngine`（排他ロック・有効ルート 0 件早期リターン・BFS フルスキャン・`changes.list` 増分同期・未知親フォルダ遡り・ファイル名パース/再パース・`ZipIndexCacheRepository.delete` 連携・トークン原子保存）。
- `src/app/serviceContext.ts` / `src/app/ServiceProvider.tsx` / `src/types.ts`: `seriesRepo`, `volumesRepo`, `driveSyncMetaRepo`, `driveSyncClient`, `driveSyncEngine` を DI コンテナへ追加し、`shouldExposeResetTestDb()` ガード下でのみ `window.__exLibrisServices` へテスト用ハンドル（`driveSyncEngine`, `seriesRepo`, `volumesRepo`, `driveSyncMetaRepo`, `mockDriveSyncClient`）を公開する。

### 3.4 Playwright IT `SCN-04` ＆ 差分仕様アーカイブ（Step 4 IT）

- `test/it/drive-sync.spec.ts`（`SCN-04`）を新設し、実ブラウザ IndexedDB 上で `SCR-04` ルート登録 → フルスキャン → `changes.list` 差分同期（追加・リネーム追従・ゴミ箱/ルート外移動・MD5 変化による `zipIndexCache` 削除＆表紙リセット・`410` フルスキャン復帰）→ ルート無効化/再有効化 → リロード永続化を一貫検証する。
- 完了時に本差分仕様を `Completed (Archived)` として `docs/specs/changes/archive/issue-24-drive-scan-sync-filename-parser.md` へ移動し、関連正本の `related_tests`・`status` を更新する。

---

## 4. テスト計画（UT / IT）

| 層                                   | テスト手法・対象                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 合格基準                                               |
| :----------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------- |
| **MK-1: ファイル名パーサー**         | `textNormalization.test.ts`（NFKC・波ダッシュ/ハイフン・カタカナ→ひらがな・英小文字化）、`mangaFilenameParser.test.ts`（商業誌/同人誌/複数著者/ノイズ除去/小数巻/版付記/合本範囲/不正範囲/上下前後編/末尾数値/西暦除外/単発本/サブフォルダ補完 vs ルート直下非補完/空文字境界）                                                                                                                                                                                                                                                                                                | C0 / C1 / Functions / Lines **100%** PASS              |
| **MK-2: Storage Repositories**       | `driveSyncMetaRepository.test.ts`（原子保存・破損 JSON/非数値自動修復）、`seriesRepository.test.ts`（FIFO 直列化・名寄せ・未ロック著者マージ・ロック保護・`updatedAt` 非汚染・破損除外）、`volumesRepository.test.ts`（FIFO 直列化・単巻/合本/上下巻/単発ソート・有効ルートフィルタ・`isTrashed` 更新・MD5/サイズ変化時 `invalidatedCacheKey` ＆表紙リセット・`updatedAt` 非汚染）                                                                                                                                                                                             | C0 / C1 / Functions / Lines **100%** PASS              |
| **MK-3: Drive 同期エンジン ＆ DI**   | `driveHttpClient.test.ts`（401 Compare-and-Refresh・429/403 最大 3 回指数バックオフ・`410 TOKEN_EXPIRED`・`AbortError` 非ログ）、`googleDriveSyncClient.test.ts`（各 REST クエリ・ページング・404 `null` 返却・不正 JSON 拒否）、`mockDriveSyncClient.test.ts`、`driveSyncEngine.test.ts`（排他ロック・有効ルート 0 件・多段 BFS・循環ガード・対象外除外・`changes.list` 未知親遡り・リネーム再パース vs ロック保護・MD5 キャッシュ削除・`410` フォールバック・新規ルート追加時フルスキャン・途中失敗時トークン非更新）、`ServiceProvider.test.tsx` / `serviceContext.test.ts` | C0 / C1 / Functions / Lines **100%** PASS              |
| **Step 4: Playwright IT (`SCN-04`)** | `test/it/drive-sync.spec.ts` ＋ 既存 `SCN-01`〜`SCN-03` 全件回帰（UI 変更なしのため VRT スナップショット変更なし・既存 VRT 全件 PASS 確認）                                                                                                                                                                                                                                                                                                                                                                                                                                    | 全 UT 100% / VRT PASS / 全 Playwright IT **100% PASS** |

---

## 5. Sub-issue 分割計画・申し送り事項・Android 実機検証計画

### 5.1 Sub-issue 分割計画（設計 PR マージ後に起票）

1. **Sub-issue ①（MK-1）: 自炊ファイル名スマートパーサー（`src/providers/filename/`）実装 ＆ 100% 単体テスト**
   - 対象: `src/providers/filename/{types,textNormalization,mangaFilenameParser}.ts` および 1対1 単体テスト
2. **Sub-issue ②（MK-2）: Dexie `version(3)` Repositories（`DriveSyncMetaRepository` / `SeriesRepository` / `VolumesRepository`）実装 ＆ 100% 単体テスト**
   - 対象: `src/storage/repositories/{driveSyncMetaRepository,seriesRepository,volumesRepository}.ts` および 1対1 単体テスト
3. **Sub-issue ③（MK-3）: 共通 `driveHttpClient`・`GoogleDriveSyncClient` / `MockDriveSyncClient`・`DriveSyncEngine` ＆ `ServiceProvider` DI 統合**
   - 対象: `src/providers/gdrive/{types,driveApiErrors,driveHttpClient,googleDriveFolderClient,googleDriveSyncClient,mockDriveSyncClient,driveSyncEngine}.ts`, `src/app/{serviceContext,ServiceProvider}.ts(x)`, `src/types.ts` および全 1対1 単体テスト
4. **Sub-issue ④（Step 4 IT）: Playwright `SCN-04`（`test/it/drive-sync.spec.ts`）結合検証・仕様アーカイブ（`Closes #24`）**
   - 対象: `test/it/drive-sync.spec.ts`, 関連正本の `related_tests` / `status` 同期, 本差分仕様の `docs/specs/changes/archive/` 移動

### 5.2 Android 実機検証計画 ＆ 申し送り事項（`HO-12`）

- **実施粒度判定（[workflow.md §2.2](../../guidelines/workflow.md#22-android-実機検証の実施判断基準と試験項目表フォーマット)）**: **区分 B（Milestone `v0.2` 完了前：一括実施）**
  - **根拠**: `#24` は Android ネイティブ層・WebGL2 シェーダー・新規 UI 変更を含まない純粋 TypeScript / Dexie 層であるため、Vitest 100% カバレッジおよび Playwright 実ブラウザ IndexedDB 結合テスト（`SCN-04`）で仕様を完全に担保できる。実 Google Drive アカウントを用いたフルスキャン・`changes.list` 増分同期・シリーズ束ね・診断ログ秘匿の実機確認は、同期 UI トリガーと本棚表示を統合する `#25` の実機検証（`HO-10` 併設）および `Milestone v0.2` 完了前ゲート（`HO-12`）にて一括検証する。
- **登録済み申し送り**: `HO-12`（[bug-and-handover-log.md §3](../../quality/bug-and-handover-log.md#3-申し送り事項追跡一覧handover-items-ho-xx)、完了ゲート: `Milestone v0.2 完了前`）
