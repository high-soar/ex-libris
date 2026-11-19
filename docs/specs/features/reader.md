---
type: spec-feature
title: "WebGL2 ストリーミングリーダー画面仕様書（SCR-03: Reader）"
description: "SCR-03（/read/local）の右開き単ページ閲覧、タップ/スワイプ/キー操作、最小HUD開閉、異常系復帰、およびTR-08/TR-10リソース解放仕様の正本"
status: "Review (#1)"
updated: "2026-11-19"
tags: [feature, reader, scr-03, rtl, hud, touch, webgl2, back-button]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/zip-streaming.md
  - docs/specs/engine/webgl2-renderer.md
  - docs/specs/features/bookshelf.md
  - docs/guidelines/testing.md
related_tests:
  - src/App.test.tsx
  - src/features/reader/ReaderPage.test.tsx
  - src/features/reader/ReaderHudOverlay.test.tsx
  - src/features/reader/ReaderErrorView.test.tsx
  - src/features/reader/localReaderSessionStore.test.ts
  - src/features/reader/readerErrors.test.ts
  - src/webgl/ReaderCanvas.test.tsx
  - src/bridges/app/capacitorAppBridge.test.ts
  - src/bridges/app/mockAppBridge.test.ts
  - test/vrt/vrt.spec.ts
  - test/it/local-reader.spec.ts
---

# WebGL2 ストリーミングリーダー画面仕様書（`SCR-03`: Reader）

本ドキュメントは、ExLibris のフルスクリーンリーダー画面 **`SCR-03`（Phase 3 ルート `/read/local`、`v0.2`〜 `/read/volume/:volumeId`）** に関する UI/UX・入力操作・異常系ハンドリング・リソース解放ライフサイクルの正本（Single Source of Truth）です。

---

## 1. セッション保護（`TR-10`）と終了シーケンス（`TR-08`）

1. **セッション不在フォールバック（`TR-10`）**:
   - `/read/local` マウント時にオンメモリセッション（`useLocalReaderSessionStore.session`）が `null` の場合（リロードや URL 直接入力時）、エラー画面や空白で停止せず、即座に `router.replace("/")` で `SCR-01` へ遷移する。
2. **リーダー終了と完全リソース解放（`TR-08`）**:
   - 上部 HUD の「戻る」ボタン、`Escape` キー、エラー画面の「ホームへ戻る」ボタン、または Android ハードウェア戻るボタン（`AppBridge` `backButton`）で発動する。
   - 以下の順序でリソースを確定解放した上で `/` へ戻る：
     1. 進行中 `requestEpoch` を無効化（`cancelEpochBelow`）＋ `CoordinatorWorker.closeArchive()` 呼び出し
     2. `L1PageCache.clear()` により保持中の全 `ImageBitmap.close()` ＋ `WebGLRendererCore` 全テクスチャ `gl.deleteTexture()` 実行
     3. `WebGLRendererCore.dispose()` 実行
     4. オンメモリ `File` セッションを `null` へクリア
     5. `router.navigate("/", { replace: true })`（または適切な履歴戻り）

---

## 2. ページ送り操作契約（Phase 3: 右開き `rtl` 固定）

`Phase 3` では日本のマンガ標準である **右開き（`rtl`）固定** とし、左右綴じ切替は `v0.1` で追加します。

| 入力手段                  | 条件・領域                                                               | 実行アクション                                                    |
| :------------------------ | :----------------------------------------------------------------------- | :---------------------------------------------------------------- |
| **タップ / クリック**     | 左端 30%（`0 <= ratio < 0.30`）                                          | **次のページへ**（`N + 1`、`totalPages - 1` 上限）                |
|                           | 中央 40%（`0.30 <= ratio <= 0.70`）                                      | **上下 HUD オーバーレイの表示/非表示をトグル**                    |
|                           | 右端 30%（`0.70 < ratio <= 1.0`）                                        | **前のページへ**（`N - 1`、`0` 下限）                             |
| **横スワイプ（Pointer）** | 水平移動量 `Math.abs(dx) >= 40` かつ `Math.abs(dx) > Math.abs(dy)`（px） | 左→右ドラッグ（`dx > 0`）＝**次頁** / 右→左（`dx < 0`）＝**前頁** |
| **キーボード**            | `ArrowLeft`                                                              | **次のページへ**（`N + 1`）                                       |
|                           | `ArrowRight`                                                             | **前のページへ**（`N - 1`）                                       |
|                           | `Escape`                                                                 | **リーダー終了**（`TR-08`）                                       |

- **ポインターイベント実装原則**: スワイプ開始座標等の高頻度状態は `useRef` で保持し、React 再レンダーを引き起こさない。タップとスワイプの誤爆を防ぐため、閾値以上のドラッグが成立した場合はタップ判定を発火しない。
- **HUD 表示中のポインター遮断**: 上部バーまたは下部バー上の操作は下層のタップゾーンへバブリングさせない（`stopPropagation`）。

---

## 3. 最小オーバーレイ HUD 構成と表示状態

1. **初期表示状態**:
   - リーダーオープン直後は **HUD 非表示（`isHudOpen = false`）** の完全フルスクリーン没入表示から開始する。
2. **上部バー（`data-testid="reader-hud-top"`）**:
   - 左側: **「戻る」ボタン**（`data-testid="reader-back-button"`, `TR-08` 実行）
   - 中央/タイトル: 開いているローカルアーカイブのファイル名（`fileName`、1行省略表示）
3. **下部バー（`data-testid="reader-hud-bottom"`）**:
   - 右開き（`rtl`）の視覚順に合わせ、**左側に「← 次へ」ボタン**（`data-testid="reader-next-button"`）、**中央に 1 始まりのページ表示 `N / Total`**（`data-testid="reader-page-indicator"`）、**右側に「前へ →」ボタン**（`data-testid="reader-prev-button"`）を配置する。
   - 先頭ページ（`0`）では「前へ →」を `disabled`、最終ページ（`totalPages - 1`）では「← 次へ」を `disabled` とする。

