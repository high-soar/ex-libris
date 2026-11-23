---
type: spec-engine
title: "生 WebGL2 レンダラー＆L1キャッシュ仕様書"
description: "WebGLRendererCore のハードウェア Mipmap 2スロット見開き描画、1パス画質補正シェーダー（画面微分5タップUSM＋白黒レベル＋標準ガンマ）、MAX_TEXTURE_SIZE タイル分割・安全リサイズガード、DPR 追従、webglcontextlost 復帰、および L1PageCache の ImageBitmap.close() 厳格解放規約の正本"
status: "Approved"
updated: "2026-11-23"
tags:
  [
    engine,
    webgl2,
    mipmap,
    shader,
    unsharp-mask,
    gamma,
    l1-cache,
    imagebitmap,
    vram,
    spread,
    max-texture-size,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/zip-streaming.md
  - docs/specs/features/reader.md
  - docs/guidelines/testing.md
related_tests:
  - src/webgl/l1PageCache.test.ts
  - src/webgl/shaderParams.test.ts
  - src/webgl/shaders.test.ts
  - src/webgl/WebGLRendererCore.test.ts
  - src/webgl/ReaderCanvas.test.tsx
  - test/vrt/vrt.spec.ts
  - test/it/smoke.spec.ts
  - test/it/local-reader.spec.ts
---

# 生 WebGL2 レンダラー＆L1 キャッシュ仕様書

本ドキュメントは、ExLibris の **Layer 4（Viewer Engine）** における `L1PageCache`（UI/GPU 側 `ImageBitmap` 窓管理）および `WebGLRendererCore` / `<ReaderCanvas>`（生 WebGL2 ハードウェア Mipmap 単ページ／2スロット見開き描画・1パス画質補正シェーダー・`MAX_TEXTURE_SIZE` ガード）の正本（Single Source of Truth）です。

---

## 1. モジュール構成とテスト分離方針

WebGL2 コンテキスト API と `ImageBitmap` ライフサイクルを React DOM から分離し、Vitest 上でモック `WebGL2RenderingContext` と `FakeImageBitmap`（`close()` スパイ）を用いて C0/C1/Functions/Lines 100% で検証します。

| モジュールパス                   | 責務                                                                                                                                                              |
| :------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/webgl/types.ts`             | `ReadingDirection`, `SpreadMode`, `EffectiveSpreadMode`, `SpreadPageOffset`, `ViewportSlotLayout`, `RenderSlotFrame`, `ShaderCorrectionParams` 等の純粋共有型定義 |
| `src/webgl/shaderParams.ts`      | `DEFAULT_SHADER_CORRECTION_PARAMS`, `SHADER_PARAM_RANGES`, `normalizeShaderCorrectionParams`, `isDefaultShaderParams`, `formatShaderParamsAttribute` 実行時純関数 |
| `src/webgl/l1PageCache.ts`       | `L1_MAX_PAGES = 5` 上限の L1 `ImageBitmap` ＋ ページ状態（`ready` / `error`）管理と即時 `close()`                                                                 |
| `src/webgl/shaders.ts`           | 生 WebGL2 頂点シェーダー（`u_scale` + `u_offset`）・1パス画質補正フラグメントシェーダー（画面微分 5タップ USM ＋ 白黒レベル ＋ 標準ガンマ）GLSL ソース定数        |
| `src/webgl/WebGLRendererCore.ts` | WebGL2 パイプライン本体（`MAX_TEXTURE_SIZE` 分割/リサイズ、Mipmap 転送、4補正 Uniform バインド、単頁/2スロット背表紙密着フィット描画、復帰解放）                  |
| `src/webgl/ReaderCanvas.tsx`     | `<canvas>` マウント、`ResizeObserver` DPR 追従、`shaderParams` 状態常時同期＆再描画、非同期テクスチャ準備再描画、`webglcontextlost`/`restored` 配線、DOM 属性     |

---

## 2. `L1PageCache`（VRAM / `ImageBitmap` 厳格解放）仕様

### 2.1 保持上限と状態モデル

- 上限ページ数: `ENGINE_BUDGETS.L1_MAX_PAGES = 5`（単ページ時は現在頁 `N`＋近傍 `[N-1, N, N+1, N+2]`、見開き時は現在2頁＋次見開き＋前1頁 `[N-1, N, N+1, N+2, N+3]` を保護対象として保持）。
- エントリ状態（`architecture.md §2.3` の `DecodedPageFrame` ユニオンと 1 対 1 対応）:
  - `ready`: `{ status: "ready", pageIndex, epoch, bitmap, width, height }`
  - `error`: `{ status: "error", pageIndex, epoch, errorCode, message }`（特定ページ読込・デコード破損時。前後ページへのスキップを阻害しない）

### 2.2 退避・解放ルール（`bitmap.close()` 不変条件）

1. **同一ページ上書き時**: 既存の `ready` エントリが存在する場合は、新しい `bitmap` に差し替える前に旧 `bitmap.close()` と WebGL テクスチャ解放コールバック（`onEvictTexture(pageIndex)`）を必ず実行する。
2. **古い `requestEpoch` 破棄時**: 現在の有効世代（`minActiveEpoch`、`setMinActiveEpoch()` で設定）未満の `DecodedPageFrame` が登録要求された場合は、キャッシュへ入れず（`status === "ready"` であれば即座に `frame.bitmap.close()` を実行して）無視する。
3. **上限超過（Eviction）時**: キャッシュ件数が `L1_MAX_PAGES`（5 枚）を超えた場合、現在保護対象ウィンドウ（`protectedPages`）外の最古 LRU エントリから退避し、対象エントリが `status === "ready"` の場合に `onEvictTexture(evictedPageIndex)` および `evicted.bitmap.close()` を実行する（`error` エントリは Map からの参照削除のみ）。
4. **全解放（`clear()` / 巻クローズ / アンマウント時）**: 保持中の全エントリに対して、対象エントリが `status === "ready"` の場合に `onEvictTexture` と `bitmap.close()` を実行し（`error` エントリは Map からの参照削除のみ）、参照を空にする。

---

## 3. `WebGLRendererCore`（生 WebGL2 Mipmap ＆ 見開き・`MAX_TEXTURE_SIZE` パイプライン）仕様

### 3.1 Canvas 背景・ビューポート・DPR 追従

1. **背景色**: 純黒（`gl.clearColor(0.0, 0.0, 0.0, 1.0)`、OLED 端末ベゼルとのシームレス一体化）。
2. **DPR 解像度追従**:
   - CSS ピクセルサイズ `(cssWidth, cssHeight)` と `devicePixelRatio` から物理描画サイズ `Math.round(cssWidth * dpr)` × `Math.round(cssHeight * dpr)` を算出する。
   - GPU の `gl.getParameter(gl.MAX_VIEWPORT_DIMS)`（`[maxW, maxH]`）を参照し、超過する場合はアスペクト比を保ったまま安全上限内にクランプする。
   - クランプ後サイズに合わせて `canvas.width` / `canvas.height` と `gl.viewport(0, 0, width, height)` を更新する。

### 3.2 テクスチャ生成・ハードウェア Mipmap・`MAX_TEXTURE_SIZE` ガード

1. **`MAX_TEXTURE_SIZE` 取得と公開**:
   - `initPipeline()` および `reinitializeAfterContextLost()` 時に `gl.getParameter(gl.MAX_TEXTURE_SIZE)` を取得し、正の有限数値へ正規化して保持する（ドライバまたはモックが非数・未定義を返す場合のみ安全デフォルト `4096` を採用）。`getMaxTextureSize()` で現在の上限値を公開する。
2. **通常アップロード契約（`width <= maxTextureSize && height <= maxTextureSize`）**:
   - `gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)` を設定し、`gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)` で `ImageBitmap` を GPU へ同期転送する（1 タイル `{ xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 1 }` として管理）。
   - 直後に `gl.generateMipmap(gl.TEXTURE_2D)` を呼び出し、以下を固定適用する：
     - `TEXTURE_MIN_FILTER = gl.LINEAR_MIPMAP_LINEAR`（トリリニアフィルタによる縮小モアレ抑制）
     - `TEXTURE_MAG_FILTER = gl.LINEAR`
     - `TEXTURE_WRAP_S = gl.CLAMP_TO_EDGE`
     - `TEXTURE_WRAP_T = gl.CLAMP_TO_EDGE`
3. **`MAX_TEXTURE_SIZE` 超過時の自動タイル分割／安全リサイズフォールバック（`AC-GL-07`）**:
   - `bitmap.width > maxTextureSize || bitmap.height > maxTextureSize` を検知し、まだ当該 `bitmap` のテクスチャが未準備・未着手かつ同一コンテキスト世代内で準備失敗記録（`failedOversizedBitmaps`）に未登録の場合：
     1. `diagnosticLogger.warn("webgl2", ...)` へ画像サイズ・上限値・フォールバック方式を 1 回記録する。
     2. `cols = Math.ceil(bitmap.width / maxTextureSize)`、`rows = Math.ceil(bitmap.height / maxTextureSize)` を算出し、合計タイル数 `cols * rows <= 16`（`MAX_SPLIT_TILES = 16`）の場合は各タイル矩形 `(sx, sy, sw, sh)` を `bitmapCropper`（デフォルト `createImageBitmap(bitmap, sx, sy, sw, sh)`）で非同期切り出しする。**各 `await` の前後** で `!disposed && contextGeneration === capturedGen && pendingBitmaps.get(pageIndex) === frame.bitmap && !(gl.isContextLost?.() ?? false)` を再検証し、中断時は保持中の一時 `ImageBitmap` を即 `close()` し、リサイズフォールバックや `diagnosticLogger.error` を行わず終了する。
     3. `cols * rows > 16` の極端な超高解像度画像または（未キャンセル状態での）`bitmapCropper` 失敗時は、分割途中で生成済みの途中 `WebGLTexture`／一時 `ImageBitmap` を即解放した上で、アスペクト比を維持して長辺 `<= maxTextureSize`（最小 `1`）に収めた縮小寸法を算出し、`bitmapResizer`（デフォルト `createImageBitmap(bitmap, { resizeWidth, resizeHeight, resizeQuality: "high" })`）へ自動フォールバックする（完了後にも同じキャンセル・コンテキストロスト再検証を実施）。
     4. 取得した一時 `ImageBitmap` 群は `gl.texImage2D` ＋ `gl.generateMipmap` 転送直後（およびキャンセル・コンテキストロスト・破棄・例外発生時の `finally`）に **必ず即時 `close()` を呼び出し**、リークを完全に防ぐ。
     5. 非同期準備が未キャンセル・有効世代で完了した場合のみ全タイル `WebGLTexture` を登録し、`onAsyncTextureReady(pageIndex)` コールバックを通知して再描画を発火する。未キャンセル状態で `bitmapResizer` も失敗した場合（またはアップロードに失敗した場合）は途中生成した `WebGLTexture` をすべて `gl.deleteTexture()` で破棄し、`failedOversizedBitmaps` へ登録して再レンダー時の無限リトライを抑止した上で `diagnosticLogger.error("webgl2", ...)` を 1 回記録して安全に中断する。
4. **複数タイル対応のテクスチャキャッシュ連携**:
   - ページ番号ごとに生成済み `WebGLTexture` 配列（`tiles`）をマップ管理し、`deletePageTexture(pageIndex)`・同一ページ別画像上書き・`clearAllTextures()` 時に **対象ページの全タイル `gl.deleteTexture(tile.texture)`、進行中非同期準備のキャンセル、および失敗ガード解除** を確実に実行する。

### 3.3 単ページ／2スロット見開き配置描画（`renderSlots`）

1. **頂点座標変換（`u_scale` ＋ `u_offset`）**:
   - 頂点シェーダーで `gl_Position = vec4(a_position * u_scale + u_offset, 0.0, 1.0)` を適用し、各スロット矩形内の各タイル（`[xFrac, yFrac, wFrac, hFrac]`）を厳密に隙間なく配置して `gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)` で描画する。
2. **単ページモード（`position: "center"`）**:
   - ビューポートアスペクト比と画像アスペクト比を比較し、純黒レターボックス付きで中央最大内接矩形へフィット描画する。
3. **2スロット見開きモード（`position: "left" | "right"`）**:
   - **両スロット `status === "ready"` 時**: 左右画像の寸法を用い共通の縦表示高さに正規化（`normWidthL = wL / hL`, `normWidthR = wR / hR`）した結合アスペクト比 `normWidthL + normWidthR` で両スロットの描画矩形を確定し、背表紙接点隙間ゼロ・ビューポート中央配置で描画する。**片側が `MAX_TEXTURE_SIZE` 非同期タイル準備待機中の間もこの結合配置矩形を維持したまま準備済み側スロットのみ先行描画** し（未準備側領域は黒待機）、準備完了後の再描画時に両スロットが座標ズレなく揃うようにする。
   - **片側のみ `status === "ready"`・相方が `error` または `null` 時**: `ready` 側スロットを自身の半画面領域（`left`: `[-1, 0]`、`right`: `[0, 1]`）に内接フィットし、背表紙 `x = 0` 境界へ寄せて描画する（失敗側半面には上位 UI のスロットエラーオーバーレイを表示可能にする）。
4. **戻り値契約と `renderFrame`**:
   - `renderSlots(slots: readonly RenderSlotFrame[]): readonly ViewportSlot[]` は、当該呼び出しで実際に WebGL2 描画を完了したスロット配列を返す（`MAX_TEXTURE_SIZE` 非同期準備待機中のスロットは完了通知まで含めない）。既存 `renderFrame(frame)` は `renderSlots` への単一 `"center"` 委譲ラッパーとして維持・提供する。

### 3.4 1 パス自炊画質補正シェーダー仕様（`ShaderCorrectionParams`）

1. **パラメータ許容範囲・初期値・正規化（`src/webgl/shaderParams.ts`）**:
   - `DEFAULT_SHADER_CORRECTION_PARAMS = { sharpness: 0, whitePoint: 1, blackPoint: 0, gamma: 1 }`
   - 各項目の許容範囲・刻み幅（`SHADER_PARAM_RANGES`）：
     - `sharpness`: `0.00 〜 1.00`（step `0.05`）
     - `whitePoint`: `0.80 〜 1.00`（step `0.01`）
     - `blackPoint`: `0.00 〜 0.25`（step `0.01`）
     - `gamma`: `0.60 〜 1.60`（step `0.05`）
   - `normalizeShaderCorrectionParams(raw: unknown)` はプレーンオブジェクト（`typeof raw === "object" && raw !== null && !Array.isArray(raw)`）上の自前プロパティ（`Object.prototype.hasOwnProperty.call`）のみを参照し、有限数値を許容範囲へクランプ・小数第2位丸め（`Math.round(clamped * 100) / 100`）して返す（欠落・不正値は項目単位で初期値へフォールバック）。
2. **フラグメントシェーダー演算式（`src/webgl/shaders.ts`）**:
   - `#version 300 es` / `precision highp float;` 上で、`u_texture` に加え `u_sharpness`, `u_whitePoint`, `u_blackPoint`, `u_gamma` の 4 つの `float` Uniform を受け取る（`initPipeline()` で全 Uniform ロケーションが非 `null` であることを検証し、欠落時は `WebGLInitError` を送出）。
   - **Step 1（画面空間偏微分 5タップ軽量アンシャープマスク）**:
     - `vec4 baseSample = texture(u_texture, v_texCoord);`
     - `vec2 derivStep = max(vec2(abs(dFdx(v_texCoord.x)), abs(dFdy(v_texCoord.y))), 1.0 / vec2(textureSize(u_texture, 0)));`
     - `u_sharpness > 0.0` の場合のみ上下左右 4 近傍 `(0, ±derivStep.y)`, `(±derivStep.x, 0)` をフェッチし、`rgb = clamp(rgb + u_sharpness * (4.0 * rgb - (n + s + w + e)), 0.0, 1.0)` を適用する（`u_sharpness <= 0.0` 時は追加フェッチ 0 回の高速パスとし、ハードウェア Mipmap トリリニア補間によるモアレ除去を維持したまま縮小・等倍の双方で輪郭を強調する）。
   - **Step 2（白黒レベル正規化）**:
     - `float levelRange = max(u_whitePoint - u_blackPoint, 0.0001);`
     - `rgb = clamp((rgb - vec3(u_blackPoint)) / levelRange, 0.0, 1.0);`（`whitePoint` 以上の黄ばみ紙面を `#FFFFFF` へ白飛ばしし、`blackPoint` 以下の裏写りを `#000000` へ引き締める）。
   - **Step 3（標準ガンマ補正）**:
     - `rgb = pow(rgb, vec3(1.0 / max(u_gamma, 0.0001)));`（`gamma > 1.0` で中間調を明るく、`gamma < 1.0` で薄墨文字を濃く補正する）。
