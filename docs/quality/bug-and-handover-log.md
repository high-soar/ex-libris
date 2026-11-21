---
type: quality-log
title: "品質記録・バグ記録票 ＆ 申し送り管理シート（Bug & Handover Log）"
description: "製品コードと支援成果物を分離したバグ記録（原因5分類 L/S/D/B/A）および後続タスクへの申し送り事項（HO-xx）を追跡する正本シート。"
status: "Approved"
updated: "2026-11-21"
tags: [quality, bug-log, handover, dre, kaizen]
related_specs:
  - docs/index.md
  - docs/guidelines/workflow.md
  - docs/guidelines/testing.md
  - docs/quality/archive/phase3-poc-log.md
  - docs/quality/reports/phase3-poc.md
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
   - **`D` (Design)**: 仕様・設計書（`docs/specs/`）の誤認、インターフェース契約や Dexie スキーマとの不一致、設計考慮漏れ、**IT シナリオ・主要導線の検証観点網羅漏れ**
   - **`B` (Boundary)**: 0件、4GB超 ZIP64、CP932 特殊文字、巨大解像度画像（`MAX_TEXTURE_SIZE` 超）、JSDOM/Node ESM/DPR 等の技術的・環境的境界値の考慮漏れ
   - **`A` (Async)**: 非同期競合（Race Condition）、Worker RPC 世代ズレ、レートリミット制御、`AbortController` / `ImageBitmap.close()` 未連携
4. **【重要】原因分類 `D` の設計書即時同期・SHA 記録義務**:
   - 原因が **`D`** の場合、**コードのみを修正して設計書を放置することは厳禁**です。必ず対応する `docs/specs/` の設計書（App 全体正本および進行中の差分仕様）も同時修正し、是正内容欄に **コード修正コミットと設計書同期コミットの双方** を記録してください。
   - PR を `--squash --delete-branch` でマージした後は、消滅するトピックブランチ上の個別 SHA 単体ではなく、**`main` ブランチ上の squash コミット SHA および PR 番号を主表記として記録**（必要に応じて PR 内 SHA を併記）してください。
5. **【運用】Milestone 完了時のアーカイブ移動ルール**:
   - 各節目（Phase 3 PoC 完了・各ミニリリース Milestone Step 3）において、完了したバグ記録および解決済み（`Resolved`）の申し送り事項を `docs/quality/archive/<milestone>-log.md`（OKF `type: quality-log`, `status: "Completed (Archived)"`）へアーカイブ移動し、本シートをクリーンに保ちます。

---

## 2. バグ記録一覧（Bug Log）

現在進行中のマイルストーン（`v0.1`〜）で検出されたバグ記録を No. 1 より連番で記入します（※Phase 3 PoC の No. 1〜27 は [phase3-poc-log.md](archive/phase3-poc-log.md) へアーカイブ済み）。

