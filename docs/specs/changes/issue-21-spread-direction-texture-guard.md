---
type: spec-delta
title: "Issue #21 差分仕様: インテリジェント見開き・1ページずらし・右/左開き・MAX_TEXTURE_SIZE ガード"
description: "SpreadMode（auto/single/spread）画面向き連動、動的アンカー見開きペアリングと1ページずらし、右開き/左開き入力・HUD反転、片側ページエラー時スロット表示、およびWebGLRendererCoreのMAX_TEXTURE_SIZEタイル分割・安全リサイズフォールバックを定義する差分仕様"
status: "Review (#21)"
updated: "2026-11-21"
issue: "#21"
tags:
  [
    delta,
    v0.1,
    spread,
    reading-direction,
    webgl2,
    max-texture-size,
    hud,
    l1-cache,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/webgl2-renderer.md
  - docs/specs/features/reader.md
  - docs/guidelines/workflow.md
  - docs/guidelines/testing.md
  - docs/quality/bug-and-handover-log.md
related_tests:
  - src/webgl/shaders.test.ts
  - src/webgl/WebGLRendererCore.test.ts
  - src/webgl/ReaderCanvas.test.tsx
  - src/webgl/l1PageCache.test.ts
  - src/features/reader/ReaderHudOverlay.test.tsx
  - src/features/reader/ReaderErrorView.test.tsx
  - src/features/reader/ReaderPage.test.tsx
  - test/vrt/vrt.spec.ts
  - test/it/local-reader.spec.ts
---

# Issue #21 差分仕様: インテリジェント見開き・1ページずらし・右/左開き・`MAX_TEXTURE_SIZE` ガード

## 1. 背景・目的（Why）

- Phase 3 PoC では右開き（`rtl`）・単ページ表示（`single`）固定であった `SCR-03` リーダーを `v0.1` 完成版コアリーダー要件（[requirements.md §4](../requirements.md#4-全機能カタログとマイルストーン割当マトリクス)）へ進化させ、タブレット横向き環境での **インテリジェント2ページ見開き制御**、見開きずれを即座に修正する **「1ページずらし」**、および **右開き（`rtl`）／左開き（`ltr`）切替** を実装する。
- Android WebView 端末の `gl.MAX_TEXTURE_SIZE`（例: 4096px）を超える高解像度・大判見開きスキャン画像が `gl.texImage2D` 時にエラー・黒画面化するのを防ぐため、`WebGLRendererCore` に **`MAX_TEXTURE_SIZE` 上限検知・タイル分割／安全リサイズフォールバック**（[architecture.md §3.2](../architecture.md#32-gpu-テクスチャmax_texture_size-ガードl1-解放規律)）を実装する。

### 1.1 Step 1 合意事項（`/grill-me` 確定内容：Q1〜Q7）

1. **`SpreadMode` 3状態と画面向き自動追従（Q1）**:
   - `SpreadMode` を `"auto" | "single" | "spread"`（初期値 `"auto"`）とする。`"auto"` 時はビューポートが横長（`viewportWidth > viewportHeight`）なら `"spread"`、縦長・正方形（`viewportWidth <= viewportHeight`）なら `"single"` へ自動追従し、`"single"` / `"spread"` 選択時は画面向きに依存せず固定表示する。
2. **動的アンカーペアリングと「1ページずらし」（Q2）**:
   - 見開き有効時でも、①表紙先頭（`pageIndex === 0 && spreadPageOffset === 0`）、②自身またはペア候補（`pageIndex + 1`）の元画像が横長（`width > height`、厳密不等号）、③最終端（`pageIndex + 1 >= totalPages`）のいずれかに該当する場合は **1枚単独中央表示（`position: "center"`）** とする。
   - 途中に横長見開き結合済み画像（`width > height`）が登場した場合も、次頁送り時は `displayedSlots.length`（`+1` / `+2`）で進行することで後続ページから自動的に再ペアリングする（ただし最終表示頁 `maxDisplayedPageIndex >= totalPages - 1` 到達時は全入力で次頁遷移を no-op とする）。セッション内の既知ページ寸法マップ（`Map<number, PageDimensions>`）と遷移履歴スタック（`spreadHistory`：`spreadPageOffset` 変更および `effectiveSpreadMode === "single"` 遷移時にクリア）を保持し、前頁戻り時も往路と一致したペアリングを復元する（履歴未保持時のみ近傍既知寸法に基づくフォールバック計算を実施）。
   - 「1ページずらし（`spreadPageOffset: 0 | 1`）」切替時は、`currentPageIndex === 0`（または `totalPages <= 1`）なら同一基準のまま `[0] ↔ [0, 1]` を切り替え、`currentPageIndex >= 1` なら `nextOffset === 1` 時は原則 `+1`（最終頁時のみ `-1`）、`nextOffset === 0` 時は原則 `-1`（`currentPageIndex === 1` 時のみ 3 頁以上なら `2`、2 頁本なら `0`）へ基準ページを移動して即座にペアを再構成する。
3. **`MAX_TEXTURE_SIZE` 超過時のタイル分割描画＋安全リサイズフォールバック（Q3）**:
   - `WebGLRendererCore` 初期化・復帰時に `gl.getParameter(gl.MAX_TEXTURE_SIZE)` を取得・保持する。
   - スロット画像が `width > maxTextureSize || height > maxTextureSize` の場合、`diagnosticLogger.warn("webgl2", ...)` へ記録した上で、超過軸を `cols = Math.ceil(width / maxTextureSize)`, `rows = Math.ceil(height / maxTextureSize)` のグリッドへ分割し、`createImageBitmap(bitmap, sx, sy, sw, sh)` で生成した一時タイル群を複数 `WebGLTexture` へ転送（アップロード直後に一時タイル `ImageBitmap.close()` を即実行）して原寸のまま隙間なく描画する。タイル数が上限（`MAX_SPLIT_TILES = 16`）を超える極端な画像や分割生成失敗時のみ、アスペクト比維持の上限内安全リサイズ（`createImageBitmap(bitmap, { resizeWidth, resizeHeight, resizeQuality: "high" })`）へフォールバックする（各 `await` 前後でのキャンセル再検証・途中タイル破棄・失敗時無限リトライ抑止ガードを具備）。
4. **2スロット見開き描画・片側エラー表示・L1 Fast-Path 連携（Q4）**:
   - 2スロット描画時は背表紙境界で左右ページの隙間を作らず高さを揃えた結合矩形として中央内接フィット描画する。
   - 見開きペアの片側のみ `status: "error"`・もう片側が `status: "ready"` の場合は、正常ページを所定の `left` / `right` スロットへ WebGL2 描画し、失敗側の半面（`w-1/2`, `data-slot-position="left" | "right"`）のみに `ReaderErrorView`（`mode="page"`, 1 始まり `pageNumber` 付き）を重ねて表示する（両方失敗時は基準ページ側のエラーを代表として `slotPosition="center"` を 1 枚表示、単ページ時は中央 1 枚表示）。
   - 見開き時の Fast-Path は候補 `[N, N+1]`（表紙・横長・末尾等の単枚確定ケースを除く）を 1 バッチで要求し、`L1PageCache`（`L1_MAX_PAGES = 5`）は表示スロット昇順端 `(first, last)` を基準とした保護ウィンドウ `[first-1, first, ...(last > first ? [last] : []), last+1, last+2]`（単枚表示時は最大 4 枚 `[N-1, N, N+1, N+2]`、2 枚見開き時は最大 5 枚 `[N-1, N, N+1, N+2, N+3]`）外の `ImageBitmap.close()` と対応 `WebGLTexture` 全タイル破棄を厳格実行する。
5. **2段構成の下部 HUD レイアウト（1280px / 375px 両立）（Q5）**:
   - `ReaderHudOverlay` の下部バー（`reader-hud-bottom`）を 2 段構成とし、上段にページ移動ナビゲーション（次へ・ページ表示 `2-3 / 24`・前へ）、下段に 3 つの制御ボタン（表示モード循環［`自動(見開き)` / `自動(単頁)` / `見開き` / `単ページ`］、1ページずらしトグル［`totalPages <= 1 || effectiveSpreadMode === "single"` 時は `disabled`］、右/左開きトグル［`右開き` / `左開き`］）を配置する。
6. **左開き（`ltr`）入力操作の完全反転（Q6）**:
   - `ltr` 時は `rtl` の完全反転とし、**右端 30% タップ・右→左スワイプ（`dx < 0`）・`ArrowRight`** で次頁、**左端 30% タップ・左→右スワイプ（`dx > 0`）・`ArrowLeft`** で前頁へ移動し、下部 HUD 上段の配置も左「`← 前へ`」・右「`次へ →`」へ入れ替える（最終見開き表示中は「次へ」ボタン・タップ・スワイプ・キーすべてを無効化する）。
7. **Android 実機検証タイミング（Q7）**:
   - [workflow.md §2.2](../../guidelines/workflow.md#22-android-実機検証の実施判断基準と試験項目表フォーマット) の **区分 A（親 Issue #21 完了前実施）** とし、`HO-07`（完了ゲート: `親 Issue #21 完了前`）を登録する。

### 1.2 対象外スコープ

- `readingProgress` / `spreadPageOffset` の Dexie.js 永続化・シークバー・自炊画質補正シェーダー（→ Issue #22 `[v0.1][5/5]`）
- 作品ごとの見開き/綴じ方向プリセット保存・ピンチズーム・オートクロップ（→ `v0.4`）

---

## 2. 変更対象の App 全体正本一覧

|   種別   | 正本ファイル                                                     | 変更概要                                                                                                                                                                               |
| :------: | :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **更新** | [architecture.md](../architecture.md)                            | `SpreadMode` (`"auto" \| "single" \| "spread"`), `ViewportSlotLayout` / `RenderSlotFrame` 型契約、動的アンカー見開きルール、`MAX_TEXTURE_SIZE` タイル分割＆安全リサイズ設計を反映      |
| **更新** | [webgl2-renderer.md](../engine/webgl2-renderer.md)               | `src/webgl/types.ts`、`u_offset` 頂点シェーダー、`WebGLRendererCore.renderSlots`（2スロット背表紙密着＋`MAX_TEXTURE_SIZE` 非同期分割）、`ReaderCanvas` DOM 属性・`AC-GL-07`〜`08` 追加 |
| **更新** | [reader.md](../features/reader.md)                               | `spreadLayout.ts` 契約、見開き Fast-Path/L1 窓、`rtl`/`ltr` 双方向操作、2段下部 HUD、片側エラー `ReaderErrorView`、`AC-RD-10`〜`12` 追加                                               |
| **更新** | [screen-transitions.md](../screen-transitions.md)                | `SCR-03` `v0.1` 概要および `SCN-02` トレーサビリティ対応表へ見開き・1ページずらし・`rtl`/`ltr`・`MAX_TEXTURE_SIZE` 検証観点を追記                                                      |
| **更新** | [bug-and-handover-log.md](../../quality/bug-and-handover-log.md) | 区分 A 実機検証申し送り事項 **`HO-07`**（完了ゲート: `親 Issue #21 完了前`）および PR #44 Round 1 指摘是正記録（`No. 21`〜`26`）を登録                                                 |

---

## 3. 追加・変更する仕様の差分サマリー

### 3.1 共通型・レイアウト＆入力純関数エンジン（`src/webgl/types.ts`, `src/features/reader/spreadLayout.ts`）

1. **型契約（`src/webgl/types.ts`）**:
   - `ReadingDirection = "rtl" | "ltr"`
   - `SpreadMode = "auto" | "single" | "spread"`
   - `EffectiveSpreadMode = "single" | "spread"`
   - `SpreadPageOffset = 0 | 1`
   - `SlotPosition = "center" | "left" | "right"`
   - `ViewportSlot = { readonly pageIndex: number; readonly position: SlotPosition }`
   - `ViewportSlotLayout = { readonly slots: readonly ViewportSlot[] }`
   - `RenderSlotFrame = { readonly slot: ViewportSlot; readonly frame: DecodedPageFrame | null }`
   - `PageDimensions = { readonly width: number; readonly height: number }`
2. **純関数群（`src/features/reader/spreadLayout.ts`）**:
   - `resolveEffectiveSpreadMode(spreadMode, viewportWidth, viewportHeight)`: `"auto"` 時は `viewportWidth > viewportHeight`（正の有限値チェック付き）で `"spread"`、それ以外は `"single"`。
   - `computeViewportSlotLayout(...)`: 表紙単独・横長（`width > height`）自他単枚化・末尾単独・2スロット左右割当（`rtl`: `[N+1@left, N@right]` / `ltr`: `[N@left, N+1@right]`）を決定。
   - `getCandidateFetchPages(...)`: 見開き有効かつ単枚確定条件に該当しない場合のみ `[N, N+1]` の 2 ページを返し、単枚確定時は `[N]` を返す。
   - `buildSpreadProtectedWindow(visiblePages, effectiveSpreadMode, totalPages)` / `buildSpreadNeighborTargets(visiblePages, effectiveSpreadMode, totalPages)` / `buildSpreadPrefetchTargets(visiblePages, totalPages)`: 表示端 `first = visiblePages[0]`, `last = visiblePages[visiblePages.length - 1]` に対し、保護ウィンドウは単ページ時 `[first-1, first, first+1, first+2]`（最大 4 枚）・見開き時 `[first-1, first, ...(last > first ? [last] : []), last+1, last+2]`（単枚表示時は `[N-1, N, N+1, N+2]` 最大 4 枚・2 枚見開き時は `[N-1, N, N+1, N+2, N+3]` 最大 5 枚＝`L1_MAX_PAGES`）、近傍は `[last+1, last+2, first-1]`、先読みは `[last+1..last+20, first-1, first-2]`（すべて `0 <= idx < totalPages`）を構築する。
   - `computePreviousAnchorIndex(currentPageIndex, effectiveSpreadMode, spreadPageOffset, knownDimensions)`: `currentPageIndex <= 1` 時は先頭境界ガードとして `0`、`effectiveSpreadMode === "single"` 時は `currentPageIndex - 1`、見開き時 `prev1 = currentPageIndex - 1`, `prev2 = currentPageIndex - 2` に対し `(prev2 === 0 && spreadPageOffset === 0)` や `prev1`/`prev2` が横長なら `prev1`、それ以外は `prev2` を返す。
   - `computeShiftedAnchorOnOffsetToggle(currentPageIndex, nextOffset, totalPages)`: `totalPages <= 1 || currentPageIndex <= 0` は `0`、`currentPageIndex >= 1 && nextOffset === 1` は `currentPageIndex + 1 < totalPages ? currentPageIndex + 1 : currentPageIndex - 1`、`currentPageIndex >= 1 && nextOffset === 0` は `currentPageIndex - 1 >= 1 ? currentPageIndex - 1 : currentPageIndex + 1 < totalPages ? currentPageIndex + 1 : 0` を返す。
   - `formatPageIndicator(slots, totalPages)` / `resolveDirectionActionForTapRatio` / `resolveDirectionActionForSwipe` / `resolveDirectionActionForKey`: 表示インジケータ（`1 / 24`, `2-3 / 24`, `0 / 0`）および `rtl`/`ltr` 対称の入力判定を統一提供。

### 3.2 WebGL2 2スロット描画 ＆ `MAX_TEXTURE_SIZE` 上限ガード（`src/webgl/shaders.ts`, `src/webgl/WebGLRendererCore.ts`, `src/webgl/ReaderCanvas.tsx`）

1. **頂点シェーダー拡張（`src/webgl/shaders.ts`）**:
   - 既存 `uniform vec2 u_scale;` を維持しつつ `uniform vec2 u_offset;` を追加し、`gl_Position = vec4(a_position * u_scale + u_offset, 0.0, 1.0);` とする。
2. **`WebGLRendererCore` の `MAX_TEXTURE_SIZE` ガード＆タイル分割・リサイズ（`AC-GL-07`）**:
   - `initPipeline` / `reinitializeAfterContextLost` で `gl.getParameter(gl.MAX_TEXTURE_SIZE)` を取得（不正値時は安全デフォルト `4096`）し、`getMaxTextureSize()` を公開する。
   - スロットの `ImageBitmap` が `width > maxTextureSize || height > maxTextureSize` を超える場合、`failedOversizedBitmaps` へ未登録かつ未着手なら `diagnosticLogger.warn("webgl2", ...)` を記録した上で非同期タイル分割（`cols × rows <= 16` なら `createImageBitmap(bitmap, sx, sy, sw, sh)`、超過や未キャンセル失敗時は途中生成テクスチャ・一時 bitmap を解放して `createImageBitmap(bitmap, { resizeWidth, resizeHeight, resizeQuality: "high" })` へフォールバック）を実行する。各 `await` 前後でキャンセル・`disposed`・`contextGeneration`・`gl.isContextLost()` を検証し、生成した一時 `ImageBitmap` は `gl.texImage2D` 転送直後（およびキャンセル・異常時 `finally`）に必ず `close()` する。双方失敗時のみ `failedOversizedBitmaps` へ登録して再試行ループを抑止し `diagnosticLogger.error("webgl2", ...)` を記録する。
   - `notifyContextLost()` で即座に `contextGeneration` を進めて進行中非同期準備・ロスト済みテクスチャ・失敗ガードを破棄し、`deletePageTexture(pageIndex)` / `clearAllTextures()` 時は対象全タイルの `gl.deleteTexture()`・非同期キャンセル・失敗ガード解除を実行する。
3. **2スロット背表紙密着フィット ＆ 片側欠損時半面描画（`AC-GL-08`）**:
   - `renderSlots(slots: readonly RenderSlotFrame[]): readonly ViewportSlot[]` を新設し、実際に描画完了したスロット配列を返却する（既存 `renderFrame` は `renderSlots` への単一 `"center"` 委譲ラッパーとして維持する）。
   - 2 スロット双方が `ready` の場合は高さを揃えた結合矩形（`normWidthL + normWidthR`）をビューポート中央へ内接フィットし（片側が `MAX_TEXTURE_SIZE` 非同期待機中の間も結合配置を維持したまま準備済み側のみ先行描画）、背表紙（左右境界）の隙間をゼロとする。片側が `error` または `null` の場合のみ、`ready` 側スロットをその半面（`left` は `[-1, 0]`、`right` は `[0, +1]`）の背表紙 `x = 0` 寄せで内接フィット描画する。
4. **`<ReaderCanvas>` 拡張**:
   - `slots: readonly RenderSlotFrame[]` 入力へ移行し、`onAsyncTextureReady` コールバックで超過画像の非同期タイル完了時に再描画を行い、`webglcontextlost` 時は `renderer.notifyContextLost()` を呼び出す。
   - `data-rendered-page`（描画完了済みスロット内の昇順最小 0 始まり `pageIndex`、例: `"left:2,right:1"` では `"1"`）、`data-rendered-pages`（昇順カンマ区切り例 `"1,2"`）、`data-rendered-slots`（例 `"left:2,right:1"` / `"center:0"`）、`data-rendered-epoch` を出力する。

### 3.3 HUD 2段構成・片側エラー表示・`ReaderPage` 統合（`ReaderHudOverlay.tsx`, `ReaderErrorView.tsx`, `ReaderPage.tsx`）

1. **`ReaderHudOverlay` 下部バー 2段構成（`AC-RD-11`）**:
   - 上段: `rtl` では「`← 次へ`」「ページ表示」「`前へ →`」、`ltr` では「`← 前へ`」「ページ表示」「`次へ →`」を配置。最終見開き／ページが画面に表示中のとき（`maxDisplayedPageIndex >= totalPages - 1`）は次へボタンを `disabled`。
   - 下段: `reader-spread-mode-button`（`自動(見開き)` / `自動(単頁)` / `見開き` / `単ページ` 循環）、`reader-offset-toggle-button`（`1ページずらし`、`totalPages <= 1 || !isEffectiveSpread` 時は `disabled`、`aria-pressed` 付与）、`reader-direction-button`（`右開き` / `左開き` 切替）を配置（全ボタン `touch-manipulation`）。
2. **`ReaderErrorView` スロット位置対応（`AC-RD-12`）**:
   - `mode="page"` に任意プロパティ `slotPosition?: "center" | "left" | "right"`（デフォルト `"center"`）および `pageNumber?: number` を追加し、常に `data-slot-position={slotPosition}` を出力した上で、片側失敗時のみ `left` / `right` 半面（`w-1/2`）へ `pageNumber` 付きで表示する（両側失敗時は基準ページ側 `currentPageIndex` のエラーを代表として `slotPosition="center"`・`pageNumber` 省略で 1 枚表示）。
3. **`ReaderPage` 統合**:
   - コンテナ `ResizeObserver` ＋ `window` `"resize"` でビューポートサイズを追跡し、`initialSnapshot` でも `framesByPage` / `readingDirection` / `spreadMode` / `spreadPageOffset` / `viewportSize` を指定可能とする。
   - 受信した `DecodedPageFrame`（`status === "ready"`）の `{ width, height }` をセッション内 `knownDimensionsRef` へ記録し、見開きレイアウト判定・次前移動（`maxDisplayedPageIndex >= totalPages - 1` 時は全入力の次頁遷移を no-op）・`L1PageCache` 窓・入力判定（`rtl`/`ltr`）を統合する。
   - `spreadMode`・`effectiveSpreadMode`・`spreadPageOffset` 変化により表示候補が変化した際（`currentPageIndex === 0` の `[0] ↔ [0, 1]`、単→見開き切替、`"auto"` 縦→横回転追従を含む）は、`currentPageIndex` 不変でも新 `epoch` で `loadPageWindow` を再実行する（`effectiveSpreadMode` 不変の単なる寸法変化では再実行せず、`readingDirection` 変更時は L1 保持フレームから即時再レイアウト・再描画する）。

---

## 4. テスト計画（UT / VRT / IT）

| 層                                                   | テスト手法・対象                                                                                                                                                                                                                                                                                                                                                                                                                                              | 合格基準                                                           |
| :--------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------- |
| **MK-1: レイアウト＆WebGL2 コア Engine UT**          | `spreadLayout.test.ts`（`auto`/`single`/`spread` 向き切替・正方形境界・表紙単独・自他 `width > height` 単独・動的再ペアリング・`spreadPageOffset` ±1 シフト・`prev` 推定・`rtl`/`ltr` 入力判定・L1 5枚窓・`2-3 / 24` 表記）、`shaders.test.ts`（`u_offset` 検証）、`WebGLRendererCore.test.ts`（`MAX_TEXTURE_SIZE` 分割グリッド・リサイズフォールバック・一時タイル `bitmap.close()`・キャンセル・複数タイル破棄・2スロット背表紙密着・片側欠損描画・異常系） | C0 / C1 / Functions / Lines **100%** PASS                          |
| **MK-2: HUD・ErrorView UI コンポーネント UT/VRT**    | `ReaderHudOverlay.stories.tsx` / `ReaderHudOverlay.test.tsx`（単頁/見開き・`rtl`/`ltr` 順反転・`auto`/`spread`/`single` ラベル・`disabled` 境界・3ボタンコールバック・イベント遮断）、`ReaderErrorView.stories.tsx` / `ReaderErrorView.test.tsx`（`slotPosition: "center" \| "left" \| "right"`, `pageNumber`）、1280px/375px VRT 更新                                                                                                                        | C0 / C1 / Functions / Lines **100%** PASS ＆ VRT 1280px/375px PASS |
| **MK-3: `ReaderCanvas` ＆ `ReaderPage` 統合 UT/VRT** | `ReaderCanvas.stories.tsx` / `ReaderCanvas.test.tsx`（2スロット描画・非同期 `MAX_TEXTURE_SIZE` 再描画・コンテキストロスト復帰・DOM 属性群）、`ReaderPage.stories.tsx` / `ReaderPage.test.tsx`（親子分離下での `auto` 向き追従・横長自動単独・動的遷移・`spreadPageOffset`・`rtl`/`ltr` 操作・見開き Fast-Path `[N,N+1]`・片側エラー描画）、VRT 更新                                                                                                           | C0 / C1 / Functions / Lines **100%** PASS ＆ VRT 1280px/375px PASS |
| **Step 4: Playwright IT (`SCN-02`)**                 | `test/it/helpers.ts`（横長・縦長・`MAX_TEXTURE_SIZE + 100` 幅の合成 PNG/CBZ 生成ヘルパ追加）、`test/it/local-reader.spec.ts`（1280×800 見開き：表紙単独→1-2ペア→横長単独→次頁自動再ペアリング、1ページずらし、`rtl`↔`ltr` 全入力・HUD 反転、375×667 自動単頁、実 SwiftShader `MAX_TEXTURE_SIZE` 超過描画＋診断 WARN＋非黒ピクセル確認、片側エラー＋正常半面描画）                                                                                             | 全 `SCN-01` / `SCN-02` **100% PASS**                               |

---

## 5. 実装 Sub-issue 分割計画（MK 3分割 ＋ 最終 IT）

1. **MK-1（Logic & WebGL2 Core 層）**:
   - 対象: `src/webgl/types.ts`, `src/features/reader/spreadLayout.ts`, `src/features/reader/spreadLayout.test.ts`, `src/webgl/shaders.ts`, `src/webgl/shaders.test.ts`, `src/webgl/WebGLRendererCore.ts`, `src/webgl/WebGLRendererCore.test.ts`（および関連正本 `related_tests` 追記）
   - 目安規模: 約 350 行（製品コード）＋ 単体テスト（C0/C1/Functions/Lines 100%）
2. **MK-2（HUD・ErrorView UI コンポーネント ＆ Storybook/VRT 層）**:
   - 対象: `src/features/reader/ReaderHudOverlay.tsx`, `.stories.tsx`, `.test.tsx`, `src/features/reader/ReaderErrorView.tsx`, `.stories.tsx`, `.test.tsx`, `test/vrt/snapshots/*`
   - 目安規模: 約 200 行（製品コード）＋ Story/Portable Stories UT/VRT 1280px & 375px
3. **MK-3（`ReaderCanvas` ＆ `ReaderPage` 統合 ＆ Storybook/VRT 層）**:
   - 対象: `src/webgl/ReaderCanvas.tsx`, `.stories.tsx`, `.test.tsx`, `src/features/reader/ReaderPage.tsx`, `.stories.tsx`, `.test.tsx`, `test/vrt/snapshots/*`
   - 目安規模: 約 350 行（製品コード）＋ 親子完全分離 UT/VRT 1280px & 375px
4. **Step 4（IT 結合テスト・実機検証・差分仕様アーカイブ PR `Closes #21`）**:
   - 対象: `test/it/helpers.ts`, `test/it/local-reader.spec.ts`, `docs/quality/bug-and-handover-log.md`（`HO-07` 実機確認精算）, 本差分仕様の `Completed (Archived)` 化＆`docs/specs/changes/archive/` 移動、関連 App 全体正本の `Approved (#21)` 化
   - Gate 1〜6 通過後に `build-android.yml` を起動し、Android 実機検証項目表＋APK Artifact URL を提示して人間レビュー・マージにより `#21` クローズ。

---

## 6. 申し送り事項・Android 実機検証計画

- **判定（[workflow.md §2.2](../../guidelines/workflow.md#22-android-実機検証の実施判断基準と試験項目表フォーマット)）**: **区分 A（親 Issue #21 完了前に実施）**
  - **根拠**: 生 WebGL2 2スロット見開き描画・`MAX_TEXTURE_SIZE` 超過画像のタイル分割/縮小フォールバック（実機 GPU での非黒画面描画および一時タイル `ImageBitmap.close()` VRAM 解放安全性）・スマホ縦/タブレット横回転時の自動追従・`rtl`/`ltr` 動的タッチスワイプ反転を含み、実機検証観点が 3 項目以上見込まれるため。
- **申し送り事項登録（[bug-and-handover-log.md](../../quality/bug-and-handover-log.md)）**:
  - **`HO-07`**（完了ゲート: **`親 Issue #21 完了前`**）: Step 4 IT PR の Gate 1〜6 通過後、`build-android.yml` で生成した署名済み検証 APK にて以下を確認する：
    1. タブレット横向き（またはスマホ横回転）時に `auto` モードで表紙 0P が中央単独、以降 1-2 / 3-4 が隙間ゼロの見開き描画となり、横長画像ページが自動で単枚中央表示され次頁から自動再ペアリングされること。
    2. スマホ縦向き時に `auto` モードで単ページ自動表示となり、下部 HUD の「1ページずらし」が `disabled`・2段レイアウトがはみ出しなく操作でき、横回転でシームレスに見開きへ切り替わること。
    3. 「1ページずらし」および「右開き (`rtl`) / 左開き (`ltr`)」切替時に左右タップ領域・スワイプ方向・HUD「次へ/前へ」配置・`2-3 / 24` 表記が即座に反転整合すること。
    4. `MAX_TEXTURE_SIZE` を超える超高解像度見開き画像（または実機上限超サンプル）閲覧時に黒画面化や OOM クラッシュせず正常描画され、診断ログへ `warn ("webgl2", ...)` が記録され、連続めくり・`TR-08` 終了時もメモリ安定性が保たれること。