3. **Uniform 更新と再描画境界**:
   - `WebGLRendererCore.setShaderParams(params)` は正規化後の値が変化したときのみ内部状態を更新して `true` を返し、`getShaderParams()` で現在の正規化済み値を返す。
   - `renderSlots` 実行時に `gl.uniform1f` で 4 つの Uniform を適用する。パラメータ変更時は `gl.texImage2D` 再アップロードや Worker デコードを一切伴わず、既存の GPU テクスチャに対する再描画のみで即時反映する。

### 3.5 `webglcontextlost` / `webglcontextrestored` 耐性

1. `<ReaderCanvas>` は `canvas` 要素で `webglcontextlost` リスナーを登録し、必ず **`event.preventDefault()`** を実行してコンテキスト復元を許可した上で、即座に **`renderer.notifyContextLost()`**（`contextGeneration` インクリメント・進行中非同期分割無効化・ロスト済み `textures`／`failedOversizedBitmaps` クリア）を呼び出してロスト〜リストア間の非同期完了レースを遮断し、`diagnosticLogger.warn("webgl2", ...)` へ記録する。この際、インスタンス上の `shaderParams` は破棄せず保持する。
2. `webglcontextrestored` 発火時、`WebGLRendererCore.reinitializeAfterContextLost()` を呼び出して `contextGeneration` を進め、シェーダープログラム・VAO/VBO・Uniform ロケーション・`MAX_TEXTURE_SIZE` を再構築した上で、**保持中の最新 `shaderParams` と `L1PageCache` に残存している `ImageBitmap` 群から現在スロットのテクスチャ・Mipmap・画質補正描画（必要時は `MAX_TEXTURE_SIZE` ガード含む）を自動再生成して再描画** する。
3. WebGL2 コンテキスト自体が取得不可、またはシェーダーのコンパイル/リンクに失敗した場合は、致命的エラーコールバック（`WEBGL_UNSUPPORTED` / `WEBGL_INIT_FAILED`）を発火する。

