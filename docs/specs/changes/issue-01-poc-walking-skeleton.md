---
type: spec-delta
title: "Issue #1 差分仕様: Phase 3 PoC Walking Skeleton（ローカルZIP〜Worker〜生WebGL2単ページ描画）"
description: "Phase 3 PoC としてローカル ZIP/CBZ 一時オープン、標準 ZIP 1RTT 解析、Coordinator/Decode Worker Zero-Copy 転送、生 WebGL2 Mipmap 描画、L1 即時解放、SCR-01/SCR-03 最小骨格を導入する差分仕様"
status: "Review (#1)"
updated: "2026-11-19"
issue: "#1"
tags: [delta, phase-3, poc, walking-skeleton, zip, web-worker, webgl2, l1-cache]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/zip-streaming.md
  - docs/specs/engine/webgl2-renderer.md
  - docs/specs/features/bookshelf.md
  - docs/specs/features/reader.md
  - docs/quality/bug-and-handover-log.md
related_tests:
  - src/App.test.tsx
  - test/it/smoke.spec.ts
---

# Issue #1 差分仕様: Phase 3 PoC Walking Skeleton

## 1. 背景・目的（Why）

- Phase 2 で合意した 4 冊のコア仕様に基づき、ExLibris の根幹パイプラインである **「`LocalFileReader` 範囲読込 → 標準 ZIP 解析 ＆ LFH 1 RTT 切り出し → Coordinator / Decode Worker 分離 → Transferable `ImageBitmap` Zero-Copy 転送 → 生 WebGL2 ハードウェア Mipmap 描画 → L1 `bitmap.close()` 即時解放」** を最小垂直スライスとして実証する。
- あわせて、Google OAuth や ZIP64 / 80MB L2 キャッシュ等の重い機能に踏み込む前に、Android 実機 WebView 上での生 WebGL2 モアレ除去効果・連続めくりメモリ安定性・`@capacitor/app` ハードウェア戻るボタン動作と、Issue ＋ 設計 PR ＋ MK 自律マージ ＋ IT PR ＋ クラウド APK 実機検証の一連の開発プロセスを通しで検証する。

---

## 2. 変更対象の App 全体正本一覧

|   種別   | 正本ファイル                                       | 変更概要                                                                                                                                                              |
| :------: | :------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **新設** | [zip-streaming.md](../engine/zip-streaming.md)     | `LocalFileReader`、標準 ZIP パーサー（UTF-8 非厳格デコード、自然順ソート、LFH 1 RTT）、`DecodeWorkerCore`、`CoordinatorCore` の `AC-ENG-01`〜`08` 定義                |
| **新設** | [webgl2-renderer.md](../engine/webgl2-renderer.md) | `L1PageCache`（5P 上限・`bitmap.close()`）、`WebGLRendererCore`（純黒背景・Mipmap・DPR 追従・`webglcontextlost` 復帰）、`<ReaderCanvas>` の `AC-GL-01`〜`06` 定義     |
| **新設** | [bookshelf.md](../features/bookshelf.md)           | `SCR-01`（`/`）ローカル ZIP/CBZ オープン導線（ヘッダー＋カード＋D&D＋Android SAF 互換）、診断ログコピーの `AC-BS-01`〜`05` 定義                                       |
| **新設** | [reader.md](../features/reader.md)                 | `SCR-03`（`/read/local`）右開き単ページ閲覧、タップ（30/40/30%）・スワイプ・矢印キー/`Escape`、最小 HUD、エラー復帰、`TR-08`/`TR-10` 解放の `AC-RD-01`〜`09` 定義     |
| **更新** | [architecture.md](../architecture.md)              | Layer 4 へカスタムルーター（`src/shared/router/`）・ローカルセッションストア・`L1PageCache`・`AppBridge` を明記し、WebGL2 純黒背景・`webglcontextlost` 復帰契約を追記 |
| **更新** | [screen-transitions.md](../screen-transitions.md)  | Phase 3 ローカル一時セッションのオンメモリ完結（`pageIndex = 0` 開始、`v0.1` で Dexie レジューム導入）と `SCR-03` 右開き操作詳細を明確化                              |

---

## 3. 追加・変更する仕様の差分サマリー

### 3.1 Streaming & Engine Worker 層（`AC-ENG-01`〜`08`）

