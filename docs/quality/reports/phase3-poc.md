---
type: quality-report
title: "Phase 3 (PoC: Walking Skeleton) 品質分析・Kaizen レポート"
description: "Phase 3 PoC（Issue #1〜#14）の欠陥分析、欠陥密度・DRE 評価、Android 実機検証総括、および v0.1 向け再発防止 Kaizen アクション"
status: "Approved"
updated: "2026-11-20"
tags: [quality-report, phase-3, poc, dre, defect-density, kaizen, android]
related_specs:
  - docs/index.md
  - docs/guidelines/workflow.md
  - docs/guidelines/testing.md
  - docs/specs/requirements.md
  - docs/quality/bug-and-handover-log.md
  - docs/quality/archive/phase3-poc-log.md
related_tests:
  - scripts/android-build-config.test.ts
  - test/vrt/vrt.spec.ts
  - test/it/smoke.spec.ts
  - test/it/local-reader.spec.ts
---

# Phase 3 (PoC: Walking Skeleton) 品質分析・Kaizen レポート

本レポートは、**Phase 3: Walking Skeleton (PoC)**（親 Issue `#1` / PR `#2`, `#7`〜`#10` および Milestone 横断レビュー Issue `#11` / Sub-issue `#12`〜`#14` / PR `#15`〜`#17`）の完了節目における品質定量分析、原因傾向、Android 実機検証結果、および次期 Milestone **`v0.1`** へ向けた再発防止（Kaizen）施策をまとめたものです。

---

## 1. エグゼクティブサマリー

- **検証対象範囲**: `LocalFileReader` → 標準 ZIP 1RTT パーサー → `CoordinatorCore` / `DecodeWorkerPool` (x2) Zero-Copy 転送 → `L1PageCache`（5 ページ上限・`bitmap.close()` 厳格解放）→ 生 WebGL2 Mipmap 単ページ描画 → `SCR-01` / `SCR-03` UI 統合 → `@capacitor/app` ハードウェア戻るボタン制御。
- **品質ゲート達成状況（`main @ 4768849` 時点）**:
  - 静的検査（`lint:okf`, `typecheck`, `lint`, `format:check`）: **100% PASS**
  - 単体テスト・カバレッジ（`vitest run --coverage`）: **34 ファイル / 162 テスト PASS（C0 / C1 / Functions / Lines 全対象ファイル 100%、不正 `v8 ignore` 0 件）**
  - Storybook VRT（1280×800 / 375×667 SwiftShader WebGL2）: **62 / 62 PASS（孤児 PNG 0 件）**
  - Playwright 実ブラウザ IT（`SCN-01` / `SCN-02`）: **12 / 12 PASS**
  - Android 実機検証（Pixel 10 Pro / Android 16）: 初期 Edge-to-Edge 不具合（No. 13）を是正し、PR `#10` 版（Run `#44636994224`）および Step 2 全是正反映版（Run `#44724086276` @ `4768849`）にて **全項目 OK**。
  - リリース後流出欠陥: **0 件**（Phase 3 PoC 完了ゲート時点 DRE **100%**）。

---

## 2. 定量メトリクス（規模・バグ密度・欠陥除去率 DRE）

### 2.1 コード規模とテスト比率

| 対象領域                                       | ファイル数 |   行数 (LOC / KLOC)   | 備考                                                                                                                          |
| :--------------------------------------------- | :--------: | :-------------------: | :---------------------------------------------------------------------------------------------------------------------------- |
| **製品コード（`src/` TS/TSX 本体）**           |     41     |   4,134 (4.13 KLOC)   | `*.test.*` / `*.stories.*` / `src/test/**` / `__fixtures__/**` 除外（ほかに `MainActivity.java`・`capacitor.config.ts` 有り） |
| **単体テスト・フィクスチャ・テスト基盤**       |     35     |   7,524 (7.52 KLOC)   | `src/**/*.test.*`（33 ファイル / 7,198 行）＋ `zipBuilder.ts`・`src/test/setup.ts`（2 ファイル / 326 行）                     |
| **Storybook（`src/**/*.stories.tsx`）**        |     10     |    602 (0.60 KLOC)    | 全 10 TSX ファイルと 1 対 1 対応（VRT 30 ストーリー × 2 画面幅）                                                              |
| **IT / VRT / 設定検証（`test/`, `scripts/`）** |     5      |   1,137 (1.14 KLOC)   | `smoke.spec.ts`, `local-reader.spec.ts`, `vrt.spec.ts`, `android-build-config.test.ts` 等                                     |
| **テスト・品質保証資産 合計**                  |   **50**   | **9,263 (9.26 KLOC)** | 製品コード比 **2.24 倍**                                                                                                      |

