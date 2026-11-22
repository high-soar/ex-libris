---
type: spec-delta
title: "Issue #22 差分仕様: 自炊補正シェーダー・シークバー・readingProgress 自動レジューム"
description: "生WebGL2 1パス画質補正シェーダー（画面微分5タップUSM＋白黒レベル＋標準ガンマ）と調整ボトムシート（優先度2戻る制御・syncMetaデフォルト保存）、rtl/ltr連動シークバー、およびDexie readingProgress自動レジューム・SCR-01ローカル閲覧履歴を定義する差分仕様"
status: "Review (#22)"
updated: "2026-11-22"
issue: "#22"
tags:
  [
    delta,
    v0.1,
    webgl2,
    shader,
    seekbar,
    reading-progress,
    resume,
    back-button,
    bookshelf,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/webgl2-renderer.md
  - docs/specs/features/reader.md
  - docs/specs/features/bookshelf.md
  - docs/guidelines/workflow.md
  - docs/guidelines/testing.md
  - docs/quality/bug-and-handover-log.md
related_tests:
  - scripts/generate-manual-test-archives.test.ts
  - src/App.test.tsx
  - src/app/ServiceProvider.test.tsx
  - src/app/serviceContext.test.ts
  - src/storage/db.test.ts
  - src/storage/repositories/readingProgressRepository.test.ts
  - src/storage/repositories/readerSettingsRepository.test.ts
  - src/webgl/shaderParams.test.ts
  - src/webgl/shaders.test.ts
  - src/webgl/WebGLRendererCore.test.ts
  - src/webgl/ReaderCanvas.test.tsx
  - src/features/reader/ReaderHudOverlay.test.tsx
  - src/features/reader/ReaderPage.test.tsx
  - src/features/bookshelf/BookshelfPage.test.tsx
  - test/vrt/vrt.spec.ts
  - test/it/smoke.spec.ts
  - test/it/local-reader.spec.ts
---

# Issue #22 差分仕様: 自炊補正シェーダー・シークバー・`readingProgress` 自動レジューム

## 1. 背景・目的（Why）

- 自炊マンガスキャン画像特有の紙面の黄ばみ・裏写り・薄墨文字・縮小表示時のペン線の眠さを GPU 上でゼロ負荷補正する **生 WebGL2 1パスフラグメントシェーダー（シャープネス＋白黒レベル＋ガンマ補正）** およびクイック画質補正ボトムシートを実装する。
- 長編合本 ZIP/CBZ でも右開き（`rtl`）・左開き（`ltr`）の視覚順に一致した直感操作で目的ページへ即座に移動できる **基本シークバー** を `SCR-03` 下部 HUD に統合する。
- Dexie.js の **`readingProgress` 永続化・自動レジューム**（`local:${rawFileName}:${fileSize}` キー、将来の `vol:${volumeId}` 共用）と `SCR-01` の **「最近のローカル閲覧履歴」** を実装し、`Milestone v0.1`（完成版コアリーダーエンジン）の全 5 Issue を完結させる。

### 1.1 Step 1 合意事項（`/grill-me` 確定内容：Q1〜Q6）

1. **生 WebGL2 1パス画質補正シェーダーの演算式とガンマ方向（Q1）**:
   - `u_sharpness <= 0.0` 時は 1 回のみ `texture(u_texture, v_texCoord)` をフェッチする高速パスとする。
   - `u_sharpness > 0.0` 時は、GLSL ES 3.00 の画面空間偏微分 `abs(dFdx(v_texCoord.x))` / `abs(dFdy(v_texCoord.y))`（下限フロア `1.0 / vec2(textureSize(u_texture, 0))`）をサンプリング半径とする **5タップ軽量アンシャープマスク（USM）** を適用する。これによりハードウェア Mipmap（`gl.LINEAR_MIPMAP_LINEAR`）によるスクリーントーンのモアレ除去を一切損なわず、縮小表示・等倍表示・`MAX_TEXTURE_SIZE` タイル分割境界（`CLAMP_TO_EDGE`）のすべてで描線と文字輪郭を強調する。
   - 同一パス内で続けて **白黒レベル補正** `clamp((rgb - vec3(u_blackPoint)) / max(u_whitePoint - u_blackPoint, 0.0001), 0.0, 1.0)`、および **標準ガンマ補正** `pow(rgb, vec3(1.0 / max(u_gamma, 0.0001)))`（`gamma > 1.0` で中間調を明るく、`gamma < 1.0` で薄墨文字を濃く引き締める）を適用する。
2. **画質補正ボトムシートの保存・リセット・優先度2戻る制御（Q2）**:
   - `SCR-03` 上部 HUD の「画質補正」ボタン押下で HUD を閉じてクイック画質補正ボトムシート（`ReaderShaderSheet`）を開き、紙面の視認性を妨げない非着色バックドロップ上でリアルタイムに WebGL2 Uniform を再描画する。
   - スライダー変更は現在開いているセッションへ即時反映し、**「リセット」** は現在セッションの補正値を初期ニュートラル値（`sharpness: 0.00, whitePoint: 1.00, blackPoint: 0.00, gamma: 1.00`）へ戻す。**「デフォルト保存」** を押した時のみ Dexie `syncMeta['defaultReaderSettingsJson']` へ画質補正値を永続化し、次回以降のリーダー起動時に初期適用する。
   - ボトムシート表示中（`activeFatalError === null && isShaderSheetOpen`）は、Android ハードウェア戻るボタン（`AppBridge` `backButton`）、キーボード `Escape` キー、およびシート外バックドロップタップのすべてで `TR-08`（リーダー終了）を発火せずボトムシートのみを閉じ、フルスクリーン閲覧状態へ戻る（[screen-transitions.md §4](../screen-transitions.md#4-android-ハードウェア戻るボタンback-button優先制御契約) 優先度 2。致命的エラー発生時は `isShaderSheetOpen = false` へ自動リセットして `TR-08` を阻害しない）。
3. **基本シークバーの通信発火タイミングと見開き着地仕様（Q3）**:
   - 将来の Google Drive HTTP Range レート制限（`NFR-04`）および大容量合本でのデコード負荷保護のため、**シークバードラッグ中はターゲットページ番号（`N / Total`）のプレビュー表示のみを更新し、Worker RPC / I/O は発火しない**。
   - ドラッグ中に指が要素外へ外れて離された場合も取りこぼさないよう、`window` の `pointerup`（確定）および `pointercancel`（キャンセル）を含むポインター確定時、ならびに非ドラッグのキーボードスライダー操作時に 1 回だけ `requestEpoch` を進めて古い I/O を中断し、Fast-Path 描画を実行する（`pointercancel`・HUD 閉鎖・アンマウント時はジャンプせずプレビューを解除する）。
   - 見開き表示（`effectiveSpreadMode === "spread"`）でのシーク確定時は `spreadHistory` をクリアし、`spreadPageOffset` は維持したまま **指定された `targetIndex` を基準アンカー（`currentPageIndex = targetIndex`）として直接着地** し、指定ページが必ず画面内のスロットに含まれることを保証する。
4. **`readingProgress` の読了判定と再オープン時のレジューム挙動（Q4）**:
   - 保存時の確定表示最大ページ `confirmedMaxDisplayedPageIndex >= totalPages - 1`（単ページの最終頁、および両ページの非横長寸法 `width <= height` が `knownDimensions` で確定した最終 2 ページ見開き。寸法未確定時は `currentPageIndex` 単独基準）を **`readStatus = "completed"`**、それより手前のページを **`readStatus = "reading"`** として保存する。
   - 同一ローカルアーカイブを再オープン（`TR-02a`）した際は、`readStatus` が `"reading"` か `"completed"` かを問わず **常に保存済みの `currentPageIndex`（`[0, pageCount - 1]` クランプ付き）と `spreadPageOffset`（1 ページ本 `pageCount <= 1` 時は `0` へ正規化）を忠実に復元** してレジュームする（先頭から読み直す場合はシークバーを使用する）。
5. **`SCR-01`「最近のローカル閲覧履歴」の UI 構成と操作（Q5）**:
   - `readingProgress` 内の `local:*` レコードが **1 件以上存在する時のみ**、`SCR-01` メインカードの下に最新 **10 件**（`lastReadAt` 降順、同値時は `targetKey` 昇順）を表示する（0 件時はセクション自体を非表示とし初期ホームの簡潔さを保つ）。
   - 各履歴行にはファイル名・フォーマット済みサイズ・ステータスバッジ（`読書中` / `読了`）・ページ進捗（`N / Total ページ` ＋ 進捗バー）を表示し、行クリックでファイル選択ピッカーを開いて再選択レジュームを案内するほか、**行単位の個別削除ボタン** と **「履歴をクリア」（`local:*` 一括消去）ボタン** を備える。
6. **Android 実機検証（`HO-08`）と検証用サンプルアーカイブ（Q6）**:
   - [workflow.md §2.2](../../guidelines/workflow.md#22-android-実機検証の実施判断基準と試験項目表フォーマット) の **区分 A（完了ゲート: `親 Issue #22 完了前`）** とし、`HO-08` を登録する。
   - 黄ばみ紙面・裏写り・薄墨文字・細線エッジ・20ページシーク＆見開き確認用の軽量検証アーカイブ `test/fixtures/manual/ho08-shader-seek-test.cbz` を決定論的生成スクリプトへ追加し、Step 4 実機検証時に `app-debug.apk` と併せて Google Drive へ配置する。

### 1.2 対象外スコープ

- 作品ごとの個別シェーダープリセット保存・サムネイルプレビュー付き高速シークバー・Undo Jump・オートクロップ・ピンチ拡大・音量キーめくり（→ `v0.4`）
- Google Drive 連携・`series` / `volumes` 仮想本棚同期（→ `v0.2`）

---

## 2. 変更対象の App 全体正本一覧

|   種別   | 正本ファイル                                                     | 変更概要                                                                                                                                                                              |
| :------: | :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **更新** | [requirements.md](../requirements.md)                            | 機能カタログのシャープネス補正表記を確定仕様（画面微分 5タップ USM ＋ 白黒レベル・ガンマ補正シェーダー）へ同期更新                                                                    |
| **更新** | [architecture.md](../architecture.md)                            | Layer 3 Repository 構成（FIFO 直列化含む）、`src/webgl/shaderParams.ts` 分離契約、1パス画面微分5タップUSM＋レベル＋ガンマ仕様を反映                                                   |
| **更新** | [db-schema.md](../db-schema.md)                                  | `syncMeta['defaultReaderSettingsJson']` 破損検証契約、`readingProgress` の FIFO 直列化・厳格レコード検証・`local:*` 最大100件 LRU（`vol:*` 非退避）・寸法確定 `readStatus` を明記     |
| **更新** | [webgl2-renderer.md](../engine/webgl2-renderer.md)               | `shaderParams.ts` 分離、`shaders.ts` 1パス補正 GLSL 数式、`WebGLRendererCore` 4 Uniform 管理、`ReaderCanvas` コンテキストロスト中を含む状態常時同期＆`data-shader-params`・`AC-GL-09` |
| **更新** | [reader.md](../features/reader.md)                               | `ReaderShaderSheet`・優先度2戻る制御（致命的エラー時解除）、`window` 解放対応シークバー、寸法確定ベース `readStatus`・1頁本ずらし正規化、`AC-RD-13`〜`15` 追加                        |
| **更新** | [bookshelf.md](../features/bookshelf.md)                         | `architecture.md` 双方向参照追加、`SCR-01` `RecentLocalHistorySection`（最新10件表示・0件時非表示・再選択ピッカー起動・個別削除・一括クリア）および `AC-BS-06` を追加                 |
| **更新** | [screen-transitions.md](../screen-transitions.md)                | `SCR-01` / `SCR-03`・`TR-02a` / `TR-08` 進捗フラッシュ契約、優先度2戻る制御（`backButton` / `Escape` / バックドロップ）、および `SCN-01` / `SCN-02` トレーサビリティ対応表を更新      |
| **更新** | [bug-and-handover-log.md](../../quality/bug-and-handover-log.md) | 区分 A 実機検証申し送り事項 **`HO-08`**（完了ゲート: `親 Issue #22 完了前`）および PR #57 Round 1 指摘是正記録（`No. 32`〜`36`）を登録                                                |

---

## 3. 追加・変更する仕様の差分サマリー

### 3.1 生 WebGL2 1パス画質補正シェーダー ＆ パラメータ正規化（`src/webgl/types.ts`, `src/webgl/shaderParams.ts`, `src/webgl/shaders.ts`, `src/webgl/WebGLRendererCore.ts`, `src/webgl/ReaderCanvas.tsx`）

1. **純粋型定義と実行時純関数の分離（`src/webgl/types.ts`, `src/webgl/shaderParams.ts`）**:
   - `vite.config.ts` のカバレッジ計測除外（`src/**/types.ts`）へ実行時コードを含めない規律を厳守するため、`src/webgl/types.ts` には純粋な `ShaderCorrectionParams` インターフェース定義のみを追加し、以下の実行時定数・純関数はすべて **`src/webgl/shaderParams.ts`**（＋ 1対1 単体テスト `src/webgl/shaderParams.test.ts`）へ実装する：
     - `DEFAULT_SHADER_CORRECTION_PARAMS`: `{ sharpness: 0, whitePoint: 1, blackPoint: 0, gamma: 1 }`
     - `SHADER_PARAM_RANGES`:
       - `sharpness`: `{ min: 0.0, max: 1.0, step: 0.05 }`
       - `whitePoint`: `{ min: 0.80, max: 1.00, step: 0.01 }`
       - `blackPoint`: `{ min: 0.00, max: 0.25, step: 0.01 }`
       - `gamma`: `{ min: 0.60, max: 1.60, step: 0.05 }`
     - `normalizeShaderCorrectionParams(raw: unknown): ShaderCorrectionParams`:
       - 非プレーンオブジェクト（`typeof raw !== "object" || raw === null || Array.isArray(raw)`）入力時は `DEFAULT_SHADER_CORRECTION_PARAMS` を返す。
       - プロトタイプ汚染を防ぐため `Object.prototype.hasOwnProperty.call` で自身のプロパティのみを参照し、有限数値は `[min, max]` へクランプの上 `Math.round(clamped * 100) / 100`（小数第2位丸め）を適用し、欠落・非有限フィールドは個別に初期値へフォールバックする（クランプ後は常に `whitePoint - blackPoint >= 0.55` が保証される）。
     - `isDefaultShaderParams(params: ShaderCorrectionParams): boolean` および `formatShaderParamsAttribute(params: ShaderCorrectionParams): string`（`"0.00,1.00,0.00,1.00"` 形式）を提供する。
2. **フラグメントシェーダー 1パス演算（`src/webgl/shaders.ts`）**:
   - 追加 Uniform: `uniform float u_sharpness;`, `uniform float u_whitePoint;`, `uniform float u_blackPoint;`, `uniform float u_gamma;`
   - GLSL ES 3.00 処理順:
     1. 中心サンプル `vec4 baseSample = texture(u_texture, v_texCoord);` と画面空間偏微分ステップ `vec2 derivStep = max(vec2(abs(dFdx(v_texCoord.x)), abs(dFdy(v_texCoord.y))), 1.0 / vec2(textureSize(u_texture, 0)));` を算出する。
     2. `if (u_sharpness > 0.0)` の場合のみ上下左右 4 近傍 `(0, ±derivStep.y)`, `(±derivStep.x, 0)` をサンプリングし、`rgb = clamp(rgb + u_sharpness * (4.0 * rgb - (n + s + w + e)), 0.0, 1.0);` を適用する（`u_sharpness <= 0.0` 時は追加テクスチャフェッチ 0 回）。
     3. 白黒レベル正規化: `float levelRange = max(u_whitePoint - u_blackPoint, 0.0001); rgb = clamp((rgb - vec3(u_blackPoint)) / levelRange, 0.0, 1.0);`
     4. 標準ガンマ補正: `rgb = pow(rgb, vec3(1.0 / max(u_gamma, 0.0001)));`
     5. `outColor = vec4(rgb, baseSample.a);`
3. **`WebGLRendererCore` / `<ReaderCanvas>` 統合**:
   - `WebGLRendererCore`:
     - `initPipeline()` で `u_sharpness`, `u_whitePoint`, `u_blackPoint`, `u_gamma` の Uniform ロケーションを取得・検証する（いずれかが `null` なら `WebGLInitError`）。
     - `setShaderParams(params: ShaderCorrectionParams): boolean`（正規化後の値が変化した場合のみ内部状態を更新して `true` を返す）および `getShaderParams(): ShaderCorrectionParams` を公開し、`renderSlots` 実行時に 4 つの `gl.uniform1f` をバインドする。
     - `notifyContextLost()` / `reinitializeAfterContextLost()` を跨いでもインスタンス上の `shaderParams` を保持し、コンテキスト復帰後の再描画へそのまま適用する。
   - `<ReaderCanvas>`:
     - `shaderParams?: ShaderCorrectionParams` Prop を受け取り、マウント初期化時および Prop 更新時は **`isContextLostRef.current === true` の間であっても必ず `renderer.setShaderParams(shaderParams)` による内部状態同期と `<canvas data-shader-params="...">` 属性更新を実行** し、`!isContextLostRef.current` のときにテクスチャ再アップロードや Worker 通信なしで `applySlots` 再描画を実行する。

### 3.2 Storage Repositories ＆ DI 配線（`src/storage/repositories/`, `src/app/`）

1. **`ReadingProgressRepository`（`src/storage/repositories/readingProgressRepository.ts`）**:
   - 定数: `LOCAL_READING_PROGRESS_MAX_ENTRIES = 100`、`RECENT_LOCAL_HISTORY_DEFAULT_LIMIT = 10`
   - **操作の FIFO 直列化**: `TR-08` 離脱時の fire-and-forget `put(...)` と直後の `BookshelfPage` マウント時 `listRecentLocal(10)`（`popstate` 同一コミット遷移を含む）や再オープン時 `get()`、および連続 `put()` が競合しないよう、内部 Promise キューで全メソッド（`put` / `delete` / `clearLocal` / `get` / `listRecentLocal`）を FIFO 直列化する。
   - `parseLocalProgressTargetKey(targetKey: string)`: `"local:"` 接頭辞を検証し、ファイル名中に `:` が含まれる場合も安全に分離できるよう末尾の `lastIndexOf(":")` で `rawFileName`（非空文字列）と `fileSize`（`/^\d+$/` かつ 0 以上の `Number.isSafeInteger`）を抽出する（不一致時は `null`）。
   - **厳格なレコード検証と自動修復**: `totalPageCount`（`>= 1` の `Number.isSafeInteger`）、`currentPageIndex`（`0 <= idx < totalPageCount` の `Number.isSafeInteger`）、`lastReadAt` / `updatedAt`（`Number.isFinite`）、`readStatus`（`'unread' | 'reading' | 'completed'`）、`spreadPageOffset`（`0 | 1`）、および `local:*`（`parseLocalProgressTargetKey !== null && volumeId === null`）／`vol:${id}`（`id.length > 0 && volumeId === id`）を検証する。`get(targetKey)` で不整合レコード検出時は当該レコードを即時削除して `null` を返す。
   - `put(input)`: `rw` トランザクション内で `lastReadAt = now()`, `updatedAt = now()` を付与して保存する。`targetKey.startsWith("local:")` の場合のみ `where("targetKey").startsWith("local:")` 件数を確認し、`maxLocalEntries`（100 件）超過分を `lastReadAt` 昇順（同値時は `targetKey` 昇順）で削除する（**`vol:*` レコードは一切カウント・退避しない**）。
   - `listRecentLocal(limit = 10)`: `where("targetKey").startsWith("local:")` から有効なレコードのみを抽出し、`lastReadAt` 降順（同値時は `targetKey` 昇順の決定論的タイブレーク）で最大 `limit` 件（`limit <= 0` 時は `[]`）の `LocalReadingHistoryItem[]` を返す。
   - `delete(targetKey)`（個別削除）および `clearLocal()`（`where("targetKey").startsWith("local:").delete()` による `local:*` のみの一括削除）を提供する。
2. **`ReaderSettingsRepository`（`src/storage/repositories/readerSettingsRepository.ts`）**:
   - 定数: `DEFAULT_READER_SETTINGS_META_KEY = "defaultReaderSettingsJson"`
   - `getShaderDefaults()`: `syncMeta.get("defaultReaderSettingsJson")` を読み取る。未保存時は `DEFAULT_SHADER_CORRECTION_PARAMS` を返す。JSON パース失敗、ルート値が非プレーンオブジェクト（`null`・プリミティブ・配列）、または自前の `shader` プロパティ（`Object.prototype.hasOwnProperty.call` 判定）が存在するのに非プレーンオブジェクト（`null`・プリミティブ・配列）である場合は、破損レコードとして `syncMeta` から削除した上で `DEFAULT_SHADER_CORRECTION_PARAMS` を返す。有効なプレーンオブジェクト時は自前の `shader` プロパティ（存在しなければルート自身）を `normalizeShaderCorrectionParams` で正規化して返す。
   - `saveShaderDefaults(params)`: 正規化後の `params` を `JSON.stringify({ version: 1, shader: normalized })` として `syncMeta.put` し、正規化後の `ShaderCorrectionParams` を返す。
3. **`ServiceContext` / `ServiceProvider` 拡張（`src/app/serviceContext.ts`, `src/app/ServiceProvider.tsx`）**:
   - `ServiceContextValue` および `ServiceProviderProps` に `readingProgressRepo: ReadingProgressRepository` と `readerSettingsRepo: ReaderSettingsRepository` を追加し、未指定時は `db` を用いた Dexie 実装インスタンスをシングルトン供給する。

### 3.3 `SCR-03` シークバー・画質補正シート・優先度2戻る制御・自動レジューム（`ReaderHudOverlay.tsx`, `ReaderShaderSheet.tsx`, `ReaderPage.tsx`）

1. **`ReaderHudOverlay` の拡張**:
   - **上部バー（`reader-hud-top`）**: 右端に **「画質補正」ボタン**（`data-testid="reader-shader-button"`, `data-shader-modified={String(!isDefaultShaderParams)}`）を追加する（補正適用中はインディゴ強調スタイル）。
   - **下部バー（`reader-hud-bottom`）3段構成**:
     1. **シークバー行（`data-testid="reader-hud-seek-row"`）**:
        - `<input type="range" data-testid="reader-seekbar" />` を配置し、`min={0}`, `max={Math.max(0, totalPages - 1)}`, `step={1}`, `dir={readingDirection === "rtl" ? "rtl" : "ltr"}`, `data-reading-direction={readingDirection}`, `disabled={totalPages <= 1}` とする。
        - ポインタードラッグ開始（`onPointerDown`）中は `onChange` でローカルプレビュー状態（`seekPreviewIndex`）のみを更新し、`reader-page-indicator` に 1 始まり `${seekPreviewIndex + 1} / ${totalPages}`（および `data-seek-preview="true"`）をリアルタイム表示する（この間 `onCommitSeek` は呼ばない）。
        - ドラッグ中に指が `<input>` 上下矩形外へ外れて離された場合も確実に取りこぼさないよう、ドラッグ開始中は要素イベントに加えて **`window` の `pointerup`（確定）および `pointercancel`（解除）** でも完結させる。確定時に最新 `seekPreviewIndex` が `currentPageIndex` と異なる場合のみ `onCommitSeek(targetIndex)` を 1 回発火してプレビュー状態を解除し、`pointercancel`・ドラッグ中の `isOpen === false` 遷移・アンマウント時は `onCommitSeek` を呼ばずプレビューのみ解除する。ポインタードラッグを伴わない `onChange`（キーボード `ArrowLeft` / `ArrowRight` 操作等）では即座に `onCommitSeek(targetIndex)` を発火する。
     2. **ページナビゲーション行（`reader-hud-nav-row`）**: 既存の次へ・ページインジケータ（シークプレビュー連動）・前へを維持する。
     3. **表示・綴じ方向コントロール行（`reader-hud-controls-row`）**: 既存の表示モード循環・1ページずらし・右/左開き切替を維持する。
2. **`ReaderShaderSheet` の新設（`src/features/reader/ReaderShaderSheet.tsx`）**:
   - 上部 HUD の「画質補正」押下時に `isHudOpen = false`, `isShaderSheetOpen = true` として開き、`activeFatalError === null && isShaderSheetOpen` のときのみ紙面の色味を変えない透明クリックキャッチバックドロップ（`data-testid="reader-shader-backdrop"`）と下部シート本体（`data-testid="reader-shader-sheet"`, `role="dialog"`, `aria-modal="true"`, `aria-label="画質補正"`, セーフエリア下パディング付き）を表示する（全ポインター／クリックイベントは `stopPropagation` し下層タップゾーンへ伝播させない）。
   - 4 本のスライダー（すべて数値昇順の `dir="ltr"`: `shader-sharpness-slider`, `shader-white-point-slider`, `shader-black-point-slider`, `shader-gamma-slider`）＋ 現在値表示、「リセット」（`shader-reset-button`）、「デフォルト保存」（`shader-save-default-button`）＋ 保存状態メッセージ（`shader-save-status`）、「閉じる」（`shader-sheet-close-button`）を備える。
3. **優先度 2 戻る制御・致命的エラー時解除・キーボード競合防止（`ReaderPage.tsx`）**:
   - アーカイブエラーまたは WebGL 致命的エラー発生時（`reportArchiveError` / `handleWebGLFatalError`）は `isHudOpen = false`, `isShaderSheetOpen = false` へリセットする。
   - `onRegisterExit` へ登録する戻るハンドラ（Android ハードウェア `backButton` 用）および `Escape` キー処理は、`activeFatalError === null && isShaderSheetOpen` の間は **`isShaderSheetOpen = false` のみを実行して `SCR-03` に留まり（優先度 2）**、閉じた状態（または致命的エラー表示中）に押された時は `TR-08`（`handleClose`：優先度 3）を実行する（上部 HUD の「戻る」ボタンおよびエラー画面の「ホームへ戻る」は直接 `handleClose` を呼ぶ）。
   - `window` `keydown` リスナーでは、`event.target instanceof HTMLInputElement` のとき（シークバーや画質スライダーへのフォーカス中）および `isShaderSheetOpen === true` のときは `ArrowLeft` / `ArrowRight` によるページめくりを発火せず、スライダー自身のネイティブキー操作とモーダル分離を保護する。
4. **`readingProgress` 自動レジューム＆永続化ライフサイクル（`ReaderPage.tsx`）**:
   - アーカイブオープン時（`initialSnapshot === undefined` 時）：
     - オープン試行開始時に `currentPageIndex = 0`, `spreadPageOffset = 0`, `totalPages = 0` へ初期化する。
     - `readerSettingsRepo.getShaderDefaults()` を非同期取得し、取得完了前にユーザーが手動でスライダーを変更していなければ `shaderParams` へ反映する（失敗時は警告ログ記録の上で初期値を維持）。
     - `readingProgressRepo.get(source.progressTargetKey)` を安全に取得し（失敗時は警告ログ記録の上で `null` フォールバック）、`openArchive` 成功後に保存レコードがあれば `spreadPageOffset = result.pageCount > 1 ? saved.spreadPageOffset : 0`（1 ページ本では `0` へ正規化）および `currentPageIndex = Math.min(result.pageCount - 1, Math.max(0, saved.currentPageIndex))` を初期状態として `loadPageWindow` を開始する（`readStatus` が `"completed"` の場合も保存ページからそのままレジュームする）。
   - 進捗保存トリガー（`persistCurrentProgress`）：
     - `initialSnapshot === undefined && session !== null && !isOpening && totalPages > 0 && archiveError === null && webglFatalError === null` の条件下で、見開き第 2 スロット（`N + 1`）は `N` と `N + 1` の双方が `knownDimensions` 上で非横長（`width <= height`）と確定している場合のみ表示済みに含め（寸法未確定時は `currentPageIndex` 単独基準）、`confirmedMaxDisplayedPageIndex >= totalPages - 1` なら `"completed"`、それ以外は `"reading"` として `readingProgressRepo.put(...)` を実行する（保存失敗時は警告ログのみ記録し閲覧・終了を阻害しない）。
     - ①`loadPageWindow` 確定時（初回オープン・めくり・シーク・見開き/向き変化後の寸法確定時）、②`moveToPage`（前後めくり・シーク確定時）および `handleToggleSpreadPageOffset` 直後、③`TR-08`（`handleClose`）・`popstate` 離脱・`window` `"pagehide"`・`document` `"visibilitychange"`（`visibilityState === "hidden"`）時に保存を実行する。

### 3.4 `SCR-01`「最近のローカル閲覧履歴」（`RecentLocalHistorySection.tsx`, `BookshelfPage.tsx`）

1. **`RecentLocalHistorySection` の新設（`src/features/bookshelf/RecentLocalHistorySection.tsx`）**:
   - `items.length === 0` のときは `null` を返す（0 件時は非表示）。
   - `items.length > 0` のときはセクション（`data-testid="recent-local-history-section"`）を描画し、見出し「最近のローカル閲覧履歴」、案内文「同じ `.zip` / `.cbz` ファイルを再選択すると、前回のページから自動レジュームします」、一括消去ボタン（`data-testid="clear-local-history-button"`）、および最大 10 件の履歴リスト（`data-testid="recent-local-history-list"`）を表示する。
   - 各履歴アイテム（`data-testid="recent-local-history-item"`）には、再選択ピッカーを開く主ボタン（`data-testid="reopen-local-history-button"`: ファイル名・人間可読ファイルサイズ・`読書中`/`読了` バッジ・`${currentPageIndex + 1} / ${totalPageCount} ページ`・進捗バー）と、個別削除ボタン（`data-testid="delete-local-history-button"`）を分離配置する。
2. **`BookshelfPage` 統合**:
   - `BookshelfPageProps` にテスト・Storybook 用の `initialRecentHistory?: readonly LocalReadingHistoryItem[]` を追加し、未指定時はマウント時に `readingProgressRepo.listRecentLocal(10)` を読み込む（取得・削除・クリア失敗時は `diagnosticLogger.warn("bookshelf", ...)` を記録し UI クラッシュを防ぐ）。

---

## 4. テスト計画（UT / VRT / IT）

| 層                                                        | テスト手法・対象                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 合格基準                                                           |
| :-------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------- |
| **MK-1: Storage Repositories ＆ WebGL2 シェーダーコア**   | `shaderParams.test.ts`（`normalizeShaderCorrectionParams` 境界・配列/非オブジェクト・プロトタイプ汚染防御・属性文字列化）、`shaders.test.ts`（1パスUSM・レベル・ガンマ GLSL 構造検証）、`WebGLRendererCore.test.ts`（4 Uniform 反映・`contextlost`/`restored` 保持・ロケーション欠落エラー）、`readingProgressRepository.test.ts`（FIFO 直列化・`local:*` コロン含み解析・100件 LRU・`vol:*` 非退避・破損レコード自動削除・`listRecentLocal` タイブレーク・`clearLocal`）、`readerSettingsRepository.test.ts`（破損削除） | C0 / C1 / Functions / Lines **100%** PASS                          |
| **MK-2: 画質補正シート・シークバーHUD・履歴セクションUI** | `ReaderShaderSheet.stories.tsx` / `.test.tsx`（4スライダー・リセット・デフォルト保存ステータス・バックドロップ/閉じる・イベント遮断）、`ReaderHudOverlay.stories.tsx` / `.test.tsx`（画質補正ボタン・`rtl`/`ltr` シークバードラッグプレビュー＆`window` `pointerup` 要素外リリース確定・`pointercancel`／HUD閉鎖解除・キーボード確定・1頁本 `disabled`）、`RecentLocalHistorySection.stories.tsx` / `.test.tsx`（0件非表示・読書中/読了バッジ・進捗バー・再選択・個別削除・一括クリア）、VRT 更新                         | C0 / C1 / Functions / Lines **100%** PASS ＆ VRT 1280px/375px PASS |
| **MK-3: `ReaderCanvas`・`ReaderPage`・`BookshelfPage`**   | `ReaderCanvas.stories.tsx` / `.test.tsx`（`shaderParams` 即時再描画・ロスト中内部状態同期＆`contextrestored` 復元・`data-shader-params`）、`ReaderPage.stories.tsx` / `.test.tsx`（親子分離下でのデフォルト読込/保存、優先度2戻る制御＆致命的エラー時解除、`<input>` フォーカス時キー保護、シーク確定 Epoch 更新、寸法確定ベース `readStatus`・1頁本ずらし正規化・`TR-08`/`popstate`/`pagehide`/`visibilitychange` 保存）、`BookshelfPage` 履歴統合、VRT 更新                                                             | C0 / C1 / Functions / Lines **100%** PASS ＆ VRT 1280px/375px PASS |
| **Step 4: Playwright IT (`SCN-01`, `SCN-02`) ＆ 手動CBZ** | `test/it/smoke.spec.ts` / `test/it/local-reader.spec.ts`：実 SwiftShader WebGL2 での黄ばみ/薄墨/エッジ合成 PNG ピクセル RGB 変化検証（`whitePoint` 白飛ばし・`blackPoint` 引き締め・`gamma` 濃淡・`sharpness` エッジ強調・リセット・デフォルト保存永続化）、優先度2戻る制御（`MockAppBridge`＆`Escape`）、`rtl`/`ltr` シークバープレビュー＆確定ジャンプ、`readingProgress` 自動レジューム（`spreadPageOffset`・読了再オープン含む）＆`SCR-01` 履歴表示/削除                                                              | 全 `SCN-01` / `SCN-02` **100% PASS** ＆ 手動フィクスチャ単体検証   |

---

## 5. 実装 Sub-issue 分割計画・申し送り事項・Android 実機検証計画

### 5.1 Sub-issue 分割計画（設計 PR マージ後に起票）

1. **MK-1: Storage Repositories（`readingProgress` / `defaultReaderSettings`）＆ 生 WebGL2 1パス補正シェーダーコア実装**
   - 対象: `src/webgl/types.ts`, `src/webgl/shaderParams.ts`, `src/webgl/shaders.ts`, `src/webgl/WebGLRendererCore.ts`, `src/storage/repositories/readingProgressRepository.ts`, `src/storage/repositories/readerSettingsRepository.ts`, `src/app/serviceContext.ts`, `src/app/ServiceProvider.tsx` および各 1対1 単体テスト
2. **MK-2: クイック画質補正ボトムシート・`rtl`/`ltr` シークバー付き HUD・ローカル閲覧履歴 UI コンポーネント ＆ Storybook/VRT 実装**
   - 対象: `src/features/reader/ReaderShaderSheet.tsx`（`.stories.tsx` / `.test.tsx`）, `src/features/reader/ReaderHudOverlay.tsx`（`.stories.tsx` / `.test.tsx`）, `src/features/bookshelf/RecentLocalHistorySection.tsx`（`.stories.tsx` / `.test.tsx`）, `test/vrt/snapshots/*`
3. **MK-3: `ReaderCanvas` シェーダー反映・`ReaderPage` 自動レジューム／優先度2戻る制御・`BookshelfPage` 閲覧履歴統合**
   - 対象: `src/webgl/ReaderCanvas.tsx`（`.stories.tsx` / `.test.tsx`）, `src/features/reader/ReaderPage.tsx`（`.stories.tsx` / `.test.tsx`）, `src/features/bookshelf/BookshelfPage.tsx`（`.stories.tsx` / `.test.tsx`）, `test/vrt/snapshots/*`
4. **IT (Step 4): Playwright `SCN-01`/`SCN-02` E2E 拡充・手動検証用 `ho08-shader-seek-test.cbz` 生成・仕様アーカイブ・Android 実機検証（`Closes #22`）**
   - 対象: `test/it/helpers.ts`, `test/it/smoke.spec.ts`, `test/it/local-reader.spec.ts`, `scripts/generate-manual-test-archives.mjs`, `scripts/generate-manual-test-archives.d.mts`, `scripts/generate-manual-test-archives.test.ts`, `test/fixtures/manual/ho08-shader-seek-test.cbz`, `test/fixtures/manual/README.md`, 差分仕様アーカイブ移動

### 5.2 申し送り事項（`HO-08`）と Android 実機検証計画（区分 A: `親 Issue #22 完了前`）

- **判定理由**: 生 WebGL2 カスタムフラグメントシェーダー（`dFdx`/`dFdy` 画面微分 5タップ USM ＋ レベル・ガンマ補正）のモバイル GPU 精度・60fps スライダー追従、タッチドラッグシークバー、および Android ハードウェア戻るボタン優先度 2 制御を含むため、[workflow.md §2.2](../../guidelines/workflow.md#22-android-実機検証の実施判断基準と試験項目表フォーマット) の **区分 A（親 Issue #22 完了前に実機検証を実施）** と判定する。
- **`HO-08` 実機確認予定項目（Step 4 Gate 1〜6 通過後に `app-debug.apk` と `ho08-shader-seek-test.cbz` を Google Drive へ配置して提示）**:
  1. **生 WebGL2 1パス画質補正シェーダー＆スライダー追従**: `ho08-shader-seek-test.cbz`（および手持ち自炊 CBZ）を開き、上部 HUD「画質補正」から `whitePoint`（黄ばみ白飛ばし）・`blackPoint`（裏写り引き締め）・`gamma`（薄墨濃化）・`sharpness`（描線強調）を動かした際、カクつき・シェーダーエラーなくリアルタイムに紙面が変化し、「リセット」および「デフォルト保存」（別ファイル／再起動後も維持）が機能すること。
  2. **Android ハードウェア戻るボタン優先度 2 → 優先度 3 遷移**: 画質補正ボトムシート表示中に Android の戻る操作（3ボタン／ジェスチャー）を行うとリーダーを終了せずシートのみが閉じ、もう一度戻る操作を行うと `SCR-01` へ戻ること。
  3. **`rtl` / `ltr` シークバー操作**: 右開き（右端＝1P・左端＝最終P）および左開き（左端＝1P・右端＝最終P）の双方で、ドラッグ中はページ番号プレビューが滑らかに追従し、指を離した確定時に目的ページへ即座にジャンプできること。
  4. **`readingProgress` 自動レジューム＆`SCR-01` 閲覧履歴**: 途中ページ＋「1ページずらし」ON でリーダーを終了（およびアプリバックグラウンド移行）した際、`SCR-01` に「最近のローカル閲覧履歴（`読書中`・進捗バー）」が表示され、同じファイルを再選択すると保存ページ＆ずらし状態から自動レジュームし、最終ページ到達で `読了` バッジへ更新され、履歴の個別削除・一括クリアが動作すること。
