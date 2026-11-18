# ExLibris (`ex-libris`)

> *Ex Libris* — 「私の蔵書」  
> Google Driveの物理フォルダ構成に縛られず、自分だけの美しい蔵書ライブラリを構築し、ダウンロード待ちゼロで快適に読むための自炊マンガビューア＆仮想本棚アプリ。

## コンセプト・主な特徴

- **ゼロ待ち超高速ストリーミング**: Google Drive API（HTTP Rangeリクエスト）に特化し、100MB超〜数GB規模の合本ZIP/CBZ（ZIP64・Shift_JIS対応）でも 0.1〜1秒未満で1ページ目を描画。
- **マルチスレッド ＆ L1/L2 2段階メモリ管理**: Web Workerプールによる非同期解凍・`createImageBitmap` Zero-Copy転送と、高解像度スキャン画像でもAndroid WebViewがOOMクラッシュしない2層キャッシュ制御。
- **生WebGL2 モアレ除去＆自炊補正シェーダー**: ハードウェアMipmapによるスクリーントーンの干渉縞（モアレ）除去に加え、紙の黄ばみ飛ばし・描線シャープネス補正をリアルタイム処理。
- **物理ストレージと分離された「仮想本棚」**: ローカルDB（IndexedDB / Dexie.js）上で公開書誌情報（タイトル・読み仮名・作者・出版社・ジャンル等）とGoogle Driveの `fileId` 参照を管理し、ミリ秒単位の多軸検索と自由なコレクション整理を実現。

## 推奨技術スタック（予定）

- **Framework**: React + TypeScript + Vite + Capacitor (Androidメイン)
- **Rendering**: Raw WebGL2 Custom Shader Pipeline
- **Workers**: Web Workers + Comlink + Transferable Objects
- **ZIP / Compression**: Custom ZIP/ZIP64 Range Parser + `DecompressionStream` (`fflate` fallback)
- **Local DB & State**: Dexie.js (IndexedDB) + Zustand
- **Testing**: Vitest (TDD)

## ドキュメント

プロジェクトの背景、コアアーキテクチャの技術検証、機能カタログ（全検討項目）、および今後の検討アジェンダは以下のマスタードキュメントに集約しています。

- 📄 **[初期構想・技術検証マスタードキュメント (`docs/CONCEPT.md`)](./docs/CONCEPT.md)**

> **Note**: 各機能の詳細仕様確定、MVPスコープの切り出し、および実装マイルストーンの策定は、`docs/CONCEPT.md` をベースとして本リポジトリ上で順次整理・決定します。
