---
type: spec-db-schema
title: "Dexie.js（IndexedDB）ローカルDBスキーマ・インデックス定義"
description: "仮想本棚、指定ルートフォルダ同期、ZIP目次キャッシュ、ローカル一時ZIP共用レジューム、および appDataFolder LWW 端末間同期を支える全9テーブル定義の正本"
status: "Review (#24)"
updated: "2026-11-25"
tags:
  [database, dexie, indexeddb, schema, bookshelf, lww-sync, reading-progress]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/zip-streaming.md
  - docs/specs/features/bookshelf.md
  - docs/specs/features/reader.md
  - docs/specs/features/settings.md
  - docs/specs/providers/google-drive.md
  - docs/specs/providers/filename-parser.md
  - docs/guidelines/testing.md
related_tests:
  - src/app/ServiceProvider.test.tsx
  - src/storage/db.test.ts
  - src/storage/repositories/zipIndexCacheRepository.test.ts
  - src/storage/repositories/readingProgressRepository.test.ts
  - src/storage/repositories/readerSettingsRepository.test.ts
  - src/storage/repositories/driveSyncRootsRepository.test.ts
  - src/engine/zip/zipIndexValidation.test.ts
  - src/features/bookshelf/BookshelfPage.test.tsx
  - src/features/reader/ReaderPage.test.tsx
  - test/it/local-reader.spec.ts
---

# ExLibris Dexie.js（IndexedDB）ローカルDBスキーマ定義

本ドキュメントは、ExLibris のローカルデータベース（`ExLibrisDB` / Dexie.js）における設計原則、名前空間識別規約、LWW（Last-Write-Wins）タイムスタンプ保護規約、および `v1.0` までを見据えた全 9 テーブル・インデックス定義の正本（Single Source of Truth）です。

---

## 1. データベース設計 5 原則

1. **物理ストレージ非依存のローカル完結検索（10ms 台応答）**:
   本棚一覧・五十音ソート・複合フィルタ・インクリメンタル検索は 100% IndexedDB（Dexie.js）上で完結させ、普段のブラウジングでは Google Drive API へ一切アクセスしない。
2. **指定ルートフォルダ配下限定同期と不変 `driveFileId` 管理**:
   `driveSyncRoots` テーブルに登録された「マンガ保管ルートフォルダ」の子孫にある `.zip` / `.cbz` のみを仮想本棚（`series` / `volumes`）へ取り込み、無関係な業務・バックアップ ZIP の混入を防ぐ。フォルダ移動・リネームが起きても不変である `driveFileId` と `changes.list` の `driveStartPageToken` で差分追従する。
3. **端末ローカル一時 ZIP の「本棚非汚染 ＋ 目次・進捗永続共有」設計**:
   ブラウザ / WebView の制約により再起動後に `File` 参照が失効する端末ローカル ZIP は、`series` / `volumes` には登録せず本棚を汚さない。一方、`zipIndexCache` と `readingProgress` の主キーには名前空間付き識別子（`local:${rawFileName}:${fileSize}`）を用い、同じローカル ZIP を再度開いた際は **0 RTT 目次キャッシュと前回ページの自動レジュームがそのまま機能する** 構造とする。
4. **LWW 端末間同期（`appDataFolder`）のためのタイムスタンプ完全分離**:
   ユーザーが明示的に編集・操作した論理更新時刻 `updatedAt`（UNIX ms）および論理削除時刻 `deletedAt`（Tombstone）と、バックグラウンド処理が更新する内部キャッシュ時刻（`coverUpdatedAt`, `cachedAt` 等）を別カラムへ完全分離する。表紙 WebP 生成や Drive ファイルスキャンでユーザーの `updatedAt` を汚染してはならない。
5. **加算的スキーマ進化と `resetTestDb()` によるテスト決定論性**:
   Milestone 進行に伴うテーブル新設・インデックス追加は Dexie の `this.version(N).stores(...)` を加算的に積み上げて既存データを保護し、UT / Storybook / Playwright IT では共通ヘルパー `resetTestDb()` で全テーブルを決定論的に初期化する。

---

## 2. ER 図とテーブル全体構成（全 9 テーブル）