---

## 4. `<ReaderCanvas>` コンポーネント仕様

- **役割**: 純粋な WebGL2 描画ホスト（ページ送りビジネスロジックや HUD UI は持たない）。
- **主要 Props**:
  - `slots: readonly RenderSlotFrame[]`（現在表示対象のスロット＋フレーム配列）
  - `shaderParams?: ShaderCorrectionParams`（未指定時は `DEFAULT_SHADER_CORRECTION_PARAMS`）
  - `onRendererReady?: (handle: ReaderCanvasHandle | null) => void`
  - `onFatalError?: (code: WebGLFatalErrorCode, message: string) => void`
  - `getWebGL2Context?: (canvas: HTMLCanvasElement) => WebGL2RenderingContext | null`
- **`shaderParams` 常時状態同期および非同期分割準備時の自動再描画**:
  - マウント初期化時、および `shaderParams` Prop が変化した際は、**`isContextLostRef.current` が `true` の間であっても必ず `renderer.setShaderParams(shaderParams)` による内部状態同期と `data-shader-params` 属性反映を実行** し、`!isContextLostRef.current` のときに `applySlots` で WebGL 再描画する（これによりコンテキストロスト中のデフォルト設定読込完了やスライダー変更も `webglcontextrestored` 復帰描画へ確実に反映される）。
  - `WebGLRendererCore` の `onAsyncTextureReady` を受け取り、`!isContextLostRef.current` のときに最新の `slotsRef.current` を再適用して決定論的 DOM 属性を更新する。