| No. |   Issue / PR   | 検出フェーズ・手段           | 成果物区分 (`製品コード` / `支援成果物`) | 対象箇所                                                                                                                        | 原因 (`L`/`S`/`D`/`B`/`A`) | 不備の概要と是正内容（原因 `D` は設計書同期コミット併記）                                                                                                                                                                                                                                                                                                                                                                           |
| :-: | :------------: | :--------------------------- | :--------------------------------------: | :------------------------------------------------------------------------------------------------------------------------------ | :------------------------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  1  | `#27 / PR #28` | Step 2 PR レビュー (Round 1) |               `支援成果物`               | `docs/specs/changes/issue-27-android-apk-upgrade.md`, `docs/specs/architecture.md`                                              |            `D`             | `../debug.keystore` が `hasCustomKeystore` に含まれ Release / `REQUIRE_FIXED_SIGNING=true` ガードをバイパスし `AC-APK-01` とも矛盾する設計不備を指摘。PR #28 @ 19c9e4b（PR #28 内コミット `8863d7b`） にて `hasEnvKeystore` とローカル `../debug.keystore` を厳格分離し、`signingConfigs.release`・Release ガードは `hasEnvKeystore` のみを要求するよう両設計書を同期是正                                                           |
|  2  | `#27 / PR #28` | Step 2 PR レビュー (Round 1) |               `支援成果物`               | `docs/specs/changes/issue-27-android-apk-upgrade.md`, `docs/specs/architecture.md`                                              |            `D`             | Remote Agent VM に Android SDK が無く、`build.gradle` 異常系・境界ガードを Gradle ランタイムで検証する手段が計画から欠落。PR #28 @ 19c9e4b（PR #28 内コミット `8863d7b`） にて `ci.yml`（`android-compile`）へダミー入力のゼロコンフィグ負系 Gradle 検証ステップを追加する方針を両設計書（`AC-APK-03` 含む）へ同期是正                                                                                                              |
|  3  | `#27 / PR #28` | Step 2 PR レビュー (Round 1) |               `支援成果物`               | `docs/specs/changes/issue-27-android-apk-upgrade.md`, `docs/specs/architecture.md`                                              |            `D`             | `apksigner` 失敗時の `keytool` フォールバック条件・`SHA-1`/`SHA-256` 空抽出停止条件・出力書式（大文字コロン区切り）が曖昧。PR #28 @ 19c9e4b（PR #28 内コミット `8863d7b`） にて「バイナリ不在時のみ `keytool` フォールバック、`apksigner` 検証失敗・空抽出時は即 `exit 1`、大文字コロン区切り 16 進正規化」を両設計書（`AC-APK-04`）へ明記是正                                                                                      |
|  4  | `#27 / PR #28` | Step 2 PR レビュー (Round 1) |               `支援成果物`               | `docs/specs/changes/issue-27-android-apk-upgrade.md`                                                                            |            `D`             | 差分仕様 §3.1 の `java.util.Base64.decoder.decode(...)` と §4 / `architecture.md` の `Base64.getDecoder().decode(...)` 表記揺れを指摘。PR #28 @ 19c9e4b（PR #28 内コミット `8863d7b`） にて `Base64.getDecoder().decode(...)` へ統一是正                                                                                                                                                                                            |
|  5  | `#27 / PR #28` | Step 2 PR レビュー (Round 1) |               `支援成果物`               | `docs/specs/changes/issue-27-android-apk-upgrade.md`, `docs/specs/architecture.md`                                              |            `D`             | `build-android.yml` の `concurrency` 制御未定義による連続実行時 `versionCode` 逆転・衝突リスクを指摘。PR #28 @ 19c9e4b（PR #28 内コミット `8863d7b`） にて `concurrency`（`cancel-in-progress: false`）追加および順次 2 回ビルド手順を両設計書（`AC-APK-02`）へ同期是正                                                                                                                                                             |
|  6  | `#27 / PR #29` | Step 4 PR レビュー (Round 1) |               `支援成果物`               | `android/app/build.gradle`, `docs/specs/changes/archive/issue-27-android-apk-upgrade.md`                                        |            `B`             | Configuration Phase で `ci-signing.keystore` を書き出していたため `./gradlew clean assembleRelease` 併用時に `:app:clean` で削除されて失敗する境界不備を指摘。`build.gradle` にて `prepareCiSigningKeystore` タスク（`mustRunAfter clean`、かつ `preBuild` / `validateSigning*` / `package*` / `sign*` が `dependsOn`）へ Execution Phase 遅延化し、`ci.yml` に `./gradlew help` 非書き出し確認を追加、アーカイブ差分仕様も同時同期 |
|  7  | `#27 / PR #29` | Step 4 PR レビュー (Round 1) |               `支援成果物`               | `android/app/build.gradle`, `.github/workflows/ci.yml`, `docs/specs/changes/archive/issue-27-android-apk-upgrade.md`            |            `L`             | `gradle.taskGraph.whenReady` の Release 系タスク正規表現末尾 `$` が `signReleaseBundle` / `packageReleaseBundle` 等にマッチしない不備を指摘。`^(assemble\|bundle\|package\|sign).*Release(Bundle\|Apks\|UniversalApk)?$`（注: 実コード正規表現、台帳上 `/` 代替なしエスケープ）へ拡張し、`ci.yml` へ無署名 `./gradlew signReleaseBundle` 負系検証およびアーカイブ差分仕様同期を実施                                                 |
|  8  | `#19 / PR #30` | Step 2 PR レビュー (Round 1) |               `支援成果物`               | `docs/specs/engine/zip-streaming.md`, `docs/specs/changes/issue-19-zip64-cp932-index-cache.md`                                  |            `D`             | `readCompressedPageSlice` 2 RTT 経路で `dataStart >= initialBuf.byteLength`（超長 LFH Extra Field 時）の分岐が未定義で `tailSlice.byteLength > entry.compressedSize` による `RangeError` が起きる仕様欠陥を指摘。PR #30 後続コミットにてケース 2a（`dataStart < initialBuf.byteLength`）とケース 2b（`dataStart >= initialBuf.byteLength` の直接取得）を両設計書へ明記是正                                                          |
|  9  | `#19 / PR #30` | Step 2 PR レビュー (Round 1) |               `支援成果物`               | `docs/specs/engine/zip-streaming.md`, `docs/specs/changes/issue-19-zip64-cp932-index-cache.md`                                  |            `D`             | ZIP64 EOCD Locator 判定前に標準 EOCD `diskNumber !== 0 \|\| cdDiskNumber !== 0` を拒否する記述順により `0xFFFF` 飽和標準 EOCD を持つ ZIP64 が誤拒否される問題と `zip64EocdOffset + 56 <= eocdAbsoluteOffset - 20` 境界検証欠落を指摘。PR #30 後続コミットにて Locator 有無の先行分岐と事前 56B 境界検証を両設計書へ同期是正                                                                                                         |
| 10  | `#19 / PR #30` | Step 2 PR レビュー (Round 1) |               `支援成果物`               | `docs/specs/engine/zip-streaming.md`, `docs/specs/architecture.md`, `docs/specs/changes/issue-19-zip64-cp932-index-cache.md`    |            `D`             | `openArchive` 仕様の空配列・不正 `cachedEntries` 検証フォールバック契約に対し、MK 変更対象計画に `CoordinatorCore.ts` が含まれていない齟齬を指摘。PR #30 後続コミットにて共有検証ヘルパ・`CoordinatorCore.ts` / `CoordinatorCore.test.ts` を MK-2 スコープへ明記し全設計書を同期是正                                                                                                                                                |
| 11  | `#19 / PR #30` | Step 2 PR レビュー (Round 1) |               `支援成果物`               | `docs/specs/engine/zip-streaming.md`, `docs/specs/features/reader.md`, `docs/specs/changes/issue-19-zip64-cp932-index-cache.md` |            `D`             | CDH 非飽和 `diskStartNumber !== 0` の拒否条件明記漏れおよび `reader.md` `related_specs` への `db-schema.md` 参照漏れを指摘。PR #30 後続コミットにて双方を設計書へ追記是正                                                                                                                                                                                                                                                           |
| 12  |  `#32 (MK-2)`  | TDD Green (Vitest)           |               `支援成果物`               | `src/storage/repositories/zipIndexCacheRepository.test.ts`                                                                      |            `L`             | `Date.now` スパイへ副作用インクリメントを渡したため Dexie 内部参照で期待値より進み、また `maxEntries=2` テストの `now` 初期値 `0` が事前投入データの `cachedAt: 1..3` より小さく新規投入 `k4` 自身が退避されるテスト不備を検出。`mockReturnValue` 指定と `tick = 100` 開始へ修正                                                                                                                                                    |
| 13  |  `#32 (MK-2)`  | TDD Green (Vitest)           |               `支援成果物`               | `src/features/reader/ReaderPage.test.tsx`                                                                                       |            `S`             | `zipIndexCache.get` 待機中競合テストの前半（`TR-08` 終了確認後）で React ツリーを `unmount()` しなかったため、後半の `renderWithSession` による Zustand `session` 再設定時に前段ツリーが再起動して解決済みモック経由で `openArchive` を発火するテスト間干渉を検出。前段の明示 `unmountRace1()` 追加と履歴パス再設定で是正                                                                                                           |

