---
type: quality-log
title: "品質記録・バグ記録票 ＆ 申し送り管理シート（Bug & Handover Log）"
description: "製品コードと支援成果物を分離したバグ記録（原因5分類 L/S/D/B/A）および後続タスクへの申し送り事項（HO-xx）を追跡する正本シート。"
status: "Approved"
updated: "2026-11-19"
tags: [quality, bug-log, handover, dre, kaizen]
related_specs:
  - docs/index.md
  - docs/guidelines/workflow.md
  - docs/guidelines/testing.md
related_tests: []
---

# 品質記録・バグ記録票 ＆ 申し送り管理シート（Bug & Handover Log）

本ドキュメントは、ExLibris の開発プロセス（設計レビュー、TDD 実装、単体テスト、VRT、結合テスト、独立 AI レビュー、節目横断レビュー、Android 実機検証）において検出された不備の記録、および後続タスクへの申し送り事項（Handover Items）を追跡管理する正本シートです。

---

## 1. バグ記録の記入ルール

1. **記録対象と除外基準**:
   - **記録対象**: 実装後のテスト失敗、AI レビュー（`pr-reviewer` / `phase-final-reviewer`、Step 2 設計 PR レビュー含む）での指摘事項、VRT 差分検知、IT（結合テスト）や実機確認で発覚した仕様違反・バグ・設計不整合を 1 件として記録します。
   - **除外対象**: TDD の初回 Red ステップ（未実装機能に対する意図的なテスト失敗）や、作業中の単純なタイポ・フォーマッタ自動整形は除外します。
2. **成果物区分の厳格分離**:
   - **`製品コード`**: `src/`（および `android/` 独自プラグイン）配下の本番アプリケーションコードの不備（製品バグ密度および欠陥除去率 DRE の分子として集計）。
   - **`支援成果物`**: テストコード（`*.test.*`, `test/it/`）、Storybook（`*.stories.tsx`）、フィクスチャ、モック、設計ドキュメント単体の記述ミス、CI/設定ファイルの不備。
3. **原因分類コード（5分類）**:
   - **`L` (Logic)**: 条件分岐・バイナリオフセット計算・アルゴリズム等のロジック誤り
   - **`S` (State)**: React/Zustand State・L1/L2 キャッシュ状態・読書進捗等の状態遷移誤り
   - **`D` (Design)**: 仕様・設計書（`docs/specs/`）の誤認、インターフェース契約や Dexie スキーマとの不一致、設計考慮漏れ
   - **`B` (Boundary)**: 0件、4GB超 ZIP64、CP932 特殊文字、巨大解像度画像（`MAX_TEXTURE_SIZE` 超）等の境界値・エッジケース考慮漏れ
   - **`A` (Async)**: 非同期競合（Race Condition）、Worker RPC 世代ズレ、レートリミット制御、`AbortController` / `ImageBitmap.close()` 未連携
4. **【重要】原因分類 `D` の設計書即時同期義務**:
   - 原因が **`D`** の場合、**コードのみを修正して設計書を放置することは厳禁**です。必ず対応する `docs/specs/` の設計書（App 全体正本および進行中の差分仕様）も同時修正し、是正内容欄に **コード修正コミットと設計書同期コミットの双方** を記録してください。
5. **【運用】Milestone 完了時のアーカイブ移動ルール**:
   - 各節目（Phase 3 PoC 完了・各ミニリリース Milestone Step 3）において、完了したバグ記録および解決済み（`Resolved`）の申し送り事項を `docs/quality/archive/<milestone>-log.md`（OKF `type: quality-log`, `status: "Completed (Archived)"`）へアーカイブ移動し、本シートをクリーンに保ちます。

---

## 2. バグ記録一覧（Bug Log）

現在進行中のフェーズ／マイルストーンで検出されたバグ記録を No. 1 より連番で記入します。