- **決定論的テスト用 DOM 属性**:
  - `data-testid="reader-canvas"`
  - `data-webgl-status`: `"initializing" | "ready" | "context-lost" | "error"`
  - `data-shader-params`: 正規化後の補正値を小数第2位カンマ区切りで表す文字列（`${sharpness.toFixed(2)},${whitePoint.toFixed(2)},${blackPoint.toFixed(2)},${gamma.toFixed(2)}`、初期値 `"0.00,1.00,0.00,1.00"`）
  - `data-rendered-page`: 描画完了済み全スロットに含まれるページの **昇順最小 0 始まり `pageIndex`**（例: `rtl` 見開き `"left:2,right:1"` では `"1"`、単ページ `"center:0"` では `"0"`、未描画時は `""`）
  - `data-rendered-pages`: 描画完了済み全スロットの 0 始まり `pageIndex` を昇順カンマ区切り（例: `"1,2"`、未描画時は `""`）
  - `data-rendered-slots`: 描画完了済みスロット配列順の `position:pageIndex` カンマ区切り（例: `"left:2,right:1"` / `"center:0"`、未描画時は `""`）
  - `data-rendered-epoch`: 描画したスロット群の最大 `requestEpoch`（未描画時は `""`）
- **テスト分離**: `<ReaderCanvas>` の単体テストおよび上位 `<ReaderPage>` の単体テストでは、モック `WebGL2RenderingContext` または子コンポーネントスパイにより Headless JSDOM 環境でも 100% 検証可能とする。

