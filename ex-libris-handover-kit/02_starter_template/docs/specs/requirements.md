---
type: spec-requirements
title: "全体要件定義・機能一覧・ミニMilestoneロードマップ"
description: "ExLibris のプロジェクト目的、前提条件、機能カタログ、および Phase 2 で確定する MVP・マイルストーン計画の正本骨格"
status: Draft
updated: "2026-11-18"
tags: [requirements, roadmap, mvp, ex-libris]
related_specs:
  - docs/specs/architecture.md
  - docs/specs/db-schema.md
  - docs/specs/screen-transitions.md
  - docs/guidelines/workflow.md
related_tests: []
---

# ExLibris 全体要件定義・機能一覧・ミニMilestoneロードマップ

> [!NOTE]
> **Phase 2（コア仕様策定フェーズ）向け初期骨格（`Draft`）**:
> 本ドキュメントは `ex_libris_concept.md` をベースに作成した Phase 2 開始用の初期骨格です。`ex-libris` リポジトリ立ち上げ後の Phase 2 において、MVP スコープ・優先度・ミニリリース Milestone 計画をユーザーと対話して確定し、`Approved (Phase 2)` へ昇格させます。

---

## 1. プロダクトビジョンと3大ゴール

1. **ゼロ待ち超高速ストリーミング（Time to First Page < 1.0s）**:
   Google Drive API（HTTP `Range` リクエスト）および HTTP 配信サーバーに特化し、100MB〜数GB規模（4GB超 ZIP64 含む）の ZIP/CBZ アーカイブでも事前ダウンロード待ちゼロで1ページ目を開く。
2. **物理フォルダ構造から完全に独立した「仮想本棚」**:
   Google Drive 上のディレクトリ階層とアプリ内の蔵書構造を分離し、公開書誌 API（NDLサーチ / Google Books / 楽天ブックス / AniList）とローカル DB（Dexie.js）により 0.01 秒の多軸検索・シリーズ束ね・五十音ソートを実現する。
3. **AI駆動開発（TDD）によるマルチスレッド＆生 WebGL2 実装**:
   Web Workers（Coordinator + Decode Pool）、Comlink + Transferable Objects（Zero-Copy）、L1/L2 2段階キャッシュ、および生 WebGL2 シェーダー（Mipmap モアレ除去＋自炊紙面補正）を 100% 単体テストカバレッジと VRT で堅牢に構築する。

---

## 2. ターゲット環境・前提条件・スコープ境界

| 項目 | 合意事項・制約 |
| :--- | :--- |
| **メインターゲット端末** | Android タブレット・スマートフォン（Capacitor アプリ）および開発検証用モダン Web ブラウザ |
| **対応アーカイブ形式** | **ZIP / CBZ 専用**（RAR/CBR、PDF は対象外）。4GB超 **ZIP64**、**Shift_JIS（CP932）** ファイル名、`__MACOSX` 等の不要エントリ混在に対応 |
| **対応画像形式** | JPEG / PNG / WebP / AVIF（高解像度スキャン 3000×4200px〜見開き 6000px 級を想定） |
| **描画エンジン** | Canvas 2D・`<img>` タグ不使用。初期から **生 WebGL2**（ハードウェア Mipmap ＋ 自炊補正フラグメントシェーダー）で実装 |
| **初期割り切り事項** | ① OPFS による L2 キャッシュ永続化は初期スコープ外（オンメモリ LRU L2 キャッシュを採用）<br>② 合本 ZIP 内のサブフォルダ境界による巻・チャプター分割は行わず、自然順ソートされたフラットなページ列として扱う |

---

## 3. 機能カタログ概要（Phase 2 で優先度・Milestone 割当を確定）

### 3.1 機能領域一覧

- **領域 A：仮想本棚・蔵書オーガナイズ**
  - シリーズ自動グルーピング、読み仮名を用いた正確な五十音ソート・多軸ソート、カスタムコレクション（多対多タグ）、スマートコレクション、欠巻・新刊チェッカー、重複アーカイブ検出
- **領域 B：メタデータ・表紙アート管理**
  - 自炊ファイル名スマートパーサー、公開書誌 API 自動取得＆手動再選択・ロック UI、ビューポート優先＋バックグラウンド低速キューによる ZIP 先頭ページ WebP 表紙抽出、見開きカバー半裁クロップ＆表紙ページ指定
