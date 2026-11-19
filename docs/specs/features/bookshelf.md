---
type: spec-feature
title: "仮想本棚ホーム画面仕様書（SCR-01: Bookshelf）"
description: "SCR-01（/）のダークテーマシェル、ローカルZIP/CBZ選択導線（Web D&D・Android SAF互換）、診断ログコピー、およびTR-02a遷移仕様の正本"
status: "Review (#1)"
updated: "2026-11-19"
tags: [feature, bookshelf, scr-01, local-zip, saf, diagnostics, ui]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/screen-transitions.md
  - docs/specs/features/reader.md
  - docs/guidelines/testing.md
related_tests:
  - src/App.test.tsx
  - test/it/smoke.spec.ts
---

# 仮想本棚ホーム画面仕様書（`SCR-01`: Bookshelf）

本ドキュメントは、ExLibris のホーム画面 **`SCR-01`（ルートパス `/`）** に関する機能仕様・UI コンポーネント構成・受け入れ条件（`AC-BS-xx`）の正本（Single Source of Truth）です。Phase 3 では「ローカル ZIP オープン導線 ＋ 診断ログコピー」を備えた初期ホームとして構築し、`v0.2` 以降で Google Drive 同期済みの蔵書グリッドへ拡張します。

---

## 1. 画面責務とレイアウト構成（Phase 3 PoC）

1. **テーマ・シェル**:
   - ダークテーマ統一（背景 `bg-slate-950`、ヘッダー/カード `bg-slate-900`、境界 `border-slate-800`）。下部タブバーは配置しない。
2. **上部ヘッダー領域**:
   - 左側: アプリ名（`ExLibris`）＋ バージョンバッジ（`vX.Y.Z`：`package.json` 由来の `APP_VERSION`）。
   - 右側アクション群:
     - **「ローカル ZIP を開く」ボタン**（プライマリアクション、`data-testid="header-open-local-zip-button"`）
     - **「診断ログをコピー」ボタン**（`data-testid="copy-diagnostics-button"`）＋ コピー結果ステータス表示（`data-testid="copy-diagnostics-status"`）
3. **メインコンテンツ領域（`data-testid="bookshelf-empty"`）**:
   - Google Drive 未同期の初期状態カードとして、本アプリの説明と目立つ **「ローカル ZIP を開く（.zip / .cbz）」ボタン**（`data-testid="open-local-zip-button"`）を配置する。
   - メイン領域全体を Web ドラッグ＆ドロップ対応ドロップゾーンとし、ファイルドラッグ中は視覚的ハイライトを表示する。
   - 対応外拡張子（`.zip` / `.cbz` 以外）が選択またはドロップされた場合は遷移せず、カード内にインライン警告メッセージ（`role="alert"`, `data-testid="local-zip-error"`）を表示し、`diagnosticLogger.warn("bookshelf", ...)` へ記録する。

---

## 2. ローカル ZIP 選択・Android SAF 互換・`TR-02a` 遷移契約

1. **Android WebView（SAF）互換の `<input type="file">`**:
   - Android のファイルピッカー（SAF）では MIME タイプとして `.cbz`（`application/x-cbz` や `application/vnd.comicbook+zip`）が認識されずグレーアウトする端末が存在する。
   - これを防ぐため、隠し `<input type="file" data-testid="local-zip-file-input" />` の `accept` 属性は `.zip,.cbz,application/zip,application/x-zip-compressed,application/x-cbz,application/octet-stream`（または SAF 環境で `.cbz` が選択不能にならない安全な指定）とし、**最終的な拡張子検証は JS 側で `file.name.toLowerCase().endsWith(".zip") || file.name.toLowerCase().endsWith(".cbz")` により厳格判定** する。
   - 連続で同一ファイルを再選択できるよう、選択処理後に `input.value = ""` をリセットする。
2. **オンメモリセッション保持と即時遷移（`TR-02a`）**:
   - 有効な `.zip` / `.cbz` `File` が選択されたら、オンメモリセッションストア（`useLocalReaderSessionStore`）へ `{ file, fileName: file.name, fileSize: file.size }` を格納し、直ちに `/read/local` へ遷移（`router.navigate("/read/local")`）する。
   - `Phase 3` では `Dexie.js`（`version(1)`）への書き込みは行わず、常にオンメモリセッションのみを使用する（`zipIndexCache` / `readingProgress` による永続化とレジュームは `v0.1` で追加）。

---

## 3. コンポーネント構成と親子分離（1対1 Story / UT 対象）

| コンポーネント           | ファイルパス                                        | 責務（テスト分離方針）                                                                     |
| :----------------------- | :-------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| `BookshelfPage`          | `src/features/bookshelf/BookshelfPage.tsx`          | ファイル選択イベント統合、拡張子検証、ローカルセッションセット＆`TR-02a` 遷移、D&D状態     |
| `BookshelfHeader`        | `src/features/bookshelf/BookshelfHeader.tsx`        | タイトル、バージョン表示、「ローカル ZIP を開く」、診断ログコピーUI（Pure Presentational） |
| `LocalArchiveEmptyState` | `src/features/bookshelf/LocalArchiveEmptyState.tsx` | 空本棚カード、目立つ「ローカル ZIP を開く」CTA、D&D ガイド、不正拡張子エラー表示           |

- 親 `BookshelfPage` の単体テストでは子コンポーネント（`BookshelfHeader`, `LocalArchiveEmptyState`）を `vi.spyOn(...).mockImplementation(() => null)` で完全分離する。

---

## 4. 受け入れ条件（`AC-BS-xx`）

|   AC ID    | 受け入れ条件                                                                                                              |
| :--------: | :------------------------------------------------------------------------------------------------------------------------ |
| `AC-BS-01` | `SCR-01`（`/`）のヘッダーおよびメインカードの双方から「ローカル ZIP を開く」操作で `.zip` / `.cbz` ファイルを選択できる。 |
| `AC-BS-02` | Web ブラウザ上で `.zip` / `.cbz` ファイルをドロップゾーンへドラッグ＆ドロップして開くことができる。                       |
| `AC-BS-03` | `.zip` / `.cbz` 以外のファイルが選択・ドロップされた場合は遷移せず、インラインエラー（`role="alert"`）を表示する。        |
| `AC-BS-04` | 有効な `.zip` / `.cbz` ファイル選択時にオンメモリセッションが更新され、`/read/local`（`SCR-03`）へ遷移する（`TR-02a`）。  |
| `AC-BS-05` | 診断ログコピー機能（`data-testid="copy-diagnostics-button"`）および VRT（1280px / 375px）が引き続き 100% 正常動作する。   |