```mermaid
erDiagram
    DRIVE_SYNC_ROOTS ||--o{ VOLUMES : "rootFolderId (同期対象境界)"
    SERIES ||--o{ VOLUMES : "seriesId (1対多)"
    COLLECTIONS ||--o{ SERIES_COLLECTIONS : "collectionId"
    SERIES ||--o{ SERIES_COLLECTIONS : "seriesId"
    VOLUMES ||--o| ZIP_INDEX_CACHE : "gdrive:fileId:md5"
    VOLUMES ||--o| READING_PROGRESS : "vol:volumeId"
    VOLUMES ||--o{ BOOKMARKS : "volumeId"
    SYNC_META }o--|| DRIVE_SYNC_ROOTS : "driveStartPageToken 等"
```

|  #  | テーブル名              | 主キー・インデックス定義（Dexie `stores` 記法）                                                                                |    導入時期    |                   `appDataFolder` 同期対象                   |
| :-: | :---------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :------------: | :----------------------------------------------------------: |
|  1  | **`syncMeta`**          | `"key"`                                                                                                                        | `Phase 1` (済) |                    ローカル固有（対象外）                    |
|  2  | **`zipIndexCache`**     | `"cacheKey, cachedAt"`                                                                                                         |     `v0.1`     |                     キャッシュ（対象外）                     |
|  3  | **`readingProgress`**   | `"targetKey, volumeId, readStatus, lastReadAt, updatedAt"`                                                                     |     `v0.1`     |        **`vol:*` のみ同期対象**（`local:*` は対象外）        |
|  4  | **`driveSyncRoots`**    | `"folderId, enabled, updatedAt, deletedAt"`                                                                                    |     `v0.2`     |                     **同期対象（LWW）**                      |
|  5  | **`series`**            | `"id, title, titleReading, *authors, publisher, label, *tags, publicationStatus, lastReadAt, addedAt, updatedAt, deletedAt"`   |     `v0.2`     |                     **同期対象（LWW）**                      |
|  6  | **`volumes`**           | `"id, seriesId, [seriesId+volumeNumber], &driveFileId, rootFolderId, md5Checksum, coverStatus, isTrashed, addedAt, updatedAt"` |     `v0.2`     | **メタ設定のみ同期対象**（`coverBlob` バイナリは各端末抽出） |
|  7  | **`collections`**       | `"id, kind, sortOrder, updatedAt, deletedAt"`                                                                                  |     `v0.3`     |                     **同期対象（LWW）**                      |
|  8  | **`seriesCollections`** | `"id, collectionId, seriesId, updatedAt, deletedAt"`                                                                           |     `v0.3`     |                     **同期対象（LWW）**                      |
|  9  | **`bookmarks`**         | `"id, volumeId, [volumeId+pageIndex], updatedAt, deletedAt"`                                                                   |     `v0.4`     |                     **同期対象（LWW）**                      |

---

## 3. 各テーブルの詳細カラム契約

### 3.1 `syncMeta`（同期トークン・端末ローカル制御メタ情報 / `Phase 1`〜）

| カラム名 | 型       | Indexed | 説明                                                                                                                               |
| :------- | :------- | :-----: | :--------------------------------------------------------------------------------------------------------------------------------- |
| `key`    | `string` | **PK**  | `'driveStartPageToken'` / `'lastDriveSyncAt'` / `'syncedRootFolderIds'` / `'lastAppDataSyncAt'` / `'defaultReaderSettingsJson'` 等 |
| `value`  | `string` |    -    | JSON 文字列またはトークン文字列                                                                                                    |

- **`'defaultReaderSettingsJson'` 保存・正規化契約（`ReaderSettingsRepository` / `v0.1`〜）**:
  - 保存形式は `{ version: 1, shader: ShaderCorrectionParams }` の JSON 文字列とする（将来の `v0.4` 拡張を見据えたバージョン付き構造）。
  - 取得時に未保存の場合は `DEFAULT_SHADER_CORRECTION_PARAMS`（`{ sharpness: 0, whitePoint: 1, blackPoint: 0, gamma: 1 }`）を返す。JSON パース失敗、ルート値が非プレーンオブジェクト（`null`・プリミティブ・配列）、または自前の `shader` プロパティ（`Object.prototype.hasOwnProperty.call` 判定）が存在するのに非プレーンオブジェクト（`null`・プリミティブ・配列）である場合は、破損レコードとして `syncMeta` から該当キーを削除して初期値へフォールバックし、プレーンオブジェクト内の部分欠落・範囲外数値は `normalizeShaderCorrectionParams` で許容範囲へクランプ・正規化する。
