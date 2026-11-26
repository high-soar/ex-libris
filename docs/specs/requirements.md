---
type: spec-requirements
title: "全体要件定義・機能一覧・ミニMilestoneロードマップ"
description: "ExLibris のプロダクトゴール、前提制約、非機能要件（TTFP・メモリ予算）、全機能カタログ割当、および Phase 3〜v1.0 マイルストーン計画の正本"
status: "Review (#25)"
updated: "2026-11-25"
tags: [requirements, roadmap, mvp, non-functional, ex-libris, android]
related_specs:
  - docs/index.md
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/zip-streaming.md
  - docs/specs/engine/webgl2-renderer.md
  - docs/specs/features/bookshelf.md
  - docs/specs/features/series-detail.md
  - docs/specs/features/reader.md
  - docs/specs/features/settings.md
  - docs/specs/providers/google-drive.md
  - docs/specs/providers/filename-parser.md
  - docs/guidelines/workflow.md
  - docs/guidelines/testing.md
related_tests:
  - scripts/android-build-config.test.ts
  - scripts/generate-manual-test-archives.test.ts
  - src/shared/constants/app.test.ts
  - src/App.test.tsx
  - src/diagnostics/diagnosticLogger.test.ts
  - src/engine/zip/zipParser.test.ts
  - src/engine/workers/CoordinatorCore.test.ts
  - src/providers/filename/mangaFilenameParser.test.ts
  - src/providers/gdrive/driveSyncEngine.test.ts
  - src/storage/repositories/readingProgressRepository.test.ts
  - src/storage/repositories/readerSettingsRepository.test.ts
  - src/webgl/l1PageCache.test.ts
  - src/webgl/shaderParams.test.ts
  - src/webgl/WebGLRendererCore.test.ts
  - src/features/bookshelf/BookshelfPage.test.tsx
  - src/features/bookshelf/RecentLocalHistorySection.test.tsx
  - src/features/reader/ReaderHudOverlay.test.tsx
  - src/features/reader/ReaderShaderSheet.test.tsx
  - src/features/reader/ReaderPage.test.tsx
  - src/features/series-detail/SeriesDetailPage.test.tsx
  - src/features/settings/SettingsPage.test.tsx
  - test/vrt/vrt.spec.ts
  - test/it/smoke.spec.ts
  - test/it/local-reader.spec.ts
  - test/it/settings-oauth.spec.ts
  - test/it/drive-sync.spec.ts
  - test/it/bookshelf-drive-reader.spec.ts
---

# ExLibris 全体要件定義・機能一覧・ミニMilestoneロードマップ

本ドキュメントは、Android / Web 向け超高速ストリーミング自炊マンガビューア＆仮想本棚アプリ **「ExLibris (`ex-libris`)」** における全体要件定義・スコープ境界・非機能基準・およびマイルストーン計画の正本（Single Source of Truth）です。

---

## 1. プロダクトビジョンと3大ゴール

1. **ゼロ待ち超高速ストリーミング（Time to First Page < 1.0s）**:
   Google Drive API（HTTP `Range` リクエスト）および端末ローカルファイルに特化し、100MB〜数GB規模（4GB超 ZIP64 含む）の自炊 ZIP/CBZ アーカイブでも事前ダウンロード待ちゼロで1ページ目を開く。
2. **物理フォルダ構造から完全に独立した「仮想本棚」**:
   Google Drive 上のディレクトリ階層とアプリ内の蔵書構造を完全に分離し、公開書誌 API（NDLサーチ / AniList / Google Books）とローカル DB（Dexie.js）により 10ms 台の多軸検索・シリーズ束ね・正確な五十音ソートを実現する。
3. **AI駆動開発（TDD）によるマルチスレッド＆生 WebGL2 実装**:
   Web Workers（Coordinator Worker + Decode Worker Pool x2）、Comlink + Transferable Objects（Zero-Copy）、L1/L2 2段階キャッシュ、および生 WebGL2 シェーダー（Mipmap モアレ除去＋自炊紙面補正）を C0/C1/Functions/Lines 100% 単体テストと VRT で堅牢に構築する。

---

## 2. ターゲット環境・前提条件・スコープ境界

