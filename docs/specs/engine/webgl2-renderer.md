---
type: spec-engine
title: "生 WebGL2 レンダラー＆L1キャッシュ仕様書"
description: "WebGLRendererCore のハードウェア Mipmap 描画、DPR 追従、webglcontextlost 復帰、および L1PageCache の ImageBitmap.close() 厳格解放規約の正本"
status: "Review (#1)"
updated: "2026-11-20"
tags: [engine, webgl2, mipmap, l1-cache, imagebitmap, vram]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/engine/zip-streaming.md
  - docs/specs/features/reader.md
  - docs/guidelines/testing.md
related_tests:
  - src/webgl/l1PageCache.test.ts
  - src/webgl/shaders.test.ts
  - src/webgl/WebGLRendererCore.test.ts
  - src/webgl/ReaderCanvas.test.tsx
  - test/vrt/vrt.spec.ts
  - test/it/smoke.spec.ts
  - test/it/local-reader.spec.ts
---

# 生 WebGL2 レンダラー＆L1 キャッシュ仕様書

本ドキュメントは、ExLibris の **Layer 4（Viewer Engine）** における `L1PageCache`（UI/GPU 側 `ImageBitmap` 窓管理）および `WebGLRendererCore` / `<ReaderCanvas>`（生 WebGL2 ハードウェア Mipmap 単ページ描画）の正本（Single Source of Truth）です。

---

## 1. モジュール構成とテスト分離方針

WebGL2 コンテキスト API と `ImageBitmap` ライフサイクルを React DOM から分離し、Vitest 上でモック `WebGL2RenderingContext` と `FakeImageBitmap`（`close()` スパイ）を用いて C0/C1/Functions/Lines 100% で検証します。

| モジュールパス                   | 責務                                                                                                            |
| :------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| `src/webgl/l1PageCache.ts`       | `L1_MAX_PAGES = 5` 上限の L1 `ImageBitmap` ＋ ページ状態（`ready` / `error`）管理と即時 `close()`               |
| `src/webgl/shaders.ts`           | 生 WebGL2 頂点シェーダー・フラグメントシェーダー GLSL ソース定数（Mipmap 等倍パススルー）                       |
| `src/webgl/WebGLRendererCore.ts` | WebGL2 パイプライン本体（シェーダー初期化、テクスチャアップロード＋`generateMipmap`、アスペクト維持描画、復帰） |
| `src/webgl/ReaderCanvas.tsx`     | `<canvas>` マウント、`ResizeObserver` DPR 追従、`webglcontextlost`/`restored` イベント配線、決定論的 DOM 属性   |

---

## 2. `L1PageCache`（VRAM / `ImageBitmap` 厳格解放）仕様

### 2.1 保持上限と状態モデル

- 上限ページ数: `ENGINE_BUDGETS.L1_MAX_PAGES = 5`（現在ページ `N` ＋ 進行方向 `N+1`, `N+2` ＋ 逆方向 `N-1` 等を保持）。
- エントリ状態（`architecture.md §2.3` の `DecodedPageFrame` ユニオンと 1 対 1 対応）:
  - `ready`: `{ status: "ready", pageIndex, epoch, bitmap, width, height }`
  - `error`: `{ status: "error", pageIndex, epoch, errorCode, message }`（特定ページ読込・デコード破損時。前後ページへのスキップを阻害しない）

### 2.2 退避・解放ルール（`bitmap.close()` 不変条件）

1. **同一ページ上書き時**: 既存の `ready` エントリが存在する場合は、新しい `bitmap` に差し替える前に旧 `bitmap.close()` と WebGL テクスチャ解放コールバック（`onEvictTexture(pageIndex)`）を必ず実行する。
2. **古い `requestEpoch` 破棄時**: 現在の有効世代（`minActiveEpoch`、`setMinActiveEpoch()` で設定）未満の `DecodedPageFrame` が登録要求された場合は、キャッシュへ入れず（`status === "ready"` であれば即座に `frame.bitmap.close()` を実行して）無視する。
3. **上限超過（Eviction）時**: キャッシュ件数が `L1_MAX_PAGES`（5 枚）を超えた場合、現在保護対象ウィンドウ（例: `[N-1, N, N+1, N+2]`）外の最古 LRU エントリから退避し、対象エントリが `status === "ready"` の場合に `onEvictTexture(evictedPageIndex)` および `evicted.bitmap.close()` を実行する（`error` エントリは Map からの参照削除のみ）。
4. **全解放（`clear()` / 巻クローズ / アンマウント時）**: 保持中の全エントリに対して、対象エントリが `status === "ready"` の場合に `onEvictTexture` と `bitmap.close()` を実行し（`error` エントリは Map からの参照削除のみ）、参照を空にする。

---

## 3. `WebGLRendererCore`（生 WebGL2 Mipmap パイプライン）仕様

### 3.1 Canvas 背景・ビューポート・DPR 追従