- **Google Drive 同期メタ契約（`DriveSyncMetaRepository` / `src/storage/repositories/driveSyncMetaRepository.ts` / `v0.2 [2/4]`〜）**:
  - `'driveStartPageToken'`: 非空トークン文字列（未保存・空白のみの場合は `null`）。
  - `'lastDriveSyncAt'`: 有限 UNIX ms 数値の文字列表現（非数値・破損時はキーを削除して `null` へフォールバック）。
  - `'syncedRootFolderIds'`: 同期完了済みの `driveSyncRoots.folderId` 配列の JSON 文字列（JSON 破損・非配列・空要素混入時はキーを削除して `[]` へフォールバックし、次回同期で安全にフルスキャンを誘発する）。
  - 内部 Promise キューで FIFO 直列実行し、`saveSyncState({ startPageToken, lastDriveSyncAt, syncedRootFolderIds })` は 3 キーを単一 `rw` トランザクションで原子保存する。

### 3.2 `zipIndexCache`（ZIP Central Directory 解析済み目次キャッシュ / `v0.1`〜）

| カラム名    | 型               | Indexed | 説明                                                                                                                 |
| :---------- | :--------------- | :-----: | :------------------------------------------------------------------------------------------------------------------- |
| `cacheKey`  | `string`         | **PK**  | Drive 巻: `gdrive:${driveFileId}:${md5Checksum ?? fileSize}`<br>ローカル一時 ZIP: `local:${rawFileName}:${fileSize}` |
| `pageCount` | `number`         |    -    | ゴミ除外・自然順ソート後の総論理ページ数                                                                             |
| `entries`   | `ZipPageEntry[]` |    -    | 各ページのオフセット・圧縮方式・サイズ配列（2回目以降 0 RTT オープン用）                                             |
| `cachedAt`  | `number`         |   Yes   | キャッシュ保存・最終参照日時（UNIX ms、古いエントリの整理用）                                                        |

- **LRU 容量上限・整理ポリシー**: 最大保持件数は **500 件**（`ZIP_INDEX_CACHE_MAX_ENTRIES = 500`）。キャッシュヒット時（有効レコード検証後）に `cachedAt = Date.now()` を更新し、`put` 保存時に 500 件を超過した場合は `cachedAt` 昇順で最古の超過分を削除する。
- **破損／不整合キャッシュの自動修復**: 取得時に空配列・`pageCount !== entries.length`・必須フィールド欠落・非有限数値・`localHeaderOffset >= physicalEnd` 等の不整合を検出した場合は、該当レコードを即時削除して `null` を返し、`parseZipDirectory` へ透過フォールバックする。
- **ローカルキー維持とページ復号時 1 回限り自己修復フォールバック（`R1-06`）**: 端末ローカル一時 ZIP のキャッシュ識別キーは `local:${rawFileName}:${fileSize}` を維持し、同一セッション内で `fromIndexCache: true` オープン後のページ読込・デコード（`ReaderPage.fetchAndStorePages`）において `CORRUPT_ZIP` または `DECODE_FAILED` を検知した場合は、`ReaderPage` 側で同一セッション 1 回限り `zipIndexCacheRepo.delete(cacheKey)` → `cachedEntries = null` での `parseZipDirectory` 再解析と新 `entries` 保存（自己修復フォールバック）を実行する。

### 3.3 `readingProgress`（読書進捗・レジューム位置・既読状態 / `v0.1`〜）