---

## 4. ローディング状態・異常系エラーハンドリング

### 4.1 アーカイブ全体・環境エラー（閲覧不能時）

アーカイブオープン時または WebGL2 初期化時に以下のエラーが発生した場合、`diagnosticLogger.error("reader", ...)` に記録した上で、全画面エラーパネル（`data-testid="reader-error-view"`）と **「ホームへ戻る」ボタン**（`data-testid="reader-error-back-button"`, `TR-08` 実行）を表示する。

- `CORRUPT_ZIP`: 「ZIP ファイルが破損しているため開けませんでした」
- `EMPTY_ARCHIVE`: 「表示できる画像ファイル（JPEG / PNG / WebP / AVIF）が見つかりませんでした」
- `ENCRYPTED_ZIP`: 「パスワード保護（暗号化）された ZIP ファイルには対応していません」
- `UNSUPPORTED_COMPRESSION`: 「未対応の圧縮方式が含まれているため開けませんでした」
- `ZIP64_NOT_SUPPORTED`: 「4GB 超の ZIP64 形式は次期バージョン（v0.1）で対応予定です」
- `READ_ERROR`: 「ファイルの読み込みに失敗しました（アクセス権限またはストレージ状態を確認してください）」
- `WEBGL_UNSUPPORTED` / `WEBGL_INIT_FAILED`: 「WebGL2 描画の初期化に失敗しました」

### 4.2 個別ページデコード・読込エラー（閲覧継続可能）

特定ページ `k` のみが `DecodedPageFrame`（`status: "error"`, `errorCode: "DECODE_FAILED" | "CORRUPT_ZIP" | "READ_ERROR"`）で失敗した場合：

- `diagnosticLogger.error("reader", ...)` へ記録し、`L1PageCache` へ `error` 状態を格納する。
- 当該ページ表示時のみ中央にページ単位のエラー表示（`data-testid="reader-page-error"`、エラー理由メッセージおよび前後ページ移動案内）を出し、**前後ページへの移動・スワイプ・HUD・戻る操作はそのまま継続可能** とする。

### 4.3 ローディング表示

- アーカイブ解析中または現在ページが L1 未到着の間は、控えめなローディングインジケータ（`data-testid="reader-loading"`）を表示し、現在ページの描画完了とともに非表示にする。

---

## 5. コンポーネント構成と親子分離（1対1 Story / UT 対象）

| コンポーネント     | ファイルパス                               | 責務（テスト分離方針）                                                                 |
| :----------------- | :----------------------------------------- | :------------------------------------------------------------------------------------- |
| `ReaderPage`       | `src/features/reader/ReaderPage.tsx`       | `TR-10` ガード、Coordinator RPC 制御、`L1PageCache` / Epoch 管理、入力判定、終了解放   |
| `ReaderCanvas`     | `src/webgl/ReaderCanvas.tsx`               | 生 WebGL2 キャンバス、`ResizeObserver`、コンテキストロスト復帰（`webgl2-renderer.md`） |
| `ReaderHudOverlay` | `src/features/reader/ReaderHudOverlay.tsx` | 上下オーバーレイ HUD（戻る・ファイル名・`N / Total`・次へ/前へボタン）                 |
| `ReaderErrorView`  | `src/features/reader/ReaderErrorView.tsx`  | アーカイブ全体エラーパネルおよび個別ページデコードエラー表示                           |

- `ReaderPage` の単体テストでは `ReaderCanvas`, `ReaderHudOverlay`, `ReaderErrorView` を `vi.spyOn(...).mockImplementation(() => null)` で完全分離する。

---

## 6. 受け入れ条件（`AC-RD-xx`）

|   AC ID    | 受け入れ条件                                                                                                                                               |
| :--------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-RD-01` | `/read/local` でメモリ上の `File` セッションが不在の場合、エラー停止せず即時 `/` へフォールバックする（`TR-10`）。                                         |
| `AC-RD-02` | オープン直後は HUD 非表示のフルスクリーンで開始し、中央 40% タップで上下 HUD を開閉できる。                                                                |
| `AC-RD-03` | 右開き（`rtl`）ルールで左 30% タップ／左→右スワイプ／`ArrowLeft` が次ページ、右 30% タップ／右→左スワイプ／`ArrowRight` が前ページへ移動する。             |
| `AC-RD-04` | 下部 HUD に 1 始まりの `N / Total` と「← 次へ」「前へ →」ボタンが表示され、先頭・末尾ページで適切に `disabled` になる。                                    |
| `AC-RD-05` | 連続めくり時に `requestEpoch` が更新され、古い要求の進行中 I/O 中断および遅延到着 `ImageBitmap` の即時 `close()` が行われる。                              |
| `AC-RD-06` | 破損・空・暗号化・未対応圧縮・ZIP64・WebGL2 失敗時は診断ログ記録の上で理由別エラー画面と「ホームへ戻る」を表示する。                                       |
| `AC-RD-07` | 個別ページのみのデコード失敗時は当該ページのみエラー表示とし、前後ページへの移動を阻害しない。                                                             |
| `AC-RD-08` | 戻るボタン・`Escape` キー・Android ハードウェア戻るボタンで `TR-08`（Worker 停止・L1 `bitmap.close()`・WebGL 破棄・セッションクリア）を実行し `/` へ戻る。 |
| `AC-RD-09` | 対象 TSX/TS ファイルすべてが 1 対 1 Story/UT・親子分離・C0/C1/Functions/Lines 100%・1280px/375px VRT を PASS する。                                        |