- **領域 C：ストリーミング＆マルチストレージ連携**
  - 末尾 128KB Central Directory 解析（ZIP64 / Shift_JIS 対応）＋ IndexedDB 目次キャッシュ、LFH 可変長対応 1 RTT 切り出し、Fast-Path 初速取得＋バイト予算制（8〜12MB）Warm Prefetch、L1（`ImageBitmap` 3〜5P）/ L2（圧縮 `Uint8Array` 60〜100MB）2段階キャッシュ、Google OAuth 透過リフレッシュ、自宅 HTTP Range サーバー＆ローカルファイル対応
- **領域 D：WebGL2 描画・自炊画質補正**
  - WebGL2 トリリニア Mipmap＋シャープネス/LOD バイアス補正、白黒レベル・ガンマ補正シェーダー（黄ばみ飛ばし・裏写り軽減）、`MAX_TEXTURE_SIZE` 分割/縮小ガード、余白オートクロップ、インテリジェント見開き＆「1ページずらし」ワンタップ補正、綴じ方向・縦スクロール切替
- **領域 E：リーダー操作体験・読書アシスト**
  - 60fps 慣性スワイプ・ピンチズーム・ダブルタップ/ルーペ拡大、タップゾーン変更、音量キー・Bluetooth リモコン対応、サムネイル付き高速シークバー＆ジャンプ元復帰（Undo Jump）、連続巻またぎ読書
- **領域 F：しおり・読書記録・端末間バックアップ**
  - 自動レジューム・既読管理・メモ付きしおり、Google Drive `appDataFolder` によるサーバーレス自動バックアップ＆複数端末同期（LWW）、読書統計ビュー

---

## 4. ミニリリース Milestone 計画（Phase 2 策定用たたき台）

| フェーズ / Milestone | 目的・達成ゴール（Phase 2 で詳細確定） | 状態 |
| :--- | :--- | :---: |
| **Phase 1: AI駆動開発基盤構築** | DevContainer、ESLint/Prettier/Vitest/Storybook/Playwright、OKF ドキュメント・AI スキル基盤の立ち上げ | Planned |
| **Phase 2: コア仕様・設計骨格策定** | MVP スコープ確定、`architecture.md` / `db-schema.md` / `screen-transitions.md` 初版承認（`Approved (Phase 2)`） | **Draft** |
| **Phase 3: Walking Skeleton (PoC)** | ローカル/HTTP Range ZIP ストリーミング → Worker 解凍・Zero-Copy → 生 WebGL2 1ページ描画＋ページめくりの垂直スライス実証 | Planned |
| **v0.1: コアリーダー＆Google Drive ストリーミング** | ZIP64/CP932 完全対応、Fast-Path＋バイト予算先読み、L1/L2 キャッシュ、Google OAuth＋Drive Range 閲覧、見開き・基本シェーダー | Planned |
| **v0.2: 仮想本棚・差分同期・表紙抽出** | Drive 初回一括スキャン＆`changes` 差分同期、ファイル名パーサー、シリーズ束ね本棚 UI、2段優先度表紙 WebP 抽出キュー | Planned |
| **v0.3: 公開書誌 API 連携・高機能検索** | `CapacitorHttp` 書誌クライアント（NDL / Google Books / 楽天 / AniList）、候補再選択 UI、0.01秒複合検索・五十音ソート | Planned |
| **v0.4+: 自炊 UX 完成・端末間同期** | 自炊画質プリセット、オートクロップ、音量キー操作、`appDataFolder` 自動バックアップ同期、コレクション整理機能 | Planned |

---

## 5. Phase 2 開始時の検討アジェンダ（未決事項リスト）

1. **MVP（`Phase 3` / `v0.1` / `v0.2`）の機能切り出し境界の確定**
2. **利用する公開書誌 API の初期対象と優先順位**（NDL サーチ単独で開始するか、AniList / Google Books / 楽天ブックスをどの Milestone で統合するか）
3. **自宅 HTTP サーバー連携および `appDataFolder` 端末間同期の導入タイミング**
4. **タブレット横向き見開き UI・自炊補正シェーダーの初期パラメータ範囲**