| カラム名           | 型                                     | Indexed | 説明                                                                               |
| :----------------- | :------------------------------------- | :-----: | :--------------------------------------------------------------------------------- |
| `targetKey`        | `string`                               | **PK**  | Drive 巻: `vol:${volumeId}` / ローカル一時 ZIP: `local:${rawFileName}:${fileSize}` |
| `volumeId`         | `string \| null`                       |   Yes   | Drive 巻の場合は `volumes.id`、ローカル一時 ZIP の場合は `null`                    |
| `currentPageIndex` | `number`                               |    -    | 0 始まりの現在ページ番号                                                           |
| `totalPageCount`   | `number`                               |    -    | 総ページ数                                                                         |
| `readStatus`       | `'unread' \| 'reading' \| 'completed'` |   Yes   | 未読・読書中・読了ステータス                                                       |
| `spreadPageOffset` | `0 \| 1`                               |    -    | 見開き「1ページずらし」補正状態                                                    |
| `lastReadAt`       | `number`                               |   Yes   | 最終閲覧日時（UNIX ms）                                                            |
| `updatedAt`        | `number`                               |   Yes   | LWW 同期調停用タイムスタンプ（UNIX ms）                                            |

- **非同期操作の FIFO 直列化契約（`ReadingProgressRepository`）**:
  - `TR-08`（`popstate` 同一コミット遷移を含む）で fire-and-forget 発行される `put(...)` と直後の `SCR-01` マウント時 `listRecentLocal(10)` や即座の再オープン時 `get(targetKey)`、および連続ページ送り時の `put(...)` が競合して古い値を返したり順序逆転したりしないよう、Dexie 実装内部で全メソッド（`put` / `delete` / `clearLocal` / `get` / `listRecentLocal`）を Promise キューにより **FIFO 直列実行** する。
- **`local:*` 識別子の解析・容量上限・抽出クエリポリシー**:
  - `local:${rawFileName}:${fileSize}` はファイル名自体に `:` が含まれるケースを安全に扱えるよう、接頭辞 `"local:"` と末尾の `lastIndexOf(":")` で `rawFileName`（非空文字列）と `fileSize`（0 以上の安全整数 `/^\d+$/`）へ分離する。
  - ローカル一時 ZIP の進捗レコード（`targetKey` が `"local:"` で始まるもの）の最大保持件数は **100 件**（`LOCAL_READING_PROGRESS_MAX_ENTRIES = 100`）とし、`put` 保存時に `where("targetKey").startsWith("local:")` 件数が上限を超過した場合は `lastReadAt` 昇順（同値時は `targetKey` 昇順）で最古の `local:*` レコードのみを削除する。**`vol:*`（Google Drive 永続巻）レコードは LRU 退避の対象外とし一切削除しない**。
  - `SCR-01` の「最近のローカル閲覧履歴」表示（`listRecentLocal(limit = 10)`）では、`where("targetKey").startsWith("local:")` から有効なレコードのみを抽出し、`lastReadAt` 降順（同値時は `targetKey` 昇順の決定論的タイブレーク）で最大 `limit` 件（`limit <= 0` 時は `[]`）を返す（`clearLocal()` 実行時も `local:*` のみを削除し `vol:*` は保護する）。
- **破損／不整合レコード検証と寸法確定ベースの `readStatus` 判定**:
  - レコード妥当性条件：`totalPageCount` が 1 以上の `Number.isSafeInteger`、`currentPageIndex` が `0 <= currentPageIndex < totalPageCount` の `Number.isSafeInteger`、`lastReadAt` / `updatedAt` が有限数（`Number.isFinite`）、`readStatus` が `'unread' | 'reading' | 'completed'`、`spreadPageOffset` が `0 | 1`、かつ `targetKey` が `local:*` の場合は `parseLocalProgressTargetKey(targetKey) !== null && volumeId === null`、`vol:${id}` の場合は `id.length > 0 && volumeId === id` を満たすこと。`get(targetKey)` 時に不整合レコードを検出した場合は即時削除して `null` を返す。
  - リーダー閲覧中の保存時は、見開き第 2 スロット（`currentPageIndex + 1`）は `currentPageIndex` と `currentPageIndex + 1` の双方が `knownDimensions` 上で非横長（`width <= height`）と寸法確定している場合のみ表示済みとみなし（寸法未確定の `moveToPage` 直後やデコード完了前離脱時は `currentPageIndex` 単独基準）、確定表示最大ページ `confirmedMaxDisplayedPageIndex >= totalPageCount - 1` であれば `'completed'`、それより手前であれば `'reading'` として記録する。再オープン時はステータスにかかわらず保存済み `currentPageIndex`（実ページ数でクランプ）と `spreadPageOffset`（1 ページ本 `pageCount <= 1` 時は `0` へ正規化）から忠実にレジュームする。

