---
name: android-apk-distribution
description: "Use when building, downloading, extracting, or distributing Android verification/release APKs via GitHub Actions (build-android.yml / release.yml) and Google Drive, or when staging manual device-test archives (test/fixtures/manual/). Enforces strict separation between app-debug.apk and app-release.apk."
---

# Android APK ビルド・Google Drive 分離配置・実機テストサンプル配布手順

ExLibris（`ex-libris`）における PC レス Android 実機検証用 APK（`debug`）と正式リリース用 APK（`release`）のクラウドビルド・展開・Google Drive 配置、ならびに手動実機検証用サンプルアーカイブ（[test/fixtures/manual/](../../../test/fixtures/manual/README.md)）の配布手順を定めます。

方針・完了ゲートの正本（SSOT）は [docs/guidelines/workflow.md](../../../docs/guidelines/workflow.md) です。

---

## 1. Google Drive 配置先とファイル分離契約（厳守）

Google Drive 上の共有フォルダ **`ExLibris`** 配下では、**開発検証用 APK（`debug`）** と **正式リリース用 APK（`release`）** を別ファイルとして厳格に分離します。**開発中の Debug ビルドで `app-release.apk` を上書きしてはなりません。**

| 区分                           | 用途・配置タイミング                                                                    | GitHub Actions 取得元                                                        | Google Drive ファイル名        | Google Drive ID                                       | 必須 MIME Type                            |
| :----------------------------- | :-------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- | :----------------------------- | :---------------------------------------------------- | :---------------------------------------- |
| **親フォルダ**                 | 全 APK・検証素材の格納先                                                                | -                                                                            | `ExLibris`                     | `1yVyPgaJohZGoDg4s90aTUFi_S_0g6Tt7`                   | `application/vnd.google-apps.folder`      |
| **開発検証用 (`Debug`)**       | 親 Issue Step 4（区分 A）・Milestone Step 2 等の `build-android.yml` (`debug`) 完了直後 | Run Artifact `ex-libris-debug-apk` (`debug/app-debug.apk`)                   | **`app-debug.apk`**            | `1HIS95V2PjNom_l9dvszkRsMap0P8bJp7`                   | `application/vnd.android.package-archive` |
| **正式リリース用 (`Release`)** | Milestone Step 3 / Hotfix マージによる `release.yml` 完了直後のみ                       | GitHub Release 添付 `ex-libris-vX.Y.Z.apk`（または `ex-libris-release-apk`） | **`app-release.apk`**          | `1sjKB10fchri1kuMu01Lbr5PJmw6ksS6L`                   | `application/vnd.android.package-archive` |
| **検証サンプル (`CBZ`)**       | 端末で境界検証用ファイルが必要な実機テスト（`ho07-max-texture-test.cbz` 等）            | [test/fixtures/manual/](../../../test/fixtures/manual/README.md)             | `ho07-max-texture-test.cbz` 等 | `16WuPKCikwmGPHKDZpbLc-jQNRlWSysj4`（同ファイル参照） | `application/vnd.comicbook+zip`           |

---

## 2. 事前安全ガード（認証・ID 取り違え防止）

Google Drive CLI（`gdrive`）の実行前には必ず以下を確認してください：

1. **認証確認**:
   `/opt/antigravity/plugins/gdrive/skills/gdrive/scripts/gdrive auth status` を実行し、`Logged in` を確認する（未ログイン・期限切れ時はユーザーへ再接続を依頼して停止）。
2. **読み取り先行＆ファイル名照合（誤上書き防止）**:
   `gdrive mutate update <FILE_ID> ...` を実行する直前に必ず `gdrive readonly info <FILE_ID> --json` で `name` と `parents` を確認する：
   - Debug ビルド時は対象 `name === "app-debug.apk"` であること（`app-release.apk` なら即中止）。
   - Release ビルド時は対象 `name === "app-release.apk"` であること（`app-debug.apk` なら即中止）。
3. **ID 不在・再作成フォールバック**:
   対象 ID が見つからない場合は `gdrive readonly ls 1yVyPgaJohZGoDg4s90aTUFi_S_0g6Tt7 --json` でフォルダ内を同名検索し、存在すればその ID を `mutate update` する。存在しない場合、`gdrive mutate upload` にはアップロード先ファイル名を指定するフラグがなくローカルファイル名がそのまま Drive 上のファイル名になるため、事前にローカルで契約ファイル名（`app-debug.apk` または `app-release.apk`）へコピー／リネームしてから `gdrive mutate upload <filepath> --parent 1yVyPgaJohZGoDg4s90aTUFi_S_0g6Tt7 --mime-type application/vnd.android.package-archive` で新規配置する。

