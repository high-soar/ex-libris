---
type: spec-feature
title: "仮想本棚ホーム画面仕様書（SCR-01: Bookshelf）"
description: "SCR-01（/）のダークテーマシェル、ローカルZIP/CBZ選択導線（Web D&D・Android SAF互換）、最近のローカル閲覧履歴（readingProgress連携・削除対応）、診断ログコピー、およびTR-02a遷移仕様の正本"
status: "Review (#22)"
updated: "2026-11-22"
tags:
  [
    feature,
    bookshelf,
    scr-01,
    local-zip,
    saf,
    reading-progress,
    diagnostics,
    ui,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/features/reader.md
  - docs/guidelines/testing.md
related_tests:
  - scripts/android-build-config.test.ts
  - src/App.test.tsx
  - src/features/bookshelf/BookshelfPage.test.tsx
  - src/features/bookshelf/BookshelfHeader.test.tsx
  - src/features/bookshelf/LocalArchiveEmptyState.test.tsx
  - src/features/reader/localReaderSessionStore.test.ts
  - src/diagnostics/diagnosticLogger.test.ts
  - test/vrt/vrt.spec.ts
  - test/it/smoke.spec.ts
  - test/it/local-reader.spec.ts
---

# 仮想本棚ホーム画面仕様書（`SCR-01`: Bookshelf）

本ドキュメントは、ExLibris のホーム画面 **`SCR-01`（ルートパス `/`）** に関する機能仕様・UI コンポーネント構成・受け入れ条件（`AC-BS-xx`）の正本（Single Source of Truth）です。Phase 3〜`v0.1` では「ローカル ZIP オープン導線 ＋ 最近のローカル閲覧履歴（レジューム案内）＋ 診断ログコピー」を備えた初期ホームとして構築し、`v0.2` 以降で Google Drive 同期済みの蔵書グリッドへ拡張します。

---

## 1. 画面責務とレイアウト構成（`v0.1`）

1. **テーマ・シェル**:
   - ダークテーマ統一（背景 `bg-slate-950`、ヘッダー/カード `bg-slate-900`、境界 `border-slate-800`）。下部タブバーは配置しない。
2. **上部ヘッダー領域**:
   - 左側: アプリ名（`ExLibris`）＋ バージョンバッジ（`vX.Y.Z`：`package.json` 由来の `APP_VERSION`）。
   - 右側アクション群:
     - **「ローカル ZIP を開く」ボタン**（プライマリアクション、`data-testid="header-open-local-zip-button"`）
     - **「診断ログをコピー」ボタン**（`data-testid="copy-diagnostics-button"`）＋ コピー結果ステータス表示（`data-testid="copy-diagnostics-status"`）
   - **システムバー非重複・セーフエリア＆タッチ応答保護**:
     - Android Edge-to-Edge 環境で OS ステータスバー／ノッチと重なってタップ操作が阻害されないよう（`screen-transitions.md §1` の WebView マージン設定と併用）、`<header>` には `paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))"` を設定してセーフエリア上余白を確保し（`env(..., 0px)` が `0px` の環境では上下 `1rem` を維持）、アクションボタンへ `touch-manipulation` を付与する。
3. **メインコンテンツ領域（`data-testid="bookshelf-empty"` ＋ ローカル閲覧履歴）**:
   - Google Drive 未同期の初期状態カードとして、本アプリの説明と目立つ **「ローカル ZIP を開く（.zip / .cbz）」ボタン**（`data-testid="open-local-zip-button"`）を配置する。
   - メイン領域全体を Web ドラッグ＆ドロップ対応ドロップゾーンとし、ファイルドラッグ中は視覚的ハイライトを表示する。
   - 対応外拡張子（`.zip` / `.cbz` 以外）が選択またはドロップされた場合は遷移せず、カード内にインライン警告メッセージ（`role="alert"`, `data-testid="local-zip-error"`）を表示し、`diagnosticLogger.warn("bookshelf", ...)` へ記録する。
4. **最近のローカル閲覧履歴セクション（`data-testid="recent-local-history-section"` / `v0.1`〜）**:
   - `BookshelfPage` マウント時に `ReadingProgressRepository.listRecentLocal(10)` を取得し（Storybook / 単体テスト時は `initialRecentHistory` Prop で同期注入可）、**有効な `local:*` 履歴が 1 件以上存在する場合のみ** メインカードの下に最新 10 件（`lastReadAt` 降順）を表示する（**0 件時はセクション自体を非表示** とする）。
   - ヘッダーに見出し「最近のローカル閲覧履歴」、案内文「同じ `.zip` / `.cbz` ファイルを再選択すると、前回のページから自動レジュームします」、および `local:*` レコードのみを一括消去する **「履歴をクリア」ボタン**（`data-testid="clear-local-history-button"`）を配置する。
   - 各履歴行（`data-testid="recent-local-history-item"`）には以下を配置する：
     - **再選択オープンボタン**（`data-testid="reopen-local-history-button"`）: タップすると隠し `<input type="file">` ピッカーを起動する。`rawFileName`（1行省略表示）、人間可読サイズ（`B` / `KB` / `MB` / `GB`）、ステータスバッジ（`readStatus === "completed"` は `読了`、`"reading"` は `読書中`、`"unread"` は `未読`）、ページ進捗（`${currentPageIndex + 1} / ${totalPageCount} ページ`）、および進捗バー（`"completed"` 時は `100%`、それ以外は `Math.round(((currentPageIndex + 1) / totalPageCount) * 100)%`）を表示する。
     - **個別削除ボタン**（`data-testid="delete-local-history-button"`）: ファイル選択ピッカーを起動せず、該当 `targetKey` のみを `ReadingProgressRepository.delete(targetKey)` で削除して一覧から即座に除去する。
   - IndexedDB の取得・削除・クリアで例外が発生した場合は `diagnosticLogger.warn("bookshelf", ...)` へ記録し、UI をクラッシュさせない。

---

## 2. ローカル ZIP 選択・Android SAF 互換・`TR-02a` 遷移契約

1. **Android WebView（SAF）互換の `<input type="file">`**:
   - Android のファイルピッカー（SAF）では MIME タイプとして `.cbz`（`application/x-cbz` や `application/vnd.comicbook+zip`）が認識されずグレーアウトする端末が存在する。
   - これを防ぐため、隠し `<input type="file" data-testid="local-zip-file-input" />` の `accept` 属性は `.zip,.cbz,application/zip,application/x-zip-compressed,application/x-cbz,application/octet-stream`（または SAF 環境で `.cbz` が選択不能にならない安全な指定）とし、**最終的な拡張子検証は JS 側で `file.name.toLowerCase().endsWith(".zip") || file.name.toLowerCase().endsWith(".cbz")` により厳格判定** する。
   - 連続で同一ファイルを再選択できるよう、選択処理後に `input.value = ""` をリセットする。
2. **オンメモリセッション保持と即時遷移（`TR-02a`）**:
   - 有効な `.zip` / `.cbz` `File` が選択されたら、オンメモリセッションストア（`useLocalReaderSessionStore`）へ `{ file, fileName: file.name, fileSize: file.size }` を格納し、直ちに `/read/local` へ遷移（`router.navigate("/read/local")`）する。
   - 遷移先の `ReaderPage` にて `local:${file.name}:${file.size}` をキーに `zipIndexCache`（0 RTT 目次復元）および `readingProgress`（保存済み `currentPageIndex` と `spreadPageOffset` の自動レジューム）を参照・更新する。

---

## 3. コンポーネント構成と親子分離（1対1 Story / UT 対象）

| コンポーネント              | ファイルパス                                           | 責務（テスト分離方針）                                                                           |
| :-------------------------- | :----------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| `BookshelfPage`             | `src/features/bookshelf/BookshelfPage.tsx`             | ファイル選択・拡張子検証、`TR-02a` 遷移、D&D 状態、`ReadingProgressRepository` 履歴取得/削除統合 |
| `BookshelfHeader`           | `src/features/bookshelf/BookshelfHeader.tsx`           | タイトル、バージョン表示、「ローカル ZIP を開く」、診断ログコピーUI（Pure Presentational）       |
| `LocalArchiveEmptyState`    | `src/features/bookshelf/LocalArchiveEmptyState.tsx`    | 空本棚カード、目立つ「ローカル ZIP を開く」CTA、D&D ガイド、不正拡張子エラー表示                 |
| `RecentLocalHistorySection` | `src/features/bookshelf/RecentLocalHistorySection.tsx` | 直近ローカル閲覧履歴（最大10件、0件時 `null`、進捗バー、再選択導線、個別削除・一括クリア）       |

- 親 `BookshelfPage` の単体テストでは子コンポーネント（`BookshelfHeader`, `LocalArchiveEmptyState`, `RecentLocalHistorySection`）を `vi.spyOn(...).mockImplementation(() => null)` で完全分離する。

---

## 4. 受け入れ条件（`AC-BS-xx`）

|   AC ID    | 受け入れ条件                                                                                                                                                                            |
| :--------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-BS-01` | `SCR-01`（`/`）のヘッダーおよびメインカードの双方から「ローカル ZIP を開く」操作で `.zip` / `.cbz` ファイルを選択できる。                                                               |
| `AC-BS-02` | Web ブラウザ上で `.zip` / `.cbz` ファイルをドロップゾーンへドラッグ＆ドロップして開くことができる。                                                                                     |
| `AC-BS-03` | `.zip` / `.cbz` 以外のファイルが選択・ドロップされた場合は遷移せず、インラインエラー（`role="alert"`）を表示する。                                                                      |
| `AC-BS-04` | 有効な `.zip` / `.cbz` ファイル選択時にオンメモリセッションが更新され、`/read/local`（`SCR-03`）へ遷移する（`TR-02a`）。                                                                |
| `AC-BS-05` | 診断ログコピー機能（`data-testid="copy-diagnostics-button"`）および VRT（1280px / 375px）が引き続き 100% 正常動作する。                                                                 |
| `AC-BS-06` | `local:*` の閲覧履歴が 1 件以上ある場合のみ最新 10 件（`lastReadAt` 降順）の進捗・ステータス一覧を表示し、行選択でのピッカー起動・個別履歴削除・一括クリアが動作する（0件時は非表示）。 |