### 2.2 バグ記録集計（[phase3-poc-log.md](../archive/phase3-poc-log.md) No. 1〜27）

| 集計軸           | 区分 / コード                                                  | 製品コード | 支援成果物 |   合計    |   構成比   |
| :--------------- | :------------------------------------------------------------- | :--------: | :--------: | :-------: | :--------: |
| **総検出件数**   | 全フェーズ合計（No. 1〜27）                                    | **13 件**  | **14 件**  | **27 件** | **100.0%** |
| **原因 5 分類**  | `D`（Design: 設計・仕様・検証計画の齟齬/漏れ）                 |     5      |     8      |  **13**   | **48.1%**  |
|                  | `B`（Boundary: JSDOM / Node ESM / DPR / Comlink 境界）         |     3      |     3      |   **6**   | **22.2%**  |
|                  | `S`（State: React `useEffect` / Router / `popstate` 状態遷移） |     4      |     0      |   **4**   | **14.8%**  |
|                  | `L`（Logic: テスト条件誤設定・集計ミス等）                     |     0      |     3      |   **3**   | **11.1%**  |
|                  | `A`（Async: ネイティブリスナー非同期解除競合）                 |     1      |     0      |   **1**   |  **3.7%**  |
| **検出フェーズ** | TDD Green / 局所テスト（Vitest JSDOM）                         |     0      |     5      |   **5**   | **18.5%**  |
|                  | PR レビュー（Step 2〜4 ＆ Step 3 / `pr-reviewer`）             |     1      |     6      |   **7**   | **25.9%**  |
|                  | VRT 目視確認（Chromium）                                       |     1      |     0      |   **1**   |  **3.7%**  |
|                  | Android 実機検証（Pixel 10 Pro / `HO-01`）                     |     1      |     0      |   **1**   |  **3.7%**  |
|                  | Milestone Step 1 横断レビュー（3 オーケストレーター）          |     8      |     3      |  **11**   | **40.7%**  |
|                  | Step 2 IT 追加検証（Playwright Chromium / Node 24 ESM）        |     2      |     0      |   **2**   |  **7.4%**  |

### 2.3 製品欠陥密度・欠陥除去率（DRE）の評価

- **製品欠陥密度（`src/` 4.13 KLOC 基準）**: `13 / 4.134` ＝ **3.14 件 / KLOC**（支援成果物を含めた総検出密度は `27 / 4.134` ＝ `6.53 件 / KLOC`）。
- **フェーズ完了時点の欠陥除去率（DRE）**: 検出された全 27 件（製品 13 件・支援 14 件）を Phase 3 完了ゲート前に 100% 是正し、リリース後（承認後）への未解決流出は **0 件（DRE = 100%）**。
- **中間工程における除去率の振り返り（重要示唆）**:
  - 親 Issue `#1` クローズ時点（PR `#10` マージ時）までに捕捉できた製品バグは **3 件**（No. 6, 10, 13）であったのに対し、Milestone Step 1 横断レビューおよびその是正 IT で追加 **10 件**（製品コード 10 件：No. 14, 15, 16, 18, 19, 20, 21, 22, 23, 24）を捕捉した。
  - **得られた知見**: 単体テスト C0/C1 100% を満たしていても、①`*.worker.ts` カバレッジ除外境界（No. 6, 15）、②親子の `useEffect` / `popstate` / `StrictMode` 結合ライフサイクル（No. 10, 18, 19, 23）、③仕様正本間の前提食い違い（No. 14, 16, 22）、④Android 15/16 Edge-to-Edge 等の実機環境差（No. 13）は単発 PR 内で見逃されやすく、**3 観点・マルチオーケストレーターのアンカリングなし横断レビュー**が極めて高い検出効果を発揮した。

---

## 3. 原因傾向分析と再発防止 Kaizen アクション

### 3.1 傾向 1: 原因 `D`（設計・検証観点・ドキュメント間同期漏れ）が全体の 48.1%（13 / 27 件）

- **主な事象**:
  - `zip-streaming.md` と `architecture.md` 間の `physicalEnd` 定義不一致（No. 14 / `R1-16`）、モジュール表・Comlink エラー契約・`L1PageCache` 用語不一致（No. 17, 26）、`SCN-xx` 定義の正本不在（`R1-08`）、原因 `D` 是正時のアーカイブ差分仕様同期漏れ（No. 13 → `R1-07`）、`resetTestDb` の仕様と実装/IT の乖離（No. 16, 22）、squash マージに伴う無効 SHA 記録（`R1-09`）、IT 網羅漏れの本質的原因と分類基準の曖昧さ（No. 11, 12 → `R1-13`）。
