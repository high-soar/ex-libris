---
type: spec-delta
title: "Issue #27 差分仕様: Android APK 上書き更新対応（固定署名キーストア・単調増加 versionCode・CI ガード）"
description: "GitHub Secrets による固定署名キーストア運用、不完全設定の早期エラー検知、ワークフロー横断の単調増加 versionCode、Release 署名必須ガード、および Step Summary フィンガープリント出力を定義する差分仕様"
status: "Completed (Archived)"
updated: "2026-11-20"
issue: "#27"
tags: [delta, v0.1, android, apk, signing, keystore, versioncode, ci, release]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/guidelines/workflow.md
  - docs/guidelines/testing.md
  - docs/quality/bug-and-handover-log.md
related_tests:
  - scripts/android-build-config.test.ts
  - src/shared/constants/app.test.ts
---

# Issue #27 差分仕様: Android APK 上書き更新対応

## 1. 背景・目的（Why）

- ExLibris の `applicationId`（`com.highsoar.exlibris`）は既に固定されているが、以下の 2 要因により実機端末上で検証用 APK・リリース APK 間のアンインストール不要（データ保持）上書きアップデートが成立しない状態だった：
  1. **署名の毎回変化**: `PUBLIC` リポジトリ保護のため `android/debug.keystore` を追跡除外しており、Secrets 未登録時は Gradle が一時デバッグ鍵（`~/.android/debug.keystore`）へフォールバックして CI ランナー VM ごとに異なる証明書で署名されていた。また `ANDROID_KEYSTORE_BASE64` 等の一部欠落や Base64 改行混入に対する厳密検証が不足していた。
  2. **`versionCode` の逆行リスク**: `.github/workflows/build-android.yml`（例: `run_number = 5`）と `.github/workflows/release.yml`（例: `run_number = 1`）が個別の `${{ github.run_number }}` を `BUILD_NUMBER` に使用しているため、ワークフロー間で `versionCode` が逆転し `INSTALL_FAILED_VERSION_DOWNGRADE` が発生し得る構造だった。
- Milestone `v0.1` の第 1 課題（`[v0.1][1/5]`）として固定署名キーストア（ユーザー登録済み GitHub Secrets 4 種）運用・不完全設定の早期検知・ワークフロー横断単調増加 `versionCode`・CI 署名ガード・Step Summary 可視化を確立し、以降の全検証 APK と `vX.Y.Z` リリース APK のシームレスな上書き更新および次期 `v0.2` Google OAuth（パッケージ名＋署名 SHA-1）基盤を固める。

### 1.1 Step 1 合意事項（Open Questions 確定内容）