- `LocalFileReader`: `File.slice` ベースの `RandomAccessReader` 実装（終端クランプ、`AbortSignal` 対応）。
- `ZipParserCore`: 末尾 `128KB` 取得（超過時は CD 追加 1 RTT）、`TextDecoder("utf-8", { fatal: false })` 非厳格デコード、`.jpg/.jpeg/.png/.webp/.avif` 抽出、`__MACOSX/`・`._*`・`Thumbs.db`・`.DS_Store`・`desktop.ini`・ディレクトリ除外、`Intl.Collator("ja", { numeric: true, sensitivity: "base" })` 自然順ソート、LFH 可変長対応 1 RTT スライス抽出、明示的 `ZipErrorCode`（`CORRUPT_ZIP` / `EMPTY_ARCHIVE` / `ENCRYPTED_ZIP` / `UNSUPPORTED_COMPRESSION` / `ZIP64_NOT_SUPPORTED`）。
- `DecodeWorkerPool`（x2）＋ `CoordinatorCore`: Store (`0`) / Deflate (`8`: `DecompressionStream('deflate-raw')` ＋ `fflate` フォールバック)、Transferable `ImageBitmap` Zero-Copy 転送、Fast-Path 現在ページ最優先＋近傍先読み（`[N+1, N+2, N-1]`）、`requestEpoch` 世代キャンセル＆遅延到着 `bitmap.close()` 即時破棄。

### 3.2 WebGL2・L1 キャッシュ・Router・Bridge 層（`AC-GL-01`〜`06`）

- `L1PageCache`: `L1_MAX_PAGES = 5`、退避・世代失効・`clear()` 時の即時 `gl.deleteTexture()` ＋ `bitmap.close()`。
- `WebGLRendererCore` / `<ReaderCanvas>`: 純黒 `#000000` 背景、アスペクト比維持中央内接フィット、`gl.generateMipmap` ＋ `gl.LINEAR_MIPMAP_LINEAR`、ネイティブ `devicePixelRatio`（`MAX_VIEWPORT_DIMS` クランプ）＋ `ResizeObserver`、`webglcontextlost`（`preventDefault()`）＆ `webglcontextrestored` 自動再描画。
- カスタム `RouterProvider`（History API ベース、未知パス `/` フォールバック）＋ `AppBridge`（`@capacitor/app` `backButton` / `minimizeApp()` ラッパー、Web モック自動切替）。

### 3.3 UI Features 層（`AC-BS-01`〜`05`, `AC-RD-01`〜`09`）

- `SCR-01`（`/`）: 既存シェルにヘッダー＆中央カードの「ローカル ZIP を開く（`.zip`/`.cbz`）」ボタン＋ D&D ＋不正拡張子警告を追加。
- `SCR-03`（`/read/local`）: オンメモリセッション不在時の即時 `/` リダイレクト（`TR-10`）、初期 HUD 非表示、右開き固定のタップ（30/40/30%）・スワイプ・キー操作、最小 HUD（戻る・ファイル名・`N / Total`・「← 次へ」「前へ →」）、アーカイブエラー画面（戻る導線）＆ページ個別エラー（前後移動継続可能）、`TR-08` 完全解放。

### 3.4 対象外（`v0.1` 以降へ明確に分離）

- ZIP64（4GB 超）、Shift_JIS（CP932）本格デコード、物理ギャップ 64KB 結合 10MB Warm Prefetch、80MB L2 LRU キャッシュ、Dexie `version(2)`（`zipIndexCache` / `readingProgress`）、2 ページ見開き・1 ページずらし・右/左開き切替、`MAX_TEXTURE_SIZE` 分割ガード、画質補正シェーダー（シャープネス・白黒レベル・ガンマ）、シークバー。

---

## 4. テスト計画（UT / Story & VRT / IT）