- **Kaizen 反映**:
  1. **`.agents/agents/pr-reviewer.md`**: IT 網羅性照合の正本に `docs/specs/screen-transitions.md §5`（`SCN-xx` トレーサビリティ対応表）を明記（`R1-08`）。
  2. **`docs/guidelines/testing.md §6`**: squash マージ後は **`main` 上の squash SHA ＋ PR 番号** を主表記とする規約（`R1-09`）、および IT シナリオ網羅漏れ・仕様記載漏れを **`D`（Design）** へ分類する判定基準例（`R1-13`）を明記。

### 3.2 傾向 2: React 19 ライフサイクル・履歴遷移・非同期状態遷移（原因 `S` 4 件 ＋ `A` 1 件）

- **主な事象**:
  - `RouterProvider` 初回マウント時の `initialPath` 上書き（No. 10）、子 `<ReaderCanvas>` マウント失敗を親 `<ReaderPage>` の `setArchiveError(null)` が上書き消失させる問題（No. 18 / `R1-14`）、`popstate` 退場時の `clearSession()` 漏れと `handleClose` の `"/"` 二重積み（No. 19 / `R1-15`）、さらに React 19 `popstate` `DiscreteEventPriority` で親 `RouterProvider` が子 `ReaderPage` を先にアンマウントして子リスナーが走らない問題（No. 23）、および `CapacitorAppBridge` 非同期解除ウィンドウ（No. 21 / `R1-19`）。
- **Kaizen 反映**:
  1. **`docs/guidelines/testing.md §2.4`**:
     - 子コンポーネントからマウント時に通知され得る致命的エラー状態（WebGL2 初期化失敗等）は親の非同期初期化リセット対象から分離し、`initialSnapshot` なしの通常マウント経路で子スパイが同期 `onFatalError` を発火する UT を必須化。
     - 履歴遷移を伴う終了契約（`TR-08` 等）は `Escape`/UI 戻りだけでなく Playwright IT での `page.goBack()` → `page.goForward()` を必須検証とし、`StrictMode` 再マウントと親先行アンマウント双方に耐える終了クリーンアップを規約化。

### 3.3 傾向 3: テスト環境・カバレッジ除外・OS 実機境界（原因 `B` 6 件）

- **主な事象**:
  - `*.worker.ts` 除外下に転送分岐ロジックが混入した問題（No. 15 / `R1-06`）、`matchMedia` DPR 単独変化（No. 20 / `R1-10`）、Node 24 ESM JSON import attribute（No. 24）、JSDOM の `Blob.arrayBuffer`/`PointerEvent`/`relatedTarget` 差異（No. 4, 8, 9）、Android 15/16 Edge-to-Edge システムバー重複（No. 13）。
- **Kaizen 反映**:
  1. **`docs/guidelines/testing.md §2.1`**: `*.worker.ts` ラッパー内への条件分岐（`if` / 三項演算子）混入を明示禁止し、転送前処理・所有権制御を純関数モジュール（例: `coordinatorTransfer.ts`）へ分離して 100% UT 対象化する規律を追加。
  2. **`docs/guidelines/testing.md §2.4`**: Android Edge-to-Edge（`adjustMarginsForEdgeToEdge: "auto"`・`MainActivity` システムバー外観・HUD `env(safe-area-inset-*)`）の機械検証維持を明文化。

---

## 4. Android 実機検証総括 ＆ 残存申し送り事項（`v0.1` 引き継ぎ）

1. **実機検証総括（Pixel 10 Pro / Android 16）**:
   - 初回実機検証（Run `#44580218248`）にて Android 15/16 強制 Edge-to-Edge 環境下の HUD / ヘッダー操作阻害（No. 13）を早期検出し、コード・ネイティブ設定・正本 3 冊を同期是正した Run `#44636994224` にて `HO-01` 全 8 項目を確認。
   - さらに横断レビュー Step 2 の製品コード修正（`R1-10`, `R1-14`, `R1-15`, `R1-16`, `R1-19` 等）を反映した再ビルド APK（Run `#44724086276` @ `4768849`）でも実機全項目 OK を確認済み。
2. **次期 Milestone `v0.1` への引き継ぎ事項**:
   - **`HO-03`（`Open` / 完了ゲート: `Milestone v0.1 完了前`）**: `readCompressedPageSlice` での毎ページ `subarray` コピー削減、および `v0.1` の 80MB `L2ByteCache` 導入時に `prepareDecodeTransfer` が共有キャッシュ済み `ArrayBuffer` を `Comlink.transfer` でデタッチ破壊しないよう複製強制／所有権分離を実装する。