---

## 5. 受け入れ条件（`AC-GL-xx`）

|   AC ID    | 受け入れ条件                                                                                                                                                                                                    |
| :--------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-GL-01` | `L1PageCache` は最大 5 ページを保持し、上限超過退避・古い `requestEpoch` 拒否・`clear()` 時に必ず `bitmap.close()` とテクスチャ破棄を実行する。                                                                 |
| `AC-GL-02` | `WebGLRendererCore` は純黒（`#000000`）背景で、画像アスペクト比を維持した中央内接フィット単ページ描画を行う。                                                                                                   |
| `AC-GL-03` | テクスチャ生成直後に `gl.generateMipmap(gl.TEXTURE_2D)` と `gl.LINEAR_MIPMAP_LINEAR` が必ず設定される。                                                                                                         |
| `AC-GL-04` | `ResizeObserver` と `devicePixelRatio`（`MAX_VIEWPORT_DIMS` クランプ付き）の変化に追従してバッファサイズと描画が更新される。                                                                                    |
| `AC-GL-05` | `webglcontextlost` で `preventDefault()` が呼ばれ、`webglcontextrestored` で保持中の `ImageBitmap` と `shaderParams` から自動再描画復帰する。                                                                   |
| `AC-GL-06` | `src/webgl/` 配下の全モジュールおよび Story/UT が C0/C1/Functions/Lines 100% カバレッジを達成する。                                                                                                             |
| `AC-GL-07` | `MAX_TEXTURE_SIZE` を超える画像入力時、`diagnosticLogger.warn("webgl2", ...)` を記録し、タイル分割（最大 16 枚）または上限内安全リサイズで黒画面化せず描画し、生成した一時 `ImageBitmap` を即 `close()` する。  |
| `AC-GL-08` | 2 スロット見開き時は背表紙密着の高さ揃え結合フィットで左右同時描画し、片側欠損/エラー時は有効側スロットを半面背表紙寄りで描画する。                                                                             |
| `AC-GL-09` | フラグメントシェーダー 1 パス内で `sharpness`（画面微分 5タップ USM）・`whitePoint`・`blackPoint`・`gamma`（`pow(rgb, 1.0 / gamma)`）Uniform 補正がテクスチャ再転送なしに即時反映され、ピクセル描画へ作用する。 |