| 層                                     | テスト手法・対象                                                                                                                                                                                                                                                                                        | 合格基準                                            |
| :------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------- |
| **UT (Engine / WebGL2 / Bridge / UI)** | ・合成 ZIP/非対応/破損バイナリフィクスチャ（`__fixtures__/zipBuilder.ts`）<br>・`FakeImageBitmap` (`close` spy) ＋ モック `WebGL2RenderingContext`<br>・全 `*.tsx` 1対1 `*.stories.tsx` ＋ `*.test.tsx`（`composeStories` ＋ 親子 `vi.spyOn` 完全分離）                                                 | C0 / C1 / Functions / Lines **100%** PASS           |
| **Storybook VRT**                      | ・`SCR-01`（初期 / D&Dハイライト / 拡張子エラー）<br>・`SCR-03`（リーダーcanvas / HUD表示 / アーカイブエラー / ページエラー）                                                                                                                                                                           | 1280×800 ＆ 375×667 スナップショット差分 **0**      |
| **Playwright IT**                      | ・`SCN-01`: 初期ホーム表示・診断ログコピー・ローカル ZIP 不正拡張子エラー<br>・`SCN-02`: テスト用合成 `.zip`/`.cbz` 選択（`TR-02a`）→ Worker 解凍 → SwiftShader WebGL2 描画（`data-rendered-page`）→ 右開きページめくり・HUD 開閉 → `TR-08` 終了復帰 ＆ `/read/local` 直接遷移フォールバック（`TR-10`） | 全シナリオ **100% PASS**（`waitForTimeout` 不使用） |

---

## 5. 実装 Sub-issue 分割計画（MK 3分割 ＋ 最終 IT）

1. **MK-1: Streaming & Engine Worker 層**:
   - `LocalFileReader`, `ZipParserCore` (`zipParser.ts` + `errors.ts`), `DecodeWorkerCore`, `CoordinatorCore`, `decode.worker.ts`, `coordinator.worker.ts`, 合成 ZIP フィクスチャ＆単体テスト（C0/C1 100%）
2. **MK-2: WebGL2 & L1 Cache & Router/Bridge 層**:
   - `L1PageCache`, `shaders.ts`, `WebGLRendererCore`, `<ReaderCanvas>`, `useLocalReaderSessionStore`, カスタム `RouterProvider`, `AppBridge`（`@capacitor/app` + Web モック）, 1対1 Story/UT ＋ VRT 更新
3. **MK-3: UI Features 統合層（`SCR-01` / `SCR-03` / `App`）**:
   - `BookshelfPage` / `BookshelfHeader` / `LocalArchiveEmptyState`, `ReaderPage` / `ReaderHudOverlay` / `ReaderErrorView`, `App.tsx` ルーティング＆ハードウェア戻る統合, 1対1 Story/UT ＋ VRT 更新
4. **Step 4: 最終 IT・実機検証・アーカイブ（`Closes #1`）**:
   - Playwright `SCN-01` / `SCN-02` 拡充、本差分仕様の `docs/specs/changes/archive/` 移動、Gate 1〜6 通過後に `build-android.yml` でクラウド APK ビルド＆「Android 実機検証試験項目表」提示（人間レビュー・マージで親 Issue #1 クローズ）

---

## 6. 申し送り事項・Android 実機検証計画

- **判定（[workflow.md §2.2](../../guidelines/workflow.md#22-android-実機検証の実施判断基準と試験項目表フォーマット)）**: **区分 A（親 Issue #1 完了前に実施）**
  - **根拠**: 生 WebGL2 シェーダー＆Mipmap モアレ除去描画、高解像度 `ImageBitmap.close()` VRAM 解放、`@capacitor/app` ハードウェア戻るボタン（`TR-08` / `minimizeApp()`）、および Android SAF での `.zip` / `.cbz` ファイル選択を含むため（実機観点 6 項目以上）。
- **登録済み申し送り**: `HO-01`（[bug-and-handover-log.md](../../quality/bug-and-handover-log.md) 登録済み、完了ゲート: `親 Issue #1 完了前`）
- **実機確認予定観点**:
  1. Android SAF ファイルピッカーで `.zip` および `.cbz` の双方がグレーアウトせず選択可能であること
  2. 選択直後に `/read/local` へ遷移し、数百ページ級 ZIP でも初回ページが高速描画されること
  3. 高解像度マンガ画像（スクリーントーンあり）を縮小表示した際にモアレ（干渉縞）が低減され滑らかに描画されること
  4. 連続ページめくり（右開き左タップ・左→右スワイプ）を数十ページ繰り返してもメモリ OOM や描画崩れが起きないこと
  5. 中央タップで HUD（戻る・ファイル名・`N / Total`・次/前ボタン）が開閉でき、操作性が自然であること
  6. リーダー表示中の Android ハードウェア戻るボタンで安全に `/` へ戻り（`TR-08`）、`SCR-01` 上のハードウェア戻るボタンでアプリが最小化されること（`minimizeApp()`）