### 3.4 `driveSyncRoots`（Google Drive 同期対象ルートフォルダ / `v0.2`〜）

| カラム名     | 型               | Indexed | 説明                                                                   |
| :----------- | :--------------- | :-----: | :--------------------------------------------------------------------- |
| `folderId`   | `string`         | **PK**  | Google Drive フォルダの不変 `fileId`                                   |
| `folderName` | `string`         |    -    | 表示用フォルダ名（例: `"Comics"`, `"自炊マンガ"`）                     |
| `enabled`    | `0 \| 1`         |   Yes   | 同期有効フラグ（IndexedDB 複合検索互換のため数値 `0 \| 1` に厳密統一） |
| `addedAt`    | `number`         |    -    | 登録日時（UNIX ms）                                                    |
| `updatedAt`  | `number`         |   Yes   | ユーザー設定更新日時（UNIX ms、LWW 同期用）                            |
| `deletedAt`  | `number \| null` |   Yes   | 登録解除時の論理削除日時（UNIX ms、Tombstone）                         |

- **`DriveSyncRootsRepository` 操作直列化・Tombstone ライフサイクル契約（`src/storage/repositories/driveSyncRootsRepository.ts` / `v0.2`〜）**:
  - **非同期操作の FIFO 直列化**: 連続した有効/無効切替・削除・再登録・`SCR-01` マウント時の有効件数参照が競合しないよう、内部 Promise キューで全メソッド（`listActive`, `countEnabled`, `upsertRoot`, `setEnabled`, `removeRoot`）を FIFO 直列実行する。
  - **レコード検証と正規化**: `folderId` および `folderName` は前後空白トリム後の非空文字列、`enabled` は `0 | 1`、`addedAt` / `updatedAt` は有限数（`Number.isFinite`）、`deletedAt` は `null` または有限数であることを検証する（破損レコードは読み取り対象から除外し自動削除する）。
  - **登録・再登録（`upsertRoot`）**: 未登録の `folderId` は `{ folderId, folderName, enabled: 1, addedAt: now, updatedAt: now, deletedAt: null }` として保存する。既に同一 `folderId` が存在する場合（過去に論理削除され `deletedAt !== null` となっている Tombstone レコードを含む）は、元の `addedAt` を維持したまま `{ folderName, enabled: 1, updatedAt: now, deletedAt: null }` へ更新・復活させる。
  - **論理削除（`removeRoot`）とログアウト時の保持**: `v1.0` の `appDataFolder` LWW 端末間同期で削除を伝播できるよう、登録解除時は物理削除ではなく `{ enabled: 0, deletedAt: now, updatedAt: now }` の Tombstone 更新を行う（`listActive()` は `deletedAt === null` のアクティブ行のみを対象として `addedAt` 昇順・同値時 `folderId` 昇順で決定論的に返し、`countEnabled()` は **`deletedAt === null && enabled === 1`** を満たす有効行の件数 `number` を返す）。また Google アカウントの一時ログアウト（`GoogleAuthBridge.signOut()`）では `driveSyncRoots` を削除せずそのまま保持する。

### 3.5 `series`（作品シリーズ / `v0.2`〜）