1. **背景色**: 純黒（`gl.clearColor(0.0, 0.0, 0.0, 1.0)`、OLED 端末ベゼルとのシームレス一体化）。
2. **DPR 解像度追従**:
   - CSS ピクセルサイズ `(cssWidth, cssHeight)` と `devicePixelRatio` から物理描画サイズ `Math.round(cssWidth * dpr)` × `Math.round(cssHeight * dpr)` を算出する。
   - GPU の `gl.getParameter(gl.MAX_VIEWPORT_DIMS)`（`[maxW, maxH]`）を参照し、超過する場合はアスペクト比を保ったまま安全上限内にクランプする。
   - クランプ後サイズに合わせて `canvas.width` / `canvas.height` と `gl.viewport(0, 0, width, height)` を更新する。

### 3.2 テクスチャ生成とハードウェア Mipmap（モアレ除去）

1. **アップロード契約**:
   - `gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)` を設定し、`gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)` で `ImageBitmap` を GPU へ転送する。
   - 直後に `gl.generateMipmap(gl.TEXTURE_2D)` を呼び出し、以下を固定適用する：
     - `TEXTURE_MIN_FILTER = gl.LINEAR_MIPMAP_LINEAR`（トリリニアフィルタによる縮小モアレ抑制）
     - `TEXTURE_MAG_FILTER = gl.LINEAR`
     - `TEXTURE_WRAP_S = gl.CLAMP_TO_EDGE`
     - `TEXTURE_WRAP_T = gl.CLAMP_TO_EDGE`
   - ※WebGL2 は NPOT（2のべき乗以外）の解像度でも `generateMipmap` と `CLAMP_TO_EDGE` が標準サポートされている。
2. **テクスチャキャッシュ連携**:
   - ページ番号ごとに生成済み `WebGLTexture` をマップ管理し、L1 退避通知（`deletePageTexture(pageIndex)`）を受けた瞬間に `gl.deleteTexture(texture)` を呼び出して VRAM から解放する。
3. **アスペクト比維持の中央内接フィット描画（単ページ）**:
   - ビューポートアスペクト比と画像アスペクト比を比較し、上下または左右に余白（純黒レターボックス）を設けて最大内接矩形へ頂点座標（または NDC スケール Uniform）を変換し、`gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)` で描画する。

### 3.3 `webglcontextlost` / `webglcontextrestored` 耐性

1. `<ReaderCanvas>` は `canvas` 要素で `webglcontextlost` リスナーを登録し、必ず **`event.preventDefault()`** を実行してコンテキスト復元を許可した上で、`diagnosticLogger.warn("webgl2", ...)` へ記録する。
2. `webglcontextrestored` 発火時、`WebGLRendererCore.reinitializeAfterContextLost()` を呼び出してシェーダープログラム・VAO/VBO を再構築し、**`L1PageCache` に残存している `ImageBitmap` から現在ページのテクスチャと Mipmap を自動再生成して再描画** する。
3. WebGL2 コンテキスト自体が取得不可、またはシェーダーのコンパイル/リンクに失敗した場合は、致命的エラーコールバック（`WEBGL_UNSUPPORTED` / `WEBGL_INIT_FAILED`）を発火する。

---

## 4. `<ReaderCanvas>` コンポーネント仕様

- **役割**: 純粋な WebGL2 描画ホスト（ページ送りビジネスロジックや HUD UI は持たない）。
- **決定論的テスト用 DOM 属性**:
  - `data-testid="reader-canvas"`
  - `data-webgl-status`: `"initializing" | "ready" | "context-lost" | "error"`
  - `data-rendered-page`: 現在 WebGL2 で描画完了した 0 始まり `pageIndex`（未描画時は `""`）
  - `data-rendered-epoch`: 描画した `requestEpoch`
- **テスト分離**: `<ReaderCanvas>` の単体テストおよび上位 `<ReaderPage>` の単体テストでは、モック `WebGL2RenderingContext` または子コンポーネントスパイにより Headless JSDOM 環境でも 100% 検証可能とする。

---

## 5. 受け入れ条件（`AC-GL-xx`）

|   AC ID    | 受け入れ条件                                                                                                                                    |
| :--------: | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-GL-01` | `L1PageCache` は最大 5 ページを保持し、上限超過退避・古い `requestEpoch` 拒否・`clear()` 時に必ず `bitmap.close()` とテクスチャ破棄を実行する。 |
| `AC-GL-02` | `WebGLRendererCore` は純黒（`#000000`）背景で、画像アスペクト比を維持した中央内接フィット単ページ描画を行う。                                   |
| `AC-GL-03` | テクスチャ生成直後に `gl.generateMipmap(gl.TEXTURE_2D)` と `gl.LINEAR_MIPMAP_LINEAR` が必ず設定される。                                         |
| `AC-GL-04` | `ResizeObserver` と `devicePixelRatio`（`MAX_VIEWPORT_DIMS` クランプ付き）の変化に追従してバッファサイズと描画が更新される。                    |
| `AC-GL-05` | `webglcontextlost` で `preventDefault()` が呼ばれ、`webglcontextrestored` で保持中の `ImageBitmap` から自動再描画復帰する。                     |
| `AC-GL-06` | `L1PageCache`・`WebGLRendererCore`・`<ReaderCanvas>`（Story/UT）のすべてが C0/C1/Functions/Lines 100% カバレッジを達成する。                    |