| No. |  Issue / PR  | 検出フェーズ・手段           | 成果物区分 (`製品コード` / `支援成果物`) | 対象箇所                                                               | 原因 (`L`/`S`/`D`/`B`/`A`) | 不備の概要と是正内容（原因 `D` は設計書同期コミット併記）                                                                                                                                                                                                                                |
| :-: | :----------: | :--------------------------- | :--------------------------------------: | :--------------------------------------------------------------------- | :------------------------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  1  | `#1 / PR #2` | Step 2 PR レビュー (Round 1) |               `支援成果物`               | `docs/specs/architecture.md`, `zip-streaming.md`, `webgl2-renderer.md` |            `D`             | `requestVisiblePages` の単一 Promise 契約と先読み/個別エラー伝達、および `ZipPageEntry.entryNameByteLength`・LFH境界チェックの不整合を指摘。`DecodedPageFrame` (`ready`/`error`) 判別共用体・2段階呼び出し契約・`entryNameByteLength`・`maxSpan < 30` 判定を設計是正コミットにて同期修正 |
|  2  | `#1 / PR #2` | Step 2 PR レビュー (Round 1) |               `支援成果物`               | `docs/specs/features/reader.md`                                        |            `D`             | スワイプ判定表の未エスケープ `\|` による表崩れ、および `READ_ERROR` の画面エラー処理未記載を指摘。`Math.abs` 表記化および `§4.1`/`§4.2` への `READ_ERROR` 追記で同期修正                                                                                                                 |
|  3  | `#1 / PR #2` | Step 2 PR レビュー (Round 1) |               `支援成果物`               | `docs/specs/requirements.md`, 親 Issue `#1` 本文                       |            `D`             | `requirements.md` の Phase 3 備考（オンメモリ完結 / `L1(5P)` 先行）未同期、および親 Issue `#1` 本文の実機検証タイミング・確認観点未記入を指摘。`requirements.md` 同期更新および親 Issue `#1` 本文更新にて是正                                                                            |
|  4  | `#3 (MK-1)`  | TDD Green (Vitest JSDOM)     |               `支援成果物`               | `src/test/setup.ts`                                                    |            `B`             | JSDOM 26 で `Blob.prototype.arrayBuffer` が未実装のため `LocalFileReader` の `file.slice().arrayBuffer()` が `TypeError` で失敗。`src/test/setup.ts` へ `FileReader.readAsArrayBuffer` ベースの互換ポリフィルを追加して是正                                                              |
|  5  | `#3 (MK-1)`  | TDD Green (Vitest)           |               `支援成果物`               | `src/engine/workers/CoordinatorCore.test.ts`                           |            `L`             | 同一 epoch 並行リクエスト（`[0, 1, 2]` ＋ `[0]`）の `decodePageSlice` 呼出回数が計 4 回のところモック戻り値・期待回数を 3 回と誤設定していたため Green 検証で失敗。4 回目のモック設定・期待値 `4` 修正・完了待ちへ是正                                                                   |

---

## 3. 申し送り事項追跡一覧（Handover Items: `HO-xx`）

設計時や PR 作業中に「現在の PR スコープ外だが、後続の Sub-issue や IT、Android 実機確認で必ず検証・対応すべき事項」が発生した場合は、以下に `HO-01` より連番で登録し、完了ゲートまでに確実に消化します。

|   ID    | 起票元 Issue / PR | 申し送り事項の内容                                                                                                                                                                                                                                                                                                      | 解決先（対象 Issue / 成果物）                                                             |      完了ゲート      | 状態 (`Open` / `Resolved`) |
| :-----: | :---------------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- | :------------------: | :------------------------: |
| `HO-01` |       `#1`        | Phase 3 PoC（ローカル `.zip`/`.cbz` SAF ファイル選択 → Worker Zero-Copy 解凍 → 生 WebGL2 Mipmap 単ページ描画・モアレ除去 → 右開きタップ/スワイプ操作・HUD 開閉 → L1 `bitmap.close()` 連続めくりメモリ安定性 → `@capacitor/app` ハードウェア戻るボタン `TR-08` 解放 ＆ `SCR-01` `minimizeApp()`）のクラウド APK 実機検証 | `#1`（Step 4 最終 IT PR Gate 1〜6 通過後に `build-android.yml` 実行 ＆ 試験項目表を提示） | `親 Issue #1 完了前` |           `Open`           |

---

## 4. ミニリリース Milestone 品質振り返りサマリー（定期追記）

各節目（Phase 3 PoC 完了時、および Phase 4 以降の各ミニリリース Milestone Step 3）に、バグ記録を集計して傾向分析とプロセス改善（Kaizen）アクションを記録します（詳細レポートは `docs/quality/reports/` 配下に格納）。