| カラム名                 | 型                                                               |   Indexed   | 説明                                                                              |
| :----------------------- | :--------------------------------------------------------------- | :---------: | :-------------------------------------------------------------------------------- |
| `id`                     | `string`                                                         |   **PK**    | シリーズ一意 ID（UUID v4、または名寄せ統合先 ID）                                 |
| `title`                  | `string`                                                         |     Yes     | 作品表示タイトル                                                                  |
| `titleReading`           | `string`                                                         |     Yes     | 五十音ソート・検索用の正規化読み仮名（ひらがな統一、未取得時は `title` から生成） |
| `authors`                | `string[]`                                                       | Multi (`*`) | 著者・原作・作画名配列                                                            |
| `publisher`              | `string`                                                         |     Yes     | 出版社名（未設定時は `""`）                                                       |
| `label`                  | `string`                                                         |     Yes     | レーベル名（未設定時は `""`）                                                     |
| `tags`                   | `string[]`                                                       | Multi (`*`) | ジャンル・自由タグ配列                                                            |
| `synopsis`               | `string`                                                         |      -      | あらすじ・作品紹介（Google Books 等から補完）                                     |
| `publicationStatus`      | `'ongoing' \| 'completed' \| 'unknown'`                          |     Yes     | 連載状況（AniList 等から補完）                                                    |
| `knownTotalVolumes`      | `number \| null`                                                 |      -      | 公開書誌上の既刊総巻数（`v1.0` 欠巻・新刊チェッカー用）                           |
| `externalIds`            | `{ ndlId?: string; anilistId?: string; googleBooksId?: string }` |      -      | 紐付け済み公開書誌データソース識別子                                              |
| `metadataLocked`         | `boolean`                                                        |      -      | 手動編集保護ロック（`true` の場合は自動書誌上書きを抑止）                         |
| `representativeVolumeId` | `string \| null`                                                 |      -      | シリーズカードの代表表紙に使用する `volumes.id`（`null` 時は最小巻）              |
| `readerPresetJson`       | `string \| null`                                                 |      -      | 作品別 WebGL2 画質補正・読み方向・オートクロップ設定 JSON（`v0.4`〜）             |
| `lastReadAt`             | `number \| null`                                                 |     Yes     | 所属巻の最新読書日時（本棚「最近読んだ順」高速ソート用）                          |
| `addedAt`                | `number`                                                         |     Yes     | 初回取り込み日時（UNIX ms）                                                       |
| `updatedAt`              | `number`                                                         |     Yes     | **ユーザー論理更新日時（UNIX ms、LWW 同期用）**                                   |
| `deletedAt`              | `number \| null`                                                 |     Yes     | 論理削除日時（UNIX ms、Tombstone）                                                |