| 項目                       | 合意仕様・スコープ境界                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **メインターゲット端末**   | Android タブレット・スマートフォン（Capacitor アプリ `com.highsoar.exlibris`）および開発・検証用モダン Web ブラウザ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **対応アーカイブ形式**     | **ZIP / CBZ 専用**（RAR/CBR、PDF は対象外）。4GB超 **ZIP64**、**Shift_JIS（CP932）** ファイル名、`__MACOSX` / `._*` / `Thumbs.db` 等の不要エントリ自動除外、自然順ソートに対応。合本 ZIP 内のサブフォルダ境界によるチャプター分割は行わず、フラットな論理ページ列として扱う                                                                                                                                                                                                                                                                                                                                                     |
| **対応画像形式**           | JPEG / PNG / WebP / AVIF（高解像度スキャン 3000×4200px 単ページ〜6000px 級見開き画像を想定）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **描画エンジン・読み方向** | ページめくりリーダー（`SCR-03`）は Canvas 2D・`<img>` タグ不使用で初期から **生 WebGL2**（ハードウェア Mipmap ＋ 自炊補正フラグメントシェーダー）で実装（本棚 `SCR-01` / `SCR-02` の軽量表紙 WebP サムネイルのみ `coverBlob` `ObjectURL` ＋厳格 `revokeObjectURL` を使用）。読み方向は **「右開き（標準）＋ 左開き」のページめくり型（単ページ／2ページ見開き）** に特化し、縦スクロール読み（Webtoon 型）は `v1.0` スコープ外（`v1.1+` 将来候補）とする                                                                                                                                                                        |
| **対象ストレージ境界**     | **① Google Drive**：設定画面（`SCR-04`）で登録した「マンガ保管ルートフォルダ（複数指定可）」配下（サブフォルダ含む）の `.zip` / `.cbz` のみを同期対象とし、無関係な業務・バックアップ ZIP の混入を防ぐ。<br>**② 端末ローカル ZIP**：仮想本棚（`series` / `volumes`）を汚さない「一時セッション閲覧」として直接リーダーで開き、目次キャッシュ（`zipIndexCache`）と読書進捗（`readingProgress`）のみファイル名＋サイズ識別子で永続保持して再オープン時のレジュームを可能にする。<br>※自宅 HTTP Range サーバー登録および OPFS L2 永続化・オフライン持ち出しは `v1.1+` 候補とする（ただし `RandomAccessReader` 抽象契約は維持する） |
| **公開書誌 API 境界**      | キー登録不要の **`NDLサーチ`（国内書誌・読み仮名）＋ `AniList`（ジャンルタグ・連載状況・既刊巻数）** を主軸とし、**`Google Books`（あらすじ補完）** までを `v0.3` 対象とする（アプリ ID 必須の楽天ブックスは `v1.1+` 任意拡張）                                                                                                                                                                                                                                                                                                                                                                                                 |
| **UI テーマ・シェル構成**  | **ダークテーマ標準**（表紙と紙面が映える暗色基調）。下部タブバーは置かず、`SCR-01`（仮想本棚）のヘッダー導線と `SCR-03`（完全フルスクリーンリーダー：中央タップでオーバーレイ開閉）によるシンプル構成とする                                                                                                                                                                                                                                                                                                                                                                                                                     |

---

## 3. 非機能要件・システムリソース基準（`NFR-xx`）

