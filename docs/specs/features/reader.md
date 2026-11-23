---
type: spec-feature
title: "WebGL2 ストリーミングリーダー画面仕様書（SCR-03: Reader）"
description: "SCR-03（/read/local）のインテリジェント見開き、1ページずらし、右開き/左開き、シークバー、1パス画質補正シート（優先度2戻る制御・syncMetaデフォルト保存）、readingProgress自動レジューム、Fast-Path＋L1 5頁窓連携、およびTR-08/TR-10仕様の正本"
status: "Approved (#22)"
updated: "2026-11-22"
tags:
  [
    feature,
    reader,
    scr-03,
    rtl,
    ltr,
    spread,
    seekbar,
    shader,
    reading-progress,
    hud,
    touch,
    webgl2,
    prefetch,
    back-button,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/zip-streaming.md
  - docs/specs/engine/webgl2-renderer.md
  - docs/specs/features/bookshelf.md
  - docs/guidelines/testing.md
related_tests:
  - scripts/android-build-config.test.ts
  - src/App.test.tsx
  - src/diagnostics/diagnosticLogger.test.ts
  - src/features/reader/spreadLayout.test.ts
  - src/features/reader/ReaderPage.test.tsx
  - src/features/reader/ReaderHudOverlay.test.tsx
  - src/features/reader/ReaderShaderSheet.test.tsx
  - src/features/reader/ReaderErrorView.test.tsx
  - src/features/reader/localReaderSessionStore.test.ts
  - src/features/reader/readerErrors.test.ts
  - src/webgl/shaderParams.test.ts
  - src/webgl/ReaderCanvas.test.tsx
  - src/bridges/app/capacitorAppBridge.test.ts
  - src/bridges/app/mockAppBridge.test.ts
  - src/storage/repositories/zipIndexCacheRepository.test.ts
  - src/storage/repositories/readingProgressRepository.test.ts
  - src/storage/repositories/readerSettingsRepository.test.ts
  - test/vrt/vrt.spec.ts
  - test/it/local-reader.spec.ts
---

# WebGL2 ストリーミングリーダー画面仕様書（`SCR-03`: Reader）

本ドキュメントは、ExLibris のフルスクリーンリーダー画面 **`SCR-03`（`v0.1` ルート `/read/local`、`v0.2`〜 `/read/volume/:volumeId`）** に関する見開きレイアウト・綴じ方向切替・シークバー・画質補正ボトムシート・`readingProgress` 自動レジューム・異常系ハンドリング・リソース解放ライフサイクルの正本（Single Source of Truth）です。

---

## 1. セッション保護（`TR-10`）・優先度付き終了シーケンス（`TR-08`）・自動レジューム＆先読み連携

1. **セッション不在フォールバック（`TR-10`）**:
   - `/read/local` マウント時にオンメモリセッション（`useLocalReaderSessionStore.session`）が `null` の場合（リロードや URL 直接入力時）、エラー画面や空白で停止せず、即座に `router.replace("/")` で `SCR-01` へ遷移する。
2. **優先度 2（画質補正シート閉鎖）とリーダー終了・完全リソース解放（優先度 3: `TR-08`）**:
   - **優先度 2 戻る制御**: 致命的エラーが発生しておらず画質補正ボトムシート（`ReaderShaderSheet`）が開いている状態（`activeFatalError === null && isShaderSheetOpen`）で Android ハードウェア戻るボタン（`AppBridge` `backButton`）、キーボード `Escape` キー、またはシート外バックドロップタップが発生した場合は、**`TR-08` を発火せず `isShaderSheetOpen = false` のみを実行してフルスクリーン閲覧状態へ戻る**。
   - **優先度 3 リーダー終了（`TR-08`）**: 上部 HUD の「戻る」ボタン、エラー画面の「ホームへ戻る」ボタン、ボトムシート非表示時（または致命的エラー表示中）の `Escape` キー／Android ハードウェア戻るボタン、またはブラウザ戻る（`popstate`）によるルート離脱で発動し、以下の順序でリソースを確定解放して `/` へ戻る：
     1. 有効閲覧中であれば現在のページ進捗と `spreadPageOffset` を `ReadingProgressRepository.put(...)` へ即時フラッシュ発行（Repository 内の FIFO 直列化により、遷移先 `SCR-01` の `listRecentLocal(10)` より先に確実にコミットされる）
     2. 進行中 `requestEpoch` を無効化（`cancelEpochBelow`）＋ `CoordinatorWorker.closeArchive()` 呼び出し（Worker 内 `L2ByteCache` 全破棄含む）
     3. `L1PageCache.clear()` により保持中の全 `ImageBitmap.close()` ＋ `WebGLRendererCore` 全テクスチャ（複数タイル含む）`gl.deleteTexture()` 実行
     4. `WebGLRendererCore.dispose()` 実行
     5. オンメモリ `File` セッションを `null` へクリア
     6. `router.back()`（`pushState` 履歴戻り、直接遷移等では `router.replace("/")`、`popstate` 時は現在履歴を維持）
3. **`zipIndexCache` 0 RTT オープン・`readingProgress` 自動レジューム・共通画質補正デフォルト復元**:
   - アーカイブオープン時（`initialSnapshot === undefined` 時）：
     - オープン試行開始時に `currentPageIndex = 0`, `spreadPageOffset = 0`, `totalPages = 0` へ初期化する。
     - `ServiceContext.readerSettingsRepo.getShaderDefaults()` を非同期取得し、取得完了までにユーザーが手動でスライダー操作を行っていなければ `shaderParams` へ初期適用する（失敗時は警告ログ記録の上でニュートラル初期値を維持）。
     - `ServiceContext.zipIndexCacheRepo.get(source.indexCacheKey)` および `ServiceContext.readingProgressRepo.get(source.progressTargetKey)` を安全に参照する（IndexedDB エラー時や破損レコード時は警告ログ記録の上で `null` へフォールバック）。
     - `openArchive` 成功後、保存済み進捗レコードが存在する場合は **`readStatus` が `"reading"` か `"completed"` かを問わず、`spreadPageOffset = result.pageCount > 1 ? saved.spreadPageOffset : 0`（1 ページ本では `0` へ正規化）および `currentPageIndex = Math.min(result.pageCount - 1, Math.max(0, saved.currentPageIndex))` を復元** して初回 `loadPageWindow` を開始する（未保存時は `pageIndex = 0`, `spreadPageOffset = 0`）。
   - `!result.fromIndexCache` で通常オープンに成功した場合は `zipIndexCacheRepo.put(source.indexCacheKey, result.entries)` を非ブロッキングで保存する。
4. **`readingProgress` 永続化トリガーと寸法確定ベースの `readStatus` 判定**:
   - `initialSnapshot === undefined && session !== null && !isOpening && totalPages > 0 && archiveError === null && webglFatalError === null` の条件下でのみ進捗を保存する（破損・空アーカイブ等の異常時は一切書き込まない）。
   - **寸法未確定時の早期 `completed` 誤判定防止**: `computeViewportSlotLayout` は未デコードの隣接ページを暫定的に縦長と仮定して 2 スロット `[N, N+1]` を返すため、`persistCurrentProgress` では見開き第 2 スロット（`N + 1`）は **`N` と `N + 1` の双方が `knownDimensions` 上で非横長（`width <= height`）と確定している場合のみ** 表示済みに含める（`moveToPage` 直後やデコード完了前の離脱で寸法未確定の間は `currentPageIndex` 単独基準とする）。この確定表示最大ページ `confirmedMaxDisplayedPageIndex >= totalPages - 1` であれば `readStatus = "completed"`、それより手前であれば `readStatus = "reading"` とし、`local:${rawFileName}:${fileSize}`（`volumeId: null`）で保存する（失敗時は `diagnosticLogger.warn("reader", ...)` のみ記録し閲覧を継続）。
   - 保存発火タイミング：①`loadPageWindow` 完了時（初回オープン・めくり・シーク・見開き／向き変化後の寸法確定時）、②`moveToPage`（前後めくり・シーク確定）および `handleToggleSpreadPageOffset` 直後、③`TR-08` 終了・`popstate` 離脱・`window` `"pagehide"`・`document` `"visibilitychange"`（`document.visibilityState === "hidden"`）発生時。
5. **Fast-Path・L1 近傍バッチ・10MB Warm Prefetch 連携（単ページ／見開き共用）**:
   - 有効表示モード（`effectiveSpreadMode`）・`spreadPageOffset`・セッション内既知寸法（`knownDimensions`）から現在の取得候補 `visibleTargets`（単ページ確定時は `[N]`、見開きペア候補時は `[N, N+1]`）を決定し、保護ウィンドウ `protectedPages`（単ページ時 `[N-1, N, N+1, N+2]` 最大 4 枚、見開き時 `[first-1, first, last, last+1, last+2]` 最大 5 枚＝`L1_MAX_PAGES`）、近傍先読み `neighbors`（単ページ時 `[N+1, N+2, N-1]`、見開き時 `[last+1, last+2, first-1]`）、および閲覧優先順 `prefetchTargets`（進行方向 `[last+1 .. last+20]` ＋ 逆方向 `[first-1, first-2]`、`0 <= idx < totalPages`）を算出する。
   - **モード／オフセット／向き変化時の再同期**: `spreadMode`・`effectiveSpreadMode`・`spreadPageOffset` の変更により表示候補が変化した場合（`currentPageIndex === 0` での `[0] ↔ [0, 1]`、`"single" → "spread"` 切替、`"auto"` による縦→横回転追従を含む）は、`currentPageIndex` が同一でも新 `epoch` を発行し `cancelEpochBelow(epoch)` の上で `loadPageWindow` を再実行する（ただし `effectiveSpreadMode` が変化しない同向き内の単なる寸法変化では再実行しない）。`initialSnapshot` 指定時は `framesByPage` から即座に再レイアウトする。また `readingDirection`（`rtl` ↔ `ltr`）変更時は L1 保持フレームを用いて即座にスロット再配置・再描画する。
   - **現在表示候補 `visibleTargets` に L1 未ヒットが含まれる場合**: 未ヒット分 `missingVisible` に対して Fast-Path `requestVisiblePages(missingVisible, prefetchTargets, epoch, { visiblePageIndices: visibleTargets })` を待機し、デコード完了とともに `knownDimensions`（`{ width, height }`）へ寸法を記録してレイアウトを確定描画する（同時に Worker 側で 10MB 結合 Warm Prefetch が非同期開始）。直後に `missingNeighbors` があれば `requestVisiblePages(missingNeighbors, [], epoch, { visiblePageIndices: visibleTargets })` を 1 バッチで非同期要求する。
   - **現在表示候補 `visibleTargets` がすべて L1 ヒット時**: 即座に描画した上で、`missingNeighbors` または `prefetchTargets` が非空であれば `requestVisiblePages(missingNeighbors, prefetchTargets, epoch, { visiblePageIndices: visibleTargets })` を 1 回非同期要求し、L2 キャッシュからの L1 近傍補充・表示ピン更新・L2 先読み補充を一括実行する。

---

## 2. インテリジェント見開き判定・1ページずらし・ページ送り操作契約

### 2.1 `SpreadMode` とビューポート向き追従・動的アンカーペアリング（`spreadLayout.ts`）

1. **モード定義と初期値**:
   - `SpreadMode`: `"auto" | "single" | "spread"`（初期値 `"auto"`）
   - `ReadingDirection`: `"rtl" | "ltr"`（初期値 `"rtl"`）
   - `SpreadPageOffset`: `0 | 1`（初期値 `0`）
   - `ReaderPage` は自身のコンテナに対する `ResizeObserver` および `window` `"resize"` リスナー（テスト・Story 用に `initialSnapshot.viewportSize` 上書き可）でビューポート寸法 `(width, height)` を追跡する。`spreadMode === "auto"` のとき `width > height` なら `"spread"`、それ以外（縦向き・正方形）なら `"single"` と判定する。
2. **インテリジェント単独中央表示条件**:
   `effectiveSpreadMode === "spread"` であっても、以下のいずれかに該当する場合は `position: "center"` の 1 枚単独中央表示とする：
   - 表紙先頭ページ（`currentPageIndex === 0 && spreadPageOffset === 0`）
   - 基準ページ自身の元画像が横長（`width > height`、正方形 `width === height` は縦長扱い）
   - ペア候補の次ページ（`currentPageIndex + 1`）が存在しない（末尾到達）または元画像が横長（`width > height`）
   - 上記以外の場合、`rtl` では `[{ pageIndex: N + 1, position: "left" }, { pageIndex: N, position: "right" }]`、`ltr` では `[{ pageIndex: N, position: "left" }, { pageIndex: N + 1, position: "right" }]` の 2 スロット見開きとする。
3. **動的再ペアリング・戻る履歴整合・「1ページずらし」**:
   - **次へ進行と最終見開き境界**: 現在の表示スロット数 `displayedSlots.length`（単独なら `+1`、見開きなら `+2`）だけ進むため、途中に横長見開き結合済み画像が存在しても後続ページから自動的に正しい見開きペアへ再整合する。**表示中の最大ページインデックス `maxDisplayedPageIndex >= totalPages - 1` に到達している場合は、HUD ボタンだけでなくタップ・スワイプ・キーボードを含むすべての次頁遷移を無効（no-op）とし、最終見開きから最終 1 枚単独への意図しない再遷移を起こさない**。
   - **前へ戻る**: セッション内見開き遷移スタック（`spreadHistory`）を保持し（`spreadPageOffset` 変更時・シークバージャンプ時・**`effectiveSpreadMode === "single"`** 状態への遷移／単ページ移動時にスタックをクリア）、履歴がある場合は往路と厳密一致する開始ページへ戻る。履歴が空の場合（単ページからの切替直後やシーク直後等）は `computePreviousAnchorIndex` で決定する（`currentPageIndex <= 1` 時は先頭境界ガードとして `0`、`effectiveSpreadMode === "single"` 時は `currentPageIndex - 1`、見開き時 `prev1 = currentPageIndex - 1`, `prev2 = currentPageIndex - 2` に対し `(prev2 === 0 && spreadPageOffset === 0)` または `prev1`/`prev2` が横長なら `prev1`、それ以外は `prev2`）。
   - **シークバージャンプ着地ルール**: シーク確定時は `spreadHistory` をクリアし、`spreadPageOffset` は変更せず指定された `targetIndex` を基準アンカー（`currentPageIndex = targetIndex`）として直接設定・再同期することで、単ページ／見開きいずれでも指定ページが必ず画面内スロットに含まれることを保証する。
   - **1ページずらし切替（`computeShiftedAnchorOnOffsetToggle(currentPageIndex, nextOffset, totalPages)`）**:
     - `totalPages <= 1 || currentPageIndex <= 0`: `0` を維持する（0 頁目では `[0] ↔ [0, 1]` を切り替え）。
     - `currentPageIndex >= 1` かつ `nextOffset === 1`: `currentPageIndex + 1 < totalPages ? currentPageIndex + 1 : currentPageIndex - 1`（原則 `+1` シフト、最終頁上でのみ `-1` へ逃がしてペアを再構成）。
     - `currentPageIndex >= 1` かつ `nextOffset === 0`: `currentPageIndex - 1 >= 1 ? currentPageIndex - 1 : currentPageIndex + 1 < totalPages ? currentPageIndex + 1 : 0`（原則 `-1` シフトで元ペアへ復帰し、`currentPageIndex === 1` 時のみ 3 頁以上なら `2` へシフトして表紙 `0` への意図しない巻戻りを防ぐ〔2 頁本時は `0`〕）。

### 2.2 ページ送り操作契約（`rtl` / `ltr` 対称反転）

| 入力手段                  | 条件・領域                                                               | 右開き (`rtl`: 標準)                         | 左開き (`ltr`)                               |
| :------------------------ | :----------------------------------------------------------------------- | :------------------------------------------- | :------------------------------------------- |
| **タップ / クリック**     | 左端 30%（`0 <= ratio < 0.30`）                                          | **次のページ/見開きへ**                      | **前のページ/見開きへ**                      |
|                           | 中央 40%（`0.30 <= ratio <= 0.70`）                                      | **上下 HUD オーバーレイの表示/非表示**       | **上下 HUD オーバーレイの表示/非表示**       |
|                           | 右端 30%（`0.70 < ratio <= 1.0`）                                        | **前のページ/見開きへ**                      | **次のページ/見開きへ**                      |
| **横スワイプ（Pointer）** | 水平移動量 `Math.abs(dx) >= 40` かつ `Math.abs(dx) > Math.abs(dy)`（px） | 左→右 (`dx > 0`)＝次 / 右→左 (`dx < 0`)＝前  | 右→左 (`dx < 0`)＝次 / 左→右 (`dx > 0`)＝前  |
| **キーボード**            | `ArrowLeft`                                                              | **次のページ/見開きへ**                      | **前のページ/見開きへ**                      |
|                           | `ArrowRight`                                                             | **前のページ/見開きへ**                      | **次のページ/見開きへ**                      |
|                           | `Escape`                                                                 | **補正シート閉鎖（優先度2）/ 終了（TR-08）** | **補正シート閉鎖（優先度2）/ 終了（TR-08）** |

- **ポインターイベント実装原則**: スワイプ開始座標等の高頻度状態は `useRef` で保持し、React 再レンダーを引き起こさない。タップとスワイプの誤爆を防ぐため、閾値以上のドラッグが成立した場合はタップ判定を発火しない。
- **HUD・ボトムシート表示中のポインター＆キーボード競合保護**:
  - 上部バー・下部バー・画質補正ボトムシート（バックドロップ含む）上のポインター／クリック操作は下層のタップゾーンへバブリングさせない（`stopPropagation`）。
  - `event.target instanceof HTMLInputElement`（シークバーや画質スライダーへのフォーカス中）または `isShaderSheetOpen === true` の間は、`window` `keydown` の `ArrowLeft` / `ArrowRight` によるページめくりを抑止し、`<input type="range">` 自身のネイティブキー移動およびボトムシートのモーダル分離を保護する。

---

## 3. オーバーレイ HUD ＆ 画質補正ボトムシート構成

1. **初期表示状態**:
   - リーダーオープン直後は **HUD 非表示（`isHudOpen = false`）・画質補正シート非表示（`isShaderSheetOpen = false`）** の完全フルスクリーン没入表示から開始する。
2. **上部バー（`data-testid="reader-hud-top"`）**:
   - 左側: **「戻る」ボタン**（`data-testid="reader-back-button"`, `TR-08` 実行）
   - 中央/タイトル: 開いているアーカイブのファイル名（`fileName`、1行省略表示）
   - 右側: **「画質補正」ボタン**（`data-testid="reader-shader-button"`, `data-shader-modified={String(!isDefaultShaderParams)}`）。押下時は `isHudOpen = false` とした上で `isShaderSheetOpen = true` にして `ReaderShaderSheet` を開く（いずれかの補正値がニュートラル初期値から変更されている場合はインディゴ強調スタイルを表示）。
3. **下部バー（`data-testid="reader-hud-bottom"`）の 3段構成（1280px / 375px 両対応）**:
   - **上段（シークバー行：`data-testid="reader-hud-seek-row"`）**:
     - ページシークバー（`<input type="range" data-testid="reader-seekbar" />`）を配置し、`min={0}`, `max={Math.max(0, totalPages - 1)}`, `step={1}`, `dir={readingDirection === "rtl" ? "rtl" : "ltr"}`, `data-reading-direction={readingDirection}`, `disabled={totalPages <= 1}` とする（`rtl` では右端が 1P・左端が最終 P、`ltr` では左端が 1P・右端が最終 P となる）。
     - **ドラッグプレビュー＆要素外リリース対応の確定時 Epoch 更新**: `onPointerDown` 開始後はローカルの `seekPreviewIndex` のみを `onChange` で更新し、中段の `reader-page-indicator` を `${seekPreviewIndex + 1} / ${totalPages}`（`data-seek-preview="true"`）のプレビュー表示へ切り替え、**ドラッグ中は Worker RPC を発火しない**。ドラッグ中に指が `<input>` 矩形外へ外れて離された場合も取りこぼさないよう、ドラッグ開始中は要素イベントに加えて **`window` の `pointerup`（確定）および `pointercancel`（キャンセル）** でも完結させ、確定時（目標ページが `currentPageIndex` と異なる場合）および非ドラッグ時の `onChange`（キーボード操作等）でのみ `onCommitSeek(targetIndex)` を 1 回発火する。`pointercancel` 発生時、ドラッグ途中の `isOpen === false` 閉鎖時、およびアンマウント時はジャンプを発火せずプレビュー状態を解除する。
   - **中段（ページナビゲーション行：`data-testid="reader-hud-nav-row"`）**:
     - `rtl` 時: 左に「`← 次へ`」（`data-testid="reader-next-button"`）、中央にページインジケータ（`data-testid="reader-page-indicator"`）、右に「`前へ →`」（`data-testid="reader-prev-button"`）。
     - `ltr` 時: 左に「`← 前へ`」（`data-testid="reader-prev-button"`）、中央にページインジケータ（`data-testid="reader-page-indicator"`）、右に「`次へ →`」（`data-testid="reader-next-button"`）。
     - ページインジケータ表記: シークプレビュー中でない通常時は、単枚表示で 1 始まり `N / Total`（例: `1 / 24`）、2ページ見開きで昇順ハイフン区切り `N1-N2 / Total`（例: `2-3 / 24`）、`totalPages === 0` 時は `0 / 0`。
     - `disabled` 境界: 先頭ページ（`currentPageIndex <= 0`）では「前へ」を `disabled`、表示中の最大ページが最終ページ（`maxDisplayedPageIndex >= totalPages - 1`）では「次へ」を `disabled` とする。
   - **下段（表示・綴じ方向コントロール行：`data-testid="reader-hud-controls-row"`）**:
     - **表示モード循環ボタン**（`data-testid="reader-spread-mode-button"`, `data-spread-mode`, `data-effective-spread-mode`）: クリックごとに `auto → spread → single → auto` を循環し、`自動(見開き)` / `自動(単頁)` / `見開き` / `単ページ` を表示する。
     - **1ページずらしトグル**（`data-testid="reader-offset-toggle-button"`, `aria-pressed={spreadPageOffset === 1}`）: `spreadPageOffset` を `0 ↔ 1` で切り替える。**`totalPages <= 1` または実効表示が単ページ（`effectiveSpreadMode === "single"`）のときは `disabled`** とする。
     - **右/左開き切替ボタン**（`data-testid="reader-direction-button"`, `data-reading-direction={readingDirection}`）: `rtl`（`右開き`）と `ltr`（`左開き`）をトグルする。
4. **クイック画質補正ボトムシート（`ReaderShaderSheet`: `data-testid="reader-shader-sheet"`）**:
   - 背面の WebGL2 紙面の色味・輝度を変えずにリアルタイム比較できるよう、透明クリックキャッチバックドロップ（`data-testid="reader-shader-backdrop"`）と下部シートパネル（`role="dialog"`, `aria-modal="true"`, `aria-label="画質補正"`）で構成する。
   - 4 つの調整スライダー（すべて数値昇順の `dir="ltr"`）と小数第2位の現在値ラベルを表示し、変更ごとに現在セッションの `shaderParams` を即時更新する：
     - `data-testid="shader-sharpness-slider"`: シャープネス（`0.00 〜 1.00`, step `0.05`）
     - `data-testid="shader-white-point-slider"`: 白レベル・黄ばみ除去（`0.80 〜 1.00`, step `0.01`）
     - `data-testid="shader-black-point-slider"`: 黒レベル・裏写り除去（`0.00 〜 0.25`, step `0.01`）
     - `data-testid="shader-gamma-slider"`: ガンマ補正（`0.60 〜 1.60`, step `0.05`）
   - アクションボタン：
     - **「リセット」**（`data-testid="shader-reset-button"`）: 現在セッションの補正値を `DEFAULT_SHADER_CORRECTION_PARAMS`（`0.00 / 1.00 / 0.00 / 1.00`）へ戻す。
     - **「デフォルト保存」**（`data-testid="shader-save-default-button"`）: 現在の補正値を `readerSettingsRepo.saveShaderDefaults(...)` で `syncMeta['defaultReaderSettingsJson']` へ永続化し、保存結果メッセージ（`data-testid="shader-save-status"`）を表示する。
     - **「閉じる」**（`data-testid="shader-sheet-close-button"`）: ボトムシートを閉じてフルスクリーン閲覧状態へ戻る。
5. **システムバー非重複・セーフエリア＆タッチ応答保護**:
   - 上部バーは `paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))"`、下部バーおよび `ReaderShaderSheet` は `paddingBottom` に `env(safe-area-inset-bottom, 0px)` を加算設定し、全ボタン・スライダーに `touch-manipulation` を付与する。

---

## 4. ローディング状態・異常系エラーハンドリング

### 4.1 アーカイブ全体・環境エラー（閲覧不能時）

アーカイブオープン時または WebGL2 初期化・コンテキスト復帰時に以下のエラーが発生した場合、`isHudOpen = false` および `isShaderSheetOpen = false` へリセットし（エラー画面上で優先度 2 戻る制御が誤吸収しないよう保証）、`diagnosticLogger.error("reader", ...)` に記録した上で、全画面エラーパネル（`data-testid="reader-error-view"`）と **「ホームへ戻る」ボタン**（`data-testid="reader-error-back-button"`, `TR-08` 実行）を表示する。

- `CORRUPT_ZIP`: 「ZIP ファイルが破損しているため開けませんでした」
- `EMPTY_ARCHIVE`: 「表示できる画像ファイル（JPEG / PNG / WebP / AVIF）が見つかりませんでした」
- `ENCRYPTED_ZIP`: 「パスワード保護（暗号化）された ZIP ファイルには対応していません」
- `UNSUPPORTED_COMPRESSION`: 「未対応の圧縮方式が含まれているため開けませんでした」
- `READ_ERROR`: 「ファイルの読み込みに失敗しました（アクセス権限またはストレージ状態を確認してください）」
- `WEBGL_UNSUPPORTED` / `WEBGL_INIT_FAILED`: 「WebGL2 描画の初期化に失敗しました」

### 4.2 個別ページデコード・読込エラー（閲覧継続可能・見開き片側エラー対応）

特定ページ `k` が `DecodedPageFrame`（`status: "error"`, `errorCode: "DECODE_FAILED" | "CORRUPT_ZIP" | "READ_ERROR"`）で失敗した場合：

- `diagnosticLogger.error("reader", ...)` へ記録し、`L1PageCache` へ `error` 状態を格納する。
- `ReaderErrorView`（`mode="page"`）は全 `slotPosition`（`"center" | "left" | "right"`、デフォルト `"center"`）において `data-slot-position={slotPosition}` を出力する。
- **単ページ時、または見開き 2 ページとも失敗時**: 画面中央（`slotPosition="center"`, `pageNumber` 省略）にページエラーカード（`data-testid="reader-page-error"`, `data-slot-position="center"`）を 1 枚表示する。見開き両側失敗時は **基準ページ（`currentPageIndex` 側、該当なし時は先頭スロット）の `errorCode` / `message` を代表** として採用する。
- **見開きで片側のみ失敗し相方が `status: "ready"` 時**: 正常ページは WebGL2 で対応スロット（`left` / `right`）にそのまま描画し、失敗した側の半面（`slotPosition: "left" | "right"`, `w-1/2`, `data-slot-position="left" | "right"`）のみに該当 1 始まり `pageNumber` 付きのページエラーカードを重ねて表示する。いずれの場合も **前後ページへの移動・スワイプ・HUD・戻る操作はそのまま継続可能** とする。

### 4.3 ローディング表示

- アーカイブ解析中、または現在表示対象スロットのフレームが L1 に揃うまでの間は、控えめなローディングインジケータ（`data-testid="reader-loading"`）を表示し、描画対象確定とともに非表示にする。

---

## 5. コンポーネント構成と親子分離（1対1 Story / UT 対象）

| モジュール / コンポーネント | ファイルパス                                | 責務（テスト分離方針）                                                                                                                                                        |
| :-------------------------- | :------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spreadLayout`              | `src/features/reader/spreadLayout.ts`       | `effectiveSpreadMode` 判定、見開きスロット計算、動的ペアリング/前頁アンカー/`1ページずらし`、L1 5頁窓・先読み対象算出、`rtl`/`ltr` 入力判定純関数群                           |
| `ReaderPage`                | `src/features/reader/ReaderPage.tsx`        | `TR-10` ガード、向き追跡、0RTT 目次・`readingProgress` レジューム/保存、`readerSettings` 読込/保存、優先度2戻る制御、シーク＆Fast-Path / Epoch / `L1PageCache` 制御、終了解放 |
| `ReaderCanvas`              | `src/webgl/ReaderCanvas.tsx`                | 生 WebGL2 2スロット・1パス画質補正対応キャンバス、`ResizeObserver`、非同期 `MAX_TEXTURE_SIZE` 再描画、コンテキストロスト復帰（`webgl2-renderer.md`）                          |
| `ReaderHudOverlay`          | `src/features/reader/ReaderHudOverlay.tsx`  | 上部バー（戻る・ファイル名・画質補正）＆下部 3 段バー（`rtl`/`ltr` 連動シークバー・ドラッグプレビュー・次前ナビ・表示モード・1ページずらし・右/左開き）                       |
| `ReaderShaderSheet`         | `src/features/reader/ReaderShaderSheet.tsx` | クイック画質補正ボトムシート（4スライダー・リアルタイム反映・ワンタップリセット・デフォルト保存・透明クリックキャッチバックドロップ）                                         |
| `ReaderErrorView`           | `src/features/reader/ReaderErrorView.tsx`   | アーカイブ全体エラーパネルおよびスロット位置対応（`center` / `left` / `right`）個別ページデコードエラー表示                                                                   |

- `ReaderPage` の単体テストでは `ReaderCanvas`, `ReaderHudOverlay`, `ReaderShaderSheet`, `ReaderErrorView` を `vi.spyOn(...).mockImplementation(() => null)` で完全分離する。

---

## 6. 受け入れ条件（`AC-RD-xx`）

|   AC ID    | 受け入れ条件                                                                                                                                                                                                                              |
| :--------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-RD-01` | `/read/local` でメモリ上の `File` セッションが不在の場合、エラー停止せず即時 `/` へフォールバックする（`TR-10`）。                                                                                                                        |
| `AC-RD-02` | オープン直後は HUD 非表示のフルスクリーンで開始し、中央 40% タップで上下 HUD を開閉できる。                                                                                                                                               |
| `AC-RD-03` | `ReadingDirection` に応じて、右開き（`rtl`：左 30% タップ／左→右スワイプ／`ArrowLeft`＝次）と左開き（`ltr`：右 30% タップ／右→左スワイプ／`ArrowRight`＝次）が完全反転して動作する。                                                      |
| `AC-RD-04` | 下部 HUD 中段にページ表記（`1 / 24` または `2-3 / 24`）と開き方向対応「次へ」「前へ」ボタンが表示され、先頭・最終表示ページ/見開きで適切に `disabled` になる。                                                                            |
| `AC-RD-05` | ページ遷移ごとに閲覧優先順の `prefetchIndices`（`+1..+20`, `-1..-2`）および L1 近傍バッチ要求を 1 `epoch` 単位で連携し、連続めくり時の古い `requestEpoch` 進行中 I/O 中断および遅延到着 `ImageBitmap` の即時 `close()` が行われる。       |
| `AC-RD-06` | 破損・空・暗号化・未対応圧縮・読込失敗（`READ_ERROR`）・WebGL2 失敗時は診断ログ記録の上で理由別エラー画面と「ホームへ戻る」を表示する。                                                                                                   |
| `AC-RD-07` | 個別ページのみのデコード失敗時は当該ページのみエラー表示とし、前後ページへの移動を阻害しない。                                                                                                                                            |
| `AC-RD-08` | ボトムシート非表示時の戻るボタン・`Escape` キー・Android ハードウェア戻るボタンで `TR-08`（進捗フラッシュ・Worker 停止・L1 `bitmap.close()`・WebGL 破棄・セッションクリア）を実行し `/` へ戻る。                                          |
| `AC-RD-09` | 対象 TSX/TS ファイルすべてが 1 対 1 Story/UT・親子分離・C0/C1/Functions/Lines 100%・1280px/375px VRT を PASS する。                                                                                                                       |
| `AC-RD-10` | `SpreadMode`（`"auto" \| "single" \| "spread"`）が画面向きに追従し、表紙 0P（`offset === 0`）および自身/隣接横長画像（`width > height`）を自動単独中央表示した上で、後続ページから自動再ペアリング・`1ページずらし` 1頁シフトが機能する。 |
| `AC-RD-11` | 下部 HUD 下段に表示モード循環・1ページずらし（単ページ時 `disabled`）・右/左開き切替を備え、375px 縦幅・1280px 横幅ともに崩れず操作できる。                                                                                               |
| `AC-RD-12` | 見開き時の Fast-Path（`[N, N+1]`）・L1 5 枚保護窓が連携し、片側ページエラー時は正常側スロットをそのまま WebGL2 描画したまま失敗側半面のみにエラーを表示する。                                                                             |
| `AC-RD-13` | 上部 HUD から開閉する画質補正ボトムシートで 4 スライダーのリアルタイム反映・ワンタップリセット・`syncMeta['defaultReaderSettingsJson']` デフォルト保存が機能し、シート表示中の Android 戻る・`Escape`・背景タップはシートのみを閉じる。   |
| `AC-RD-14` | 下部 HUD のシークバーが `rtl`（右端 1P）／`ltr`（左端 1P）に視覚連動し、ドラッグ中は Worker 通信を行わずページ番号プレビューのみを表示し、確定時に新 `requestEpoch` で指定ページへジャンプする。                                          |
| `AC-RD-15` | ページ遷移・ずらし変更・`TR-08`・`popstate`・`pagehide`・`visibilitychange(hidden)` 時に `readingProgress`（`reading` / `completed`・`spreadPageOffset`）を保存し、同一ローカル ZIP 再オープン時に保存位置から自動レジュームする。        |
