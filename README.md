# ExLibris (`ex-libris`)

> _Ex Libris_ — 「私の蔵書」  
> Google Driveの物理フォルダ構成に縛られず、自分だけの美しい蔵書ライブラリを構築し、ダウンロード待ちゼロで快適に読むための自炊マンガビューア＆仮想本棚アプリ。

## コンセプト・主な特徴

- **ゼロ待ち超高速ストリーミング**: Google Drive API（HTTP Rangeリクエスト）に特化し、100MB超〜数GB規模の合本ZIP/CBZ（ZIP64・Shift_JIS対応）でも 0.1〜1秒未満で1ページ目を描画。
- **マルチスレッド ＆ L1/L2 2段階メモリ管理**: Web Workerプールによる非同期解凍・`createImageBitmap` Zero-Copy転送と、高解像度スキャン画像でもAndroid WebViewがOOMクラッシュしない2層キャッシュ制御。
- **生WebGL2 モアレ除去＆自炊補正シェーダー**: ハードウェアMipmapによるスクリーントーンの干渉縞（モアレ）除去に加え、紙の黄ばみ飛ばし・描線シャープネス補正をリアルタイム処理。
- **物理ストレージと分離された「仮想本棚」**: ローカルDB（IndexedDB / Dexie.js）上で公開書誌情報（タイトル・読み仮名・作者・出版社・ジャンル等）とGoogle Driveの `fileId` 参照を管理し、ミリ秒単位の多軸検索と自由なコレクション整理を実現。

## 技術スタック・開発環境

- **App Framework**: React 19 + TypeScript + Vite + Tailwind CSS + Capacitor (`com.highsoar.exlibris`, Androidメイン)
- **Rendering**: Raw WebGL2 Custom Shader Pipeline
- **Workers**: Web Workers + Comlink + Transferable Objects
- **ZIP / Compression**: Custom ZIP/ZIP64 Range Parser + `DecompressionStream` (`fflate` fallback)
- **Local DB & State**: Dexie.js (IndexedDB + `fake-indexeddb`) + Zustand
- **Testing & Quality**: Vitest (100% Coverage TDD) + Storybook VRT (1280px/375px SwiftShader WebGL2) + Playwright IT
- **AI Development Platform**: Google Antigravity Remote Agent Exclusive (`AGENTS.md` + `.agents/`) + GitHub Actions CI/APK Build

## ドキュメント（OKF 準拠 SSOT）

- 📚 **[ドキュメント全体マップ (`docs/index.md`)](./docs/index.md)**
- 🤖 **[AI エージェント憲法 (`AGENTS.md`)](./AGENTS.md)**
- 📐 **[全体要件定義 (`docs/specs/requirements.md`)](./docs/specs/requirements.md)** / **[アーキテクチャ (`docs/specs/architecture.md`)](./docs/specs/architecture.md)**
- 🗂️ **[初期構想・引き継ぎ参考資料（一時保持: `reference/CONCEPT.md`）](./reference/CONCEPT.md)**