|   要件 ID    | カテゴリ                                              | 基準値・必須振る舞い                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :----------: | :---------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`NFR-01`** | **初速性能（TTFP）**                                  | 標準的な単行本 ZIP に対し、Google Drive 初回オープン時（末尾 128KB CD 取得 1 RTT ＋ Fast-Path 1 RTT）で **1.0 秒未満**、2回目以降（`zipIndexCache` ヒットによる CD 取得 0 RTT 時）で **0.5 秒未満**（ローカル ZIP は **0.2 秒未満**）で1ページ目を描画開始すること。（検証分担: `v0.1` ではローカル `< 0.2s` 目標を `SCN-02` TTFP 計測・健全性確認および `HO-05`/`HO-06` 実機診断ログタイムスタンプで追跡し、Google Drive ストリーミング `< 1.0s` / `< 0.5s` は `v0.2` 以降で計測する）                                                                                                                                                     |
| **`NFR-02`** | **L1 / L2 メモリ・VRAM 予算**                         | ・**L1 キャッシュ（UI/GPU `ImageBitmap`）**：最大 **5 ページ**（現在表示 1〜2 枚 ＋ 進行方向 2 枚 ＋ 逆方向 1 枚）。ウィンドウ外に出た瞬間・シーク世代更新時・リーダー終了時に必ず `bitmap.close()` を呼び出し、Android WebView の VRAM OOM を防止する。<br>・**L2 キャッシュ（Worker 圧縮 `Uint8Array`）**：上限 **80MB**（LRU 退避。単一ページで 80MB を超える例外画像のみ現在表示中の一時保持を許容）。<br>・**Warm Prefetch 予算**：Fast-Path 完了後、1 リクエストあたり上限 **10MB**、かつ物理オフセット昇順でギャップ **64KB** 以内のエントリのみ結合取得する。                                                                       |
| **`NFR-03`** | **ローカル本棚検索応答性**                            | 5,000 冊規模の蔵書データに対し、本棚一覧表示・五十音ソート・タグ/コレクション絞り込み・インクリメンタル検索がネットワーク通信ゼロ（100% IndexedDB 完結）かつ **50ms 以内（目標 10ms 台）** で応答すること。                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **`NFR-04`** | **API レート制限回避・閲覧優先制御**                  | バックグラウンド表紙 WebP 抽出は「ビューポート内即時優先 ＋ 画面外は最大 **2 冊/秒** の低速キュー」で実行し、リーダー（`SCR-03`）起動中および Fast-Path 通信中はバックグラウンド表紙抽出を即座に一時停止（プリエンプション）して 403 Rate Limit と帯域競合を防ぐこと。                                                                                                                                                                                                                                                                                                                                                                      |
| **`NFR-05`** | **ゼロコンフィグ動作・PCレス実機診断・APK上書き互換** | 外部認証情報（`.env.local` や Google OAuth、Android 署名 Secrets）が未設定の PR / ローカル開発環境でも全ビルド・単体テスト・Storybook VRT・Playwright IT・`ci.yml` (`android-compile`) が 100% PASS すること。一方、配布 APK ビルド（`build-android.yml` / `release.yml`）は固定署名キーストアと共通単調増加 `versionCode`（[architecture.md §6](architecture.md#6-android-ビルド署名バージョン管理リリース自動化契約ac-apk-0105)）によりアンインストール不要の上書き更新を保証すること。また実機トラブル時は `Bearer` トークンや API キーを自動マスク（`[REDACTED]`）したオンメモリ診断ログを 1 タップでクリップボードへコピーできること。 |

---

## 4. 全機能カタログとマイルストーン割当マトリクス

個別機能の詳細な受け入れ条件（`AC-xx`）は、各親 Issue 着手時（Step 2 設計更新 PR）に対象ドメインの正本仕様書（`docs/specs/architecture.md`［`AC-APK-*`］, `docs/specs/engine/*.md`, `features/*.md`, `providers/*.md`）へ Just-in-Time に定義します。

| 領域                       | 機能項目                                                                                                      |        割当先        | 備考                                                                                                     |
| :------------------------- | :------------------------------------------------------------------------------------------------------------ | :------------------: | :------------------------------------------------------------------------------------------------------- |
| **A. 仮想本棚・整理**      | シリーズ自動グルーピング（単巻＋合本混在）                                                                    |      **`v0.2`**      | 初回はファイル名パーサー由来で自動束ね（MVP ではフラットグリッド表示）                                   |
|                            | 基本ソート（最終読書順・追加順・タイトル基本順・巻数順）                                                      |      **`v0.2`**      | 初期値は最終読書順（未読は後ろで追加順）、オンメモリ保持                                                 |
|                            | 読み仮名を用いた正確な五十音ソート・発売日/作者ソート                                                         |      **`v0.3`**      | NDL 読み仮名データと連携                                                                                 |
|                            | インクリメンタル複合検索（タイトル・読み・作者・タグ・状態）                                                  |      **`v0.3`**      | ローカル IndexedDB 完結                                                                                  |
|                            | カスタムコレクション（自由タグ多対多）                                                                        |      **`v0.3`**      |                                                                                                          |
|                            | スマートコレクション（複合検索条件の仮想棚ピン留め）                                                          |      **`v0.3`**      |                                                                                                          |
|                            | 大量蔵書（1,000シリーズ級）向け本棚アクセス UX（五十音インデックスジャンプ・作者/レーベル別表示切替・仮想化） |      **`v0.3`**      | `v0.2` フラットグリッドからの発展として `v0.3` 設計時に詳細検討・実装                                    |
|                            | 欠巻・未所持新刊チェッカー                                                                                    |      **`v1.0`**      | 公開書誌の既刊巻数とローカル所持巻を照合                                                                 |
|                            | 重複アーカイブ検出（MD5・ファイル名・巻数）                                                                   |      **`v1.0`**      |                                                                                                          |
| **B. 書誌・表紙管理**      | 自炊ファイル名スマートパーサー（`[作者] 作品名 第01巻` 等）                                                   |      **`v0.2`**      |                                                                                                          |
|                            | ビューポート優先＋低速キューによる表紙 WebP 自動抽出                                                          |      **`v0.2`**      | 長辺約 350px WebP（約 15〜25KB/冊）                                                                      |
|                            | 公開書誌 API 連携（NDLサーチ / AniList / Google Books）                                                       |      **`v0.3`**      | `MetadataHttpClient` 経由で CORS 回避                                                                    |
|                            | 書誌候補再検索・手動編集・フィールドロック UI                                                                 |      **`v0.3`**      |                                                                                                          |
|                            | 見開きカバー半裁クロップ＆表紙ページ番号変更（2〜3P指定）                                                     |      **`v0.4`**      |                                                                                                          |
|                            | 楽天ブックス書籍検索 API 追加連携                                                                             |       `v1.1+`        | アプリ ID 必須のため任意将来拡張                                                                         |
| **C. ストリーミング・I/O** | 端末ローカル ZIP/CBZ 一時セッション閲覧（`LocalFileReader`）                                                  |    **`Phase 3`**     | Phase 3 はオンメモリ（常に先頭開き）、目次・進捗永続化は `v0.1`                                          |
|                            | ZIP64 / Shift_JIS (CP932) / ゴミ除外 / 自然順ソート / LFH 1RTT 切り出し / 物理ギャップ分割                    |      **`v0.1`**      | 標準 ZIP 最小解析は `Phase 3` で先行実装                                                                 |
|                            | Fast-Path 初速取得 ＋ 10MB バイト予算先読み ＋ L1(5P)/L2(80MB) キャッシュ                                     |      **`v0.1`**      | `L1(5P)` 最小窓先読み・`bitmap.close()` 解放は `Phase 3` で先行実装、10MB 先読み結合・L2(80MB) は `v0.1` |
|                            | Google OAuth ネイティブ認証 ＋ Single-Flight 透過リフレッシュ                                                 |      **`v0.2`**      |                                                                                                          |
|                            | Google Drive Range ストリーミング ＋ `ZipIndexCache`（2回目 0 RTT）                                           |      **`v0.2`**      |                                                                                                          |
|                            | 指定ルートフォルダ配下の Drive フルスキャン ＆ `changes.list` 差分同期                                        |      **`v0.2`**      |                                                                                                          |
|                            | 自宅サーバー HTTP Range ハイブリッド登録（`HttpRangeReader`）                                                 |       `v1.1+`        | `RandomAccessReader` 抽象のみ Phase 2 で維持                                                             |
|                            | OPFS による L2 キャッシュ永続化＆一時オフライン持ち出し                                                       |       `v1.1+`        | 初期スコープ外                                                                                           |
| **D. WebGL2・画質補正**    | 生 WebGL2 単ページ描画 ＋ ハードウェア Mipmap（モアレ除去）                                                   |    **`Phase 3`**     | Canvas 2D 不使用                                                                                         |
|                            | `MAX_TEXTURE_SIZE` 上限検知・分割/縮小ガード                                                                  |      **`v0.1`**      | 4096px 上限端末の黒画面防止                                                                              |
|                            | シャープネス（画面微分 5タップ USM）＋ 白黒レベル・ガンマ補正シェーダー                                       |      **`v0.1`**      | 全作品共通デフォルト補正                                                                                 |
|                            | インテリジェント見開き制御 ＆「1ページずらし」ワンタップ補正                                                  |      **`v0.1`**      | 横長スキャン画像の単枚自動表示含む                                                                       |
|                            | 右開き／左開き切替                                                                                            |      **`v0.1`**      |                                                                                                          |
|                            | 作品別シェーダー・綴じ方向プリセット保存                                                                      |      **`v0.4`**      |                                                                                                          |
|                            | 余白自動トリミング（オートクロップ）                                                                          |      **`v0.4`**      |                                                                                                          |
|                            | 縦スクロール読み（Webtoon 型）                                                                                |       `v1.1+`        | `v1.0` スコープ外                                                                                        |
| **E. リーダー操作 UX**     | 基本ページめくり（タップ・スワイプ）＋ 基本シークバー                                                         |      **`v0.1`**      | 最小前後ページ移動は `Phase 3` で先行実装                                                                |
|                            | ピンチズーム・ダブルタップ拡大 / 長押しルーペ                                                                 |      **`v0.4`**      |                                                                                                          |
|                            | タップ領域カスタマイズ                                                                                        |      **`v0.4`**      |                                                                                                          |
|                            | Android 音量ボタン・Bluetooth リモコンキーバインド対応                                                        |      **`v0.4`**      | Java `VolumeKeyPlugin` 導入                                                                              |
|                            | サムネイル付き高速シークバー ＆ ジャンプ元復帰（Undo Jump）                                                   |      **`v0.4`**      |                                                                                                          |
|                            | 連続巻またぎ読書（最終ページから次巻シームレス遷移）                                                          |      **`v0.4`**      |                                                                                                          |
| **F. 記録・端末間同期**    | アプリ内リングバッファ診断ログ＆1タップコピー（機密マスク付）                                                 | **完了 (`Phase 1`)** | 各フェーズで記録スコープを順次拡充                                                                       |
|                            | 自動レジューム・未読/読書中/読了ステータス管理                                                                |      **`v0.1`**      | `v0.1` はローカル識別子 `local:*` 実装、Drive 巻 `vol:*` は DB スキーマ先行定義の上 `v0.2` で有効化      |
|                            | 一言メモ付きしおり（複数ページブックマーク）                                                                  |      **`v0.4`**      |                                                                                                          |
|                            | Google Drive `appDataFolder` 自動バックアップ＆複数端末 LWW 同期                                              |      **`v1.0`**      |                                                                                                          |
|                            | 読書統計グラフビュー（月間読了数・作家/レーベル集計）                                                         |       `v1.1+`        | `v1.0` スコープ外                                                                                        |

---

## 5. マイルストーンロードマップ（`Phase 1` 〜 `v1.0` / `v1.1+`）

各ミニリリース Milestone（`v0.1`〜`v1.0`）は 3〜5 件の親 Issue で構成し、[workflow.md §5](../guidelines/workflow.md#5-ミニリリース-milestone-と品質改善kaizenループ) の 3 段階ゲート（横断レビュー → 是正＆クラウド APK 実機検証 → Kaizen・アーカイブ・`vX.Y.0` リリース自動発行）を経て完了します。

| フェーズ / Milestone                                          | 到達ゴール（ユーザー価値・検証目標）                                                                                                                                                                                                                       | 想定親 Issue 構成（目安）                                                                                                                                                          |     状態      |
| :------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-----------: |
| **Phase 1: AI開発基盤構築**                                   | Antigravity Remote Agent 基盤、OKF 検証、Vitest (100%) / Storybook VRT / Playwright IT / Capacitor Android / CI `quality-gate`・クラウド APK ビルドの稼働確立                                                                                              | 初期基盤構築                                                                                                                                                                       | **Completed** |
| **Phase 2: コア仕様策定**                                     | 背骨 4 冊（`requirements` / `architecture` / `db-schema` / `screen-transitions`）の契約確定と `Approved (Phase 2)` 合意                                                                                                                                    | コア仕様 4 冊策定                                                                                                                                                                  | **Completed** |
| **Phase 3: Walking Skeleton (PoC)**                           | ローカル ZIP 一時オープン → Worker 解凍・Zero-Copy 転送 → 生 WebGL2 単ページ Mipmap 描画＋前後めくり＋L1 `bitmap.close()` 解放の垂直スライス実証（Issue/PR/Gate7 通し検証）                                                                                | 1 Issue（PoC 垂直スライス）                                                                                                                                                        | **Completed** |
| **`v0.1`: 完成版コアリーダーエンジン**                        | 固定署名＆単調増加 `versionCode` による APK 上書き更新基盤の上で、4GB超 ZIP64・CP932・高解像度画像を Fast-Path＋10MB先読み、L1(5P)/L2(80MB) キャッシュ、見開き・1ページずらし、白黒レベル/シャープネス補正、シークバー＆自動レジューム付きで完読可能にする | 5 Issues（①Android APK 上書き更新対応、②ZIP64/CP932/`zipIndexCache`、③先読み/L2/Epoch、④見開き/`MAX_TEXTURE_SIZE`、⑤自炊シェーダー/基本UI/レジューム）＋ 完了承認 `#66` (`v0.1.0`) | **Completed** |
| **`v0.2`: Google Drive 連携 ＆ 最小仮想本棚（日常実用 MVP）** | Google OAuth 認証、指定ルートフォルダ配下のフルスキャン＆`changes` 差分同期、ファイル名パーサーによるシリーズ本棚 UI、2段優先度表紙 WebP 抽出により Google Drive 上での日常読書を開始可能にする                                                            | 4 Issues（①OAuth/DriveReader、②指定フォルダ同期/パーサー/目次キャッシュ、③本棚・シリーズ詳細・設定UI、④表紙WebP抽出キュー＆プリエンプション）                                      |    Planned    |
| **`v0.3`: 公開書誌 API ＆ 高機能検索・棚整理**                | `CapacitorHttp` 経由で NDLサーチ / AniList / Google Books から書誌を取得・再選択でき、正確な五十音ソート・10ms 台の複合検索・カスタム/スマートコレクション・1,000シリーズ規模の本棚アクセス UX（インデックスジャンプ・軸別表示・仮想化等）を実現する       | 4 Issues（①書誌3種クライアント、②名寄せ＆候補再選択・編集ロックUI、③五十音ソート＆複合検索、④カスタム/スマートコレクション＆大規模本棚UX）                                         |    Planned    |
| **`v0.4`: 自炊リーダー UX 完成**                              | オートクロップ、作品別プリセット、見開きカバー半裁、ピンチ/ダブルタップ/ルーペ拡大、タップ領域変更、音量キー/リモコンめくり、サムネイル付きシーク＆Undo Jump、次巻連続遷移、メモ付きしおりを完備する                                                       | 4 Issues（①オートクロップ/作品別プリセット、②表紙半裁/表紙ページ変更、③拡大操作/タップ領域/音量キー、④サムネイルシーク/Undo/次巻遷移/しおり）                                      |    Planned    |
| **`v1.0`: 複数端末同期 ＆ 蔵書健全性チェック（正式版）**      | Google Drive `appDataFolder` を用いた複数端末 LWW 自動同期（進捗・書誌・コレクション・設定）および欠巻・未所持新刊・重複アーカイブ検出を備え、最初の正式リリース（`v1.0.0`）へ到達する                                                                     | 3 Issues（①`appDataFolder` バックアップ・復元基盤、②複数端末 LWW マージ同期、③欠巻・新刊・重複アーカイブ検出）                                                                     |    Planned    |
| **`v1.1+`: 将来拡張バックログ**                               | 自宅 HTTP Range サーバー登録、OPFS オフライン持ち出し、楽天ブックス連携、読書統計グラフビュー、縦スクロール読み等を必要に応じて選択実装する                                                                                                                | 随時起票                                                                                                                                                                           |    Backlog    |