---

## 3. 申し送り事項追跡一覧（Handover Items: `HO-xx`）

設計時や PR 作業中に「現在の PR スコープ外だが、後続の Sub-issue や IT、Android 実機確認で必ず検証・対応すべき事項」が発生した場合は、以下に `HO-01` より連番で登録し、完了ゲートまでに確実に消化します（※解決済みの `HO-01`, `HO-02` は [phase3-poc-log.md](archive/phase3-poc-log.md) へアーカイブ済み）。

|   ID    |    起票元 Issue / PR    | 申し送り事項の内容                                                                                                                                                                                                                                                                                                                                                                      | 解決先（対象 Issue / 成果物）                                                                                                                                                                          |       完了ゲート        | 状態 (`Open` / `Resolved`) |
| :-----: | :---------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------: | :------------------------: |
| `HO-03` | `#12 / PR #15 (親 #11)` | `readCompressedPageSlice` の `subarray` コピー削減、および `v0.1` `L2ByteCache` 導入時の `prepareDecodeTransfer` 共有キャッシュ非破壊（複製強制・所有権分離）対応                                                                                                                                                                                                                       | `v0.1`（`src/engine/zip/zipParser.ts`, `L2ByteCache`, `src/engine/workers/coordinatorTransfer.ts`）                                                                                                    | `Milestone v0.1 完了前` |           `Open`           |
| `HO-04` |          `#27`          | 固定署名キーストア（GitHub Secrets 4種）および共通単調増加 `versionCode`（`Math.floor(Date.now() / 1000) - 1_700_000_000`）導入後の Android 実機検証（旧ランダム署名 APK からの初回 1 回アンインストール後、`build-android.yml` 順次 2 回ビルドでデータ保持上書きアップデート・基本起動・Edge-to-Edge・Step Summary の大文字コロン区切り SHA-1 / SHA-256 フィンガープリント一致を確認） | `#27 / PR #29`（Run `#44838514377` `debug` `versionCode=95218038` → Run `#44838657095` `release` `versionCode=95218112` @ `83dc26a`：同一 SHA-1 `5A:CC:...` 一致・実機上書きアップデート全 4 項目 OK） |  `親 Issue #27 完了前`  |         `Resolved`         |
| `HO-05` |          `#19`          | Android SAF 上の CP932（Shift_JIS）日本語ファイル名アーカイブ自然順表示・ZIP64 アーカイブ閲覧・同一ローカルアーカイブ再オープン時の `zipIndexCache` 0RTT 動作の一括実機検証（`workflow.md §2.2` 区分 B 判定）                                                                                                                                                                           | `v0.1`（`src/engine/zip/zipParser.ts`, `src/storage/repositories/zipIndexCacheRepository.ts`, `src/features/reader/ReaderPage.tsx`）                                                                   | `Milestone v0.1 完了前` |           `Open`           |