---

## 3. 開発中 Debug APK の自動ビルド〜Drive 配置フロー（実機確認依頼前）

Step 4（区分 A 親 Issue 完了前）または Milestone Step 2 の実機確認依頼時は、以下の順序で自動実行します：

1. **クラウドビルド起動と完了待機**:
   ```sh
   gh workflow run build-android.yml --ref <target-branch> -f build_type=debug
   # 発行された <RUN_ID> を確認して待機
   gh run watch <RUN_ID> --exit-status
   ```
2. **Artifact ダウンロード・自動展開・Drive 上書き配置**:
   ```sh
   rm -rf /tmp/exlibris-apk && mkdir -p /tmp/exlibris-apk
   gh run download <RUN_ID> -n ex-libris-debug-apk -D /tmp/exlibris-apk
   # 誤上書き防止: name === "app-debug.apk" を確認後に更新
   gdrive readonly info 1HIS95V2PjNom_l9dvszkRsMap0P8bJp7 --json
   gdrive mutate update 1HIS95V2PjNom_l9dvszkRsMap0P8bJp7 /tmp/exlibris-apk/debug/app-debug.apk \
     --mime-type application/vnd.android.package-archive --json
   rm -rf /tmp/exlibris-apk
   ```
3. **検証サンプル（`test/fixtures/manual/`）の確認**:
   - 当該実機試験項目表に境界値（`MAX_TEXTURE_SIZE`・ZIP64・CP932 等）の検証が含まれる場合、リポジトリ内の [test/fixtures/manual/](../../../test/fixtures/manual/README.md) に既存テストアーカイブがあるか確認する（新規作成したテストアーカイブは必ず本ディレクトリと [scripts/generate-manual-test-archives.mjs](../../../scripts/generate-manual-test-archives.mjs) へ登録する）。
   - 必要に応じ同アーカイブも `ExLibris` フォルダへ配置（既存同名ファイルがあれば `mutate update`、なければ `--mime-type application/vnd.comicbook+zip` を指定して `mutate upload`）する。
4. **ブックマーク＆実機確認依頼の提示**:
   - 配置した Drive 上の `app-debug.apk`（および必要時の検証サンプル CBZ / Actions Run）を `UserFacing: true` の `.url.json` アーティファクトとして登録する。
   - **「Android 実機検証試験項目表（`HO-xx`）」** を提示し、対象 PR にも Run ID・Drive 配置 ID をコメント記録する。

---

## 4. 正式リリース APK の Drive 配置フロー（`release.yml` 完了後）

Milestone Step 3（`package.json` の `version` 更新）または Hotfix の `main` マージによって `.github/workflows/release.yml` が GitHub Release（`vX.Y.Z`）と署名済み APK（`ex-libris-vX.Y.Z.apk`）を発行した後、リリース用ファイルを同期します：

1. **Release Workflow 完了確認と APK 取得**:
   ```sh
   gh run list --workflow=release.yml --branch=main --limit=1
   gh run watch <RELEASE_RUN_ID> --exit-status
   rm -rf /tmp/exlibris-release && mkdir -p /tmp/exlibris-release
   gh release download "v<X.Y.Z>" -p "ex-libris-v*.apk" -D /tmp/exlibris-release
   cp /tmp/exlibris-release/ex-libris-v*.apk /tmp/exlibris-release/app-release.apk
   ```
2. **Drive `app-release.apk` へ上書き配置**:
   ```sh
   # 誤上書き防止: name === "app-release.apk" を確認後に更新（ID不在時も app-release.apk 名で upload 可）
   gdrive readonly info 1sjKB10fchri1kuMu01Lbr5PJmw6ksS6L --json
   gdrive mutate update 1sjKB10fchri1kuMu01Lbr5PJmw6ksS6L /tmp/exlibris-release/app-release.apk \
     --mime-type application/vnd.android.package-archive --json
   rm -rf /tmp/exlibris-release
   ```
3. **ブックマーク＆完了報告**:
   - GitHub Release および更新済み Google Drive `app-release.apk` の `.url.json`（`UserFacing: true`）を提示してリリース配置完了を報告する。