- **`SeriesRepository` 契約（`src/storage/repositories/seriesRepository.ts` / `v0.2 [2/4]`〜）**:
  - **FIFO 直列化 ＆ 破損レコード保護**: 内部 Promise キューで全メソッド（`getById`, `listActive`, `findOrCreateByParsedTitle`, `mergeAuthorsIfUnlocked`, `updateLastReadAt`）を FIFO 直列実行する。読み取り時に不正レコード（空 `id`・空 `title`・非有限日時・不正 `publicationStatus` 等）を検出した場合は除外・削除する。
  - **名寄せと LWW `updatedAt` 保護**: `findOrCreateByParsedTitle({ title, titleReading, authors })` は `deletedAt === null` の既存 `series` 群から [filename-parser.md](providers/filename-parser.md#31-normalizeseriestitlekeytitle-string-stringシリーズ自動名寄せキー) の `normalizeSeriesTitleKey(record.title) === normalizeSeriesTitleKey(title)` に一致するレコードを探索し、存在すれば既存 `series` をそのまま返す（未ロック `metadataLocked === false` かつ新規著者がある場合は `authors` を重複排除マージするが、**`updatedAt` は更新しない**）。存在しない場合のみ UUID v4（注入可能 `idGenerator`）で初期レコード（`publisher: ""`, `label: ""`, `tags: []`, `synopsis: ""`, `publicationStatus: "unknown"`, `knownTotalVolumes: null`, `externalIds: {}`, `metadataLocked: false`, `representativeVolumeId: null`, `readerPresetJson: null`, `lastReadAt: null`, `addedAt: now`, `updatedAt: now`, `deletedAt: null`）を作成して返す。
  - **空シリーズ（有効巻 0 冊）の本棚非表示**: 有効な表示巻が 0 冊になった `series` レコード自体は DB から物理削除せず保持し、本棚一覧参照時は `VolumesRepository` 側の有効巻（有効ルート所属 かつ `isTrashed === 0`）を 1 冊以上持つ `series` のみを表示対象として抽出する。

### 3.6 `volumes`（巻・Google Drive アーカイブ参照 / `v0.2`〜）

| カラム名            | 型                                                |     Indexed      | 説明                                                                     |
| :------------------ | :------------------------------------------------ | :--------------: | :----------------------------------------------------------------------- |
| `id`                | `string`                                          |      **PK**      | 巻一意 ID（UUID v4）                                                     |
| `seriesId`          | `string`                                          |       Yes        | 所属する `series.id`（`[seriesId+volumeNumber]` 複合インデックス対象）   |
| `volumeNumber`      | `number \| null`                                  |     Compound     | 推定または手動設定された巻数（単巻・特装版・合本ソートおよび欠巻判定用） |
| `volumeLabel`       | `string`                                          |        -         | 巻表示ラベル（例: `"第01巻"`, `"第01-05巻 合本"`）                       |
| `rawFileName`       | `string`                                          |        -         | Google Drive 上の元ファイル名                                            |
| `driveFileId`       | `string`                                          | **Unique (`&`)** | Google Drive の不変ファイル ID                                           |
| `parentFolderId`    | `string \| null`                                  |        -         | Google Drive 上の直近親フォルダ ID                                       |
| `rootFolderId`      | `string`                                          |       Yes        | 帰属する `driveSyncRoots.folderId`                                       |
| `fileSize`          | `number`                                          |        -         | 正確なバイトサイズ（HEAD 通信省略・末尾 128KB Range 計算用）             |
| `md5Checksum`       | `string \| null`                                  |       Yes        | Drive 提供の MD5（`zipIndexCache` 無効化判定および `v1.0` 重複検出用）   |
| `driveModifiedTime` | `number`                                          |        -         | Drive 側のファイル更新時刻（UNIX ms）                                    |
| `coverBlob`         | `Blob \| null`                                    |        -         | 長辺約 350px の軽量表紙 WebP（約 15〜25KB/冊、端末ローカル保持）         |
| `coverStatus`       | `'pending' \| 'ready' \| 'error'`                 |       Yes        | 表紙抽出キュー状態                                                       |
| `coverCropMode`     | `'auto' \| 'full' \| 'left-half' \| 'right-half'` |        -         | 見開きカバー半裁クロップ指定（`v0.4`〜）                                 |
| `coverPageIndex`    | `number`                                          |        -         | 表紙に採用する論理ページ番号（デフォルト `0`、`v0.4`〜変更対応）         |
| `coverUpdatedAt`    | `number \| null`                                  |        -         | 表紙抽出完了日時（内部管理用・`updatedAt` とは分離）                     |
| `isTrashed`         | `0 \| 1`                                          |       Yes        | Drive 側ゴミ箱移動・削除・または対象ルートフォルダ外移動の検知フラグ     |
| `addedAt`           | `number`                                          |       Yes        | 初回同期取り込み日時（UNIX ms）                                          |
| `updatedAt`         | `number`                                          |       Yes        | ユーザーの巻番号・所属シリーズ・表紙設定変更日時（UNIX ms、LWW 同期用）  |

- **`VolumesRepository` 契約（`src/storage/repositories/volumesRepository.ts` / `v0.2 [2/4]`〜）**:
  - **FIFO 直列化 ＆ 有効ルートクエリフィルタ**: 内部 Promise キューで全メソッド（`getById`, `getByDriveFileId`, `listBySeriesId`, `listVisibleByEnabledRoots`, `listByRootFolderIds`, `upsertFromDriveSync`, `markTrashedByDriveFileIds`）を FIFO 直列実行する。
  - **巻表示ソート順（決定論的）**: `listBySeriesId` / `listVisibleByEnabledRoots` では `volumeNumber` 昇順（`null` は末尾）→ 同一 `volumeNumber` 時は単巻優先（`volumeLabel.includes("合本")` を合本とみなし `false < true` で単巻を先）→ `volumeLabel` 昇順 → `rawFileName` 昇順 → `id` 昇順の決定論ソートで返却する（`VolumeRecord` スキーマ維持）。
  - **有効ルート所属フィルタと既存データ保護**: `SCR-04` でルートフォルダが一時無効化（`enabled: 0`）または論理削除（`deletedAt !== null`）された場合も、既存 `volumes` レコードや `coverBlob` は破壊せず保持し、`listVisibleByEnabledRoots(enabledRootIds)` 側で **`enabledRootIds.has(volume.rootFolderId) && volume.isTrashed === 0`** を満たす巻のみを本棚表示対象として返す。
  - **同期反映時の LWW `updatedAt` 保護 ＆ MD5 変化リセット**: `upsertFromDriveSync` で既存 `driveFileId` を更新する際は **`updatedAt` を一切変更せず維持** する。また `prev.md5Checksum !== next.md5Checksum || prev.fileSize !== next.fileSize` を検知した場合は戻り値に `invalidatedCacheKey: "gdrive:${driveFileId}:${prev.md5Checksum ?? prev.fileSize}"` を含めるとともに `coverBlob = null`, `coverStatus = "pending"`, `coverUpdatedAt = null` へリセットする。新規作成時のみ `addedAt = updatedAt = now`, `coverBlob = null`, `coverStatus = "pending"`, `coverCropMode = "auto"`, `coverPageIndex = 0`, `coverUpdatedAt = null`, `isTrashed = 0` で初期化する。

### 3.7 `collections` / `seriesCollections` / `bookmarks`（`v0.3`〜`v0.4`）

- **`collections`（カスタム棚・スマートコレクション定義 / `v0.3`〜）**:
  - `id` (PK), `name`, `kind` (`'manual' | 'smart'`), `smartFilterJson` (`string | null`), `sortOrder` (Indexed), `createdAt`, `updatedAt` (Indexed), `deletedAt` (Indexed)
- **`seriesCollections`（手動コレクションとシリーズの多対多中間テーブル / `v0.3`〜）**:
  - `id` (PK: `${collectionId}:${seriesId}`), `collectionId` (Indexed), `seriesId` (Indexed), `addedAt`, `updatedAt` (Indexed), `deletedAt` (Indexed)
- **`bookmarks`（一言メモ付きページしおり / `v0.4`〜）**:
  - `id` (PK: UUID v4), `volumeId` (Indexed), `pageIndex` (`[volumeId+pageIndex]` 複合インデックス), `note` (`string`), `createdAt`, `updatedAt` (Indexed), `deletedAt` (Indexed)

---

## 4. スキーマ進化・テスト初期化契約（`resetTestDb()`）

1. **段階的テーブル有効化ルール**:
   - `Phase 1` 時点では `version(1)`（`syncMeta`）が稼働中。
   - `v0.1` で `version(2)`（`zipIndexCache`, `readingProgress`）を先行定義し、`#19` で `ZipIndexCacheRepository` による `zipIndexCache` 読み書き・LRU 整理を有効化し、`#22` で `readingProgress` の Repository / UI 利用を有効化する。
   - `v0.2` では第 1 弾の `#23` で `version(3)`（`driveSyncRoots`, `series`, `volumes`）の 3 テーブル定義を先行確定させて `DriveSyncRootsRepository`（および `SCR-04` ルートフォルダ管理 UI）を有効化し、続く `#24` で `series` / `volumes` の Repository および Drive スキャン・差分同期を有効化する。以降、`v0.3` で `version(4)`（`collections`, `seriesCollections`）、`v0.4` で `version(5)`（`bookmarks`）を加算的に定義する。
2. **`resetTestDb()` の不変契約**:
   - `resetTestDb(targetDb = db)` は、その時点で `ExLibrisDatabase` に定義されている **`targetDb.tables` 全件に対して `table.clear()` をトランザクションまたは並列で実行** し、テスト間の状態汚染を完全にゼロにする。
   - `ServiceProvider` による `window.__exLibrisServices.resetTestDb` への公開は `!Capacitor.isNativePlatform() && (import.meta.env.DEV || import.meta.env.MODE === "test" || navigator.webdriver === true)`（`shouldExposeResetTestDb`）を満たす開発・テスト・E2E（WebDriver）環境のみに限定し、Android ネイティブ実機および通常の本番ブラウザ環境ではプロパティを省略（`undefined`）して誤削除経路を公開しない。