---

## 4. ミニリリース Milestone 品質振り返りサマリー（定期追記）

各節目（Phase 3 PoC 完了時、および Phase 4 以降の各ミニリリース Milestone Step 3）に、バグ記録を集計して傾向分析とプロセス改善（Kaizen）アクションを記録します（詳細レポートは `docs/quality/reports/` 配下に格納）。

| フェーズ / Milestone                | 対象 Issue / PR                                                            |      製品規模 (`src/`)      |  検出欠陥 (製品 / 支援)   |  製品欠陥密度  |    完了時 DRE     | 最多原因・主要 Kaizen 施策                                                                                                                                                             | 詳細レポート                           |
| :---------------------------------- | :------------------------------------------------------------------------- | :-------------------------: | :-----------------------: | :------------: | :---------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------- |
| **Phase 3: Walking Skeleton (PoC)** | `#1`, `#3`〜`#6`, `#11`, `#12`〜`#14` (`PR #2`, `#7`〜`#10`, `#15`〜`#18`) | 4.13 KLOC（テスト比 2.24x） | 27 件 (製品 13 / 支援 14) | 3.14 件 / KLOC | 100%（流出 0 件） | 最多 `D` (48.1%) ＋ `B`/`S` (37.0%)。`*.worker.ts` 分岐禁止、React 19 親子 `useEffect`/`popstate` 分離、squash SHA＋`D`/`B` 分類基準明確化、`SCN-xx` 対応表への `pr-reviewer` 参照同期 | [phase3-poc.md](reports/phase3-poc.md) |