1. **`build-android.yml` `debug` ビルド時の Secret 欠落**: `debug` ビルドでも `ANDROID_KEYSTORE_*` 4 種が欠落していれば即エラー停止する（上書き不能 APK の誤配布防止）。一方、`ci.yml`（`android-compile`）は引き続き Secret 不在のゼロコンフィグで `./gradlew assembleDebug` を通過させる。
2. **`android/app/build.gradle` の不完全設定検知**: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` のいずれか 1 つ以上が設定されている場合、**4 種すべてを必須**とし、欠落・空文字・Base64 デコード不正／空バイト時は即 `GradleException` で停止する。また Release タスク実行時に固定キーストアが存在しない場合もランダム鍵フォールバックを禁止し即停止する。
3. **共通 `versionCode` 計算式**: `build-android.yml`・`release.yml` 双方でオフセット付き 1 秒単位 Unix エポック **`Math.floor(Date.now() / 1000) - 1_700_000_000`**（例: 2026-11-20 時点で約 `95_188_000`）を採用し、1 秒粒度で連続実行時の衝突リスクを抑えつつ 2090 年頃まで Android / Play ストア 32bit 上限（`2_100_000_000`）内で単調増加させる。
4. **Step 2 承認後の進行構成**: 全変更が `workflow.md §4.1` の人間エスカレーション条件（`Gradle` / `.github/workflows/*.yml`）に該当し密結合のため、Step 2 設計 PR マージ後は **1 本の統合 PR（`Closes #27`、TDD Red-Green-Refactor コミット分離＋本差分仕様アーカイブ同梱）** で実装し、Gate 1〜6 後に 2 連続ビルドで実機上書き検証へ進む。

---

## 2. 変更対象の App 全体正本一覧

|   種別   | 正本ファイル                                                        | 変更概要                                                                                                                                             |
| :------: | :------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| **更新** | [architecture.md](../../architecture.md)                            | §6「Android ビルド・署名・バージョン管理・リリース自動化契約（`AC-APK-01`〜`05`）」を新設し、`related_specs` に `docs/guidelines/workflow.md` を追記 |
| **更新** | [requirements.md](../../requirements.md)                            | §2/`NFR-05` に固定署名上書き互換と PR CI ゼロコンフィグ分離を追記し、§5 `v0.1` 親 Issue 構成を 4 Issues → 5 Issues（`#27` 追加）へ同期               |
| **更新** | [bug-and-handover-log.md](../../../quality/bug-and-handover-log.md) | 実機検証申し送り事項 `HO-04`（完了ゲート: `親 Issue #27 完了前`）を新規登録                                                                          |

---

## 3. 追加・変更する仕様の差分サマリー（`AC-APK-01` 〜 `AC-APK-05`）

### 3.1 `android/app/build.gradle` の固定署名・不完全設定検証・`versionCode` 境界（`AC-APK-01`, `AC-APK-02`）

1. **Base64 安全デコードと 4 環境変数一貫性チェック（`hasEnvKeystore` とローカル鍵の厳格分離）**:
   - `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` の値を `trim()` 付きで読み取る。
   - 4 変数のうち 1 つ以上が非空の場合、**4 変数すべてが非空であることを検証**し、欠落時は不足変数名を明示した `GradleException` をスローして停止する（`'android'` / `'androiddebugkey'` への暗黙フォールバックを廃止）。
   - `ANDROID_KEYSTORE_BASE64` から全空白・改行（`\s+`）を除去した上で `Base64.getDecoder().decode(...)` で厳密デコードし、不正 Base64（`IllegalArgumentException`）または 0 バイト時に `GradleException` で即停止する。
   - 4 変数がすべて有効に揃った場合のみ `hasEnvKeystore = true` とし、デコード結果を `${layout.buildDirectory.get().asFile}/ci-signing.keystore` へ書き出して `signingConfigs.debug` / `signingConfigs.release` 双方へ同一キーストア・資格情報を設定する。
   - 上記 4 変数がすべて空であり、かつローカル開発端末上に `../debug.keystore` が存在する場合のみ、`signingConfigs.debug` へローカル開発用 `../debug.keystore` を適用する（**`../debug.keystore` は `signingConfigs.release` には一切使用しない**）。
2. **Release フォールバック禁止 ＆ `REQUIRE_FIXED_SIGNING` 強制ガード**:
   - `hasEnvKeystore == false` の場合、`buildTypes.release.signingConfig` を `signingConfigs.getByName("debug")` へフォールバックさせない（`null` とし、`signingConfigs.release` 自体を定義しない）。
   - `gradle.taskGraph.whenReady` において、①`REQUIRE_FIXED_SIGNING == "true"` が指定されているにもかかわらず `!hasEnvKeystore` の場合、または ②当該プロジェクトの Release 系ビルド/パッケージ/署名タスク（`assemble*Release`, `bundle*Release`, `package*Release`, `sign*Release` 等）がタスクグラフに含まれるにもかかわらず `!hasEnvKeystore` の場合は、ローカル `../debug.keystore` の有無にかかわらず即座に `GradleException` でビルドを停止する。
   - これにより `ci.yml`（`android-compile`）の正常系 `./gradlew assembleDebug`（`REQUIRE_FIXED_SIGNING` 未設定・Secret 不在）は引き続きゼロコンフィグで通過させつつ、Release ビルドや CI 配布ビルドでのランダム鍵／ローカルデバッグ鍵混入を完全に遮断する。
3. **`versionCode` 範囲検証**:
   - `BUILD_NUMBER`（環境変数優先）→ `-PversionCode`（Gradle プロパティ）→ `"1"` を整数パースし、非整数または `appVersionCode < 1 || appVersionCode > 2_100_000_000` の場合は `GradleException` で停止する。

### 3.2 GitHub Actions ワークフロー（`build-android.yml` / `release.yml` / `ci.yml`）の共通化とガード（`AC-APK-02` 〜 `AC-APK-05`）

1. **署名 Secrets 事前検証ステップ（Fail-Fast） ＆ 直列 `concurrency` 制御**:
   - `build-android.yml`（`debug` / `release` 双方）および `release.yml`（`steps.check_existing.outputs.exists == 'false'` 時）において、Web/Android ビルド前に専用ステップで 4 つの Secrets が非空かつ `ANDROID_KEYSTORE_BASE64`（空白/改行除去後）が有効な Base64（正規表現＋デコード非空）であることを検証し、不備時は即 `exit 1` で停止する（※Secret 値は一切ログ・Step Summary へ出力しない）。
   - 両ワークフローの Gradle 実行ステップでは `REQUIRE_FIXED_SIGNING: "true"` を注入して二重防御とする。
   - `build-android.yml` にも `release.yml` と同等の `concurrency`（`group: ${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: false`）を設定し、同一ブランチへの連続ディスパッチによる並列追い越し・`versionCode` 逆転を防止する。
2. **共通単調増加 `versionCode` ステップ**:
   - 両ワークフローのビルド直前に Node.js ワンライナーで `Math.floor(Date.now() / 1000) - 1_700_000_000` を算出し、ステップ出力 `version_code` 経由で `BUILD_NUMBER` 環境変数へ渡す（`run` ブロック内への `${{ ... }}` 直接展開禁止ルールを厳守）。
3. **Step Summary へのメタ情報・証明書フィンガープリント出力（抽出検証・書式統一）**:
   - APK 生成後に `${ANDROID_HOME:-$ANDROID_SDK_ROOT}/build-tools` 最新版の `apksigner` を探索し、**`apksigner` バイナリが見つからない場合のみ** `keytool -printcert -jarfile` へフォールバックする。`apksigner` が存在する場合は `apksigner verify --print-certs <apk>` を実行し、署名検証自体が失敗（終了コード非 0）した際はフォールバックせず即 `exit 1` で停止する。
   - 抽出した `SHA-1` および `SHA-256` フィンガープリントは、ツール差異（`apksigner` のコロンなし小文字 vs `keytool` のコロン区切り大文字）を吸収して **大文字コロン区切り 16 進表記（`AA:BB:CC:...`）** へ正規化する。いずれかが空抽出となった場合は即 `exit 1` で停止する。
   - `applicationId`（`com.highsoar.exlibris`）・`buildType`・`versionName`・`versionCode`・署名方式（`Fixed Keystore (GitHub Secrets)`）・正規化済み `SHA-1` / `SHA-256` を `GITHUB_STEP_SUMMARY` へ Markdown 表で記録する（`release.yml` の `ex-libris-${TAG}.apk` でも同様）。
4. **`ci.yml`（`android-compile`）でのゼロコンフィグ異常系 Gradle 検証**:
   - `ci.yml` の `android-compile` ジョブにおいて、現行の正常系 `./gradlew assembleDebug` に続けて Secrets 不要・ダミー入力のみの負系検証ステップを追加し、①4 変数一部欠落（`./gradlew help` 失敗）、②不正 Base64・空白のみ Base64（`./gradlew help` 失敗）、③`BUILD_NUMBER=0` / `2100000001` / `abc`（`./gradlew help` 失敗）、④`REQUIRE_FIXED_SIGNING=true` 無署名（`./gradlew help` 失敗）、⑤無署名 `./gradlew assembleRelease` 失敗をすべて CI ランタイム上で毎回機械検証する。

### 3.3 対象外スコープ

- キーストア本体・パスワード・エイリアスの Git リポジトリへのコミット（`PUBLIC` リポジトリのため厳禁、`.gitignore` 維持）。
- `applicationId`（`com.highsoar.exlibris`）の変更。
- Google Cloud Console への Android OAuth クライアント登録および `GoogleAuthBridge` 実装（Milestone `v0.2` `#23` にて、本 PR の Step Summary が出力する SHA-1 値を利用して実施）。

---

## 4. テスト計画（UT / Gradle 検証 / 実機検証）

| 層                                  | テスト手法・対象                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 合格基準                                                             |
| :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------- |
| **設定・契約 UT (`scripts/`)**      | `scripts/android-build-config.test.ts` を TDD（Red→Green→Refactor）で拡充：<br>1. `build.gradle`: 4 環境変数一貫性・`hasEnvKeystore` と `../debug.keystore` の分離・Base64 空白除去＋`Base64.getDecoder().decode`・Release フォールバック禁止・`REQUIRE_FIXED_SIGNING` / `taskGraph` ガード・`versionCode` 上下限境界<br>2. `build-android.yml` / `release.yml`: 4 Secrets Fail-Fast ガード・`concurrency`（`cancel-in-progress: false`）・`Math.floor(Date.now() / 1000) - 1_700_000_000` 式一致・`github.run_number` 非依存・`REQUIRE_FIXED_SIGNING: "true"`・`GITHUB_STEP_SUMMARY`（`apksigner` 失敗非フォールバック・大文字コロン区切り SHA-1/SHA-256 正規化・空抽出停止・Secret 非漏洩）・`run` 内 `${{ }}` 直接展開禁止<br>3. `ci.yml`: `android-compile` が Secret 非依存 `./gradlew assembleDebug` 維持＋ゼロコンフィグ異常系 Gradle 検証ステップを含むこと | `npm run test:coverage` 全件 PASS（C0/C1/Functions/Lines 100% 維持） |
| **Gradle 構文・境界実行検証**       | GitHub Actions `ci.yml`（`android-compile`）上で ①Secret 不在 `./gradlew assembleDebug` 正常系、および ②ダミー値による全異常系・境界ガード（4 変数不整合・不正/空 Base64・`BUILD_NUMBER` 範囲外/非整数・`REQUIRE_FIXED_SIGNING=true` 無署名・無署名 `assembleRelease` の非 0 終了）を毎回実行検証する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `quality-gate` 全 4 ジョブ PASS                                      |
| **クラウド APK 実機検証 (`HO-04`)** | Step 4 統合 PR の Gate 1〜6 通過後、対象ブランチに対して `build-android.yml` を順次 2 回（①`debug` 完了後に ②`release` を起動）実行し、Step Summary フィンガープリント一致と実機上書き更新を確認                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 初回 1 回アンインストール後、2 回目 APK のデータ保持上書き成功       |

---

## 5. 実装・IT・実機検証 進行計画（統合 PR 方針）

- Step 1 合意に基づき、本 Issue の全変更ファイル（`android/app/build.gradle`, `.github/workflows/{build-android,release,ci}.yml`, `scripts/android-build-config.test.ts`）が密結合かつ `workflow.md §4.1` の人間エスカレーション対象であるため、本設計 PR マージ後は以下の **1 本の統合 PR（`Closes #27`）** で進行する：
  1. **Red コミット (`test(android,ci): ...（Red）`)**: `scripts/android-build-config.test.ts` へ固定署名・`hasEnvKeystore` 分離・不完全設定検知・単調増加 `versionCode`・Release ガード・`ci.yml` 負系検証・Step Summary 検証テストを先行追加し、未実装による失敗を確認。
  2. **Green コミット (`build(android,ci): ...（Green）`)**: `android/app/build.gradle`, `.github/workflows/build-android.yml`, `.github/workflows/release.yml`, `.github/workflows/ci.yml` を最小実装し、ローカル全 UT ＋ CI `quality-gate`（`android-compile` 異常系検証含む）PASS を確認。
  3. **Refactor / アーカイブ コミット (`refactor` / `docs(specs): ...`)**: 構造整理および本差分仕様書の `Completed (Archived)` 化・`docs/specs/changes/archive/issue-27-android-apk-upgrade.md` への `git mv`。
  4. **Gate 1〜6 完了後**: 対象ブランチで `build-android.yml` を順次 2 回（1 本目 `debug` 完了確認後に 2 本目 `release` を起動、`concurrency` により直列保証）実行し、両ビルドの Step Summary の大文字コロン区切り SHA-1 / SHA-256 一致・`versionCode` 単調増加を確認した上で、APK Artifact URL と「Android 実機検証試験項目表（`HO-04`）」を提示し、実機検証 OK 後の人間マージで親 Issue `#27` をクローズする。

---

## 6. 申し送り事項・Android 実機検証計画

- **判定（[workflow.md §2.2](../../../guidelines/workflow.md#22-android-実機検証の実施判断基準と試験項目表フォーマット)）**: **区分 A（親 Issue `#27` 完了前に実施）**
  - **根拠**: Android Gradle ビルド・署名設定（`android/app/build.gradle`）の変更を含み、かつ実機端末上で異なるビルド種別・2 連続ビルド間の上書きインストール互換性（データ保持・`versionCode` 昇順・証明書一致）と起動・Edge-to-Edge 正常性を直接検証する必要があるため（実機観点 4 項目）。
- **登録済み申し送り**: `HO-04`（[bug-and-handover-log.md](../../../quality/bug-and-handover-log.md) 登録済み、状態: `Open`、完了ゲート: `親 Issue #27 完了前`）
- **実機確認観点（統合 PR Gate 1〜6 通過後に `build-android.yml` 2 ビルドを提示）**:
  1. **初回移行インストール**: Phase 3 PoC の旧ランダム署名 APK が端末にある場合のみ 1 回アンインストールし、固定署名ビルド 1 本目（`debug` APK）を新規インストールして正常起動・バージョン表示（`v0.0.0`）・Edge-to-Edge 表示を確認する。
  2. **2 本目ビルドへの上書きアップデート（アンインストール不要）**: 1 本目を削除せず（可能ならローカル ZIP 一時利用やアプリ起動状態を確認の上）に、2 本目のビルド（例: `build-android.yml` の `release` APK または 2 回目 `debug` APK）を上書きインストールし、「アプリがインストールされませんでした（署名不一致／ダウングレード拒否）」にならず更新完了すること。
  3. **上書き後の起動・基本スモーク**: 上書き更新後のアプリを起動し、クラッシュせず `SCR-01` 表示・ローカル ZIP 選択起動・診断ログコピーが正常動作すること。
  4. **Step Summary フィンガープリント ＆ `versionCode` 照合**: GitHub Actions の 1 本目・2 本目双方の Job Summary で `applicationId` が `com.highsoar.exlibris`、`versionCode` が 2 本目 ＞ 1 本目（約 `95,xxx,xxx`）、署名証明書 `SHA-1` / `SHA-256` が完全一致し、Secret 値が非出力であることを確認する（記録した SHA-1 は `v0.2` `#23` Google OAuth 登録で参照）。
