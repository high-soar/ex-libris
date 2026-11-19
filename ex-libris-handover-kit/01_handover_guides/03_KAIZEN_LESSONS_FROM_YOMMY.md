# 03. Yommy 開発（全12マイルストーン・495件の品質記録）から得た実践 Kaizen 教訓集

Yommy（`PoC` 〜 `v1.2.0`）では、単体テスト・VRT・結合テスト・独立 AI レビュー・実機検証で見つかった計 495 件の品質イベント（バグ・レビュー指摘・申し送り）をすべて記録・分析し、ガイドラインと AI スキルへ還流してきました。
その中でも **マルチスレッド通信・優先度キュー・ジェスチャー UI・Google Drive 連携を扱う ExLibris でそのまま致命傷を防げる 8 つの実践教訓** を厳選して引き継ぎます。

---

## 1. 非同期レースコンディション防止：「Epoch（世代番号）＋ AbortController」の二重ガード

- **Yommy での教訓（原因分類 `S`: State / Async Race）**:
  高速な画面遷移や連続操作中に非同期処理（通信・キャッシュ読込）が完了すると、`AbortController` だけでは「通信完了直後〜デコード完了までの隙間」をすり抜けた古い結果が最新ステートを上書きする不具合が複数回発生した。
- **ExLibris での適用箇所**:
  - リーダーでの高速シークバー移動・連続ページめくり・連続巻またぎ（`TR-06`）
  - 仮想本棚での高速インクリメンタル検索や公開書誌 API の再検索連打
- **必須パターン**:
  1. 操作のたびに単調増加する `epochId`（世代番号）を発行する。
  2. ネットワーク層は `AbortController.signal` で即時中断する。
  3. Decode Worker から `ImageBitmap` が返ってきた際、`if (resultEpoch !== currentEpoch)` であれば **絶対に L1 キャッシュや WebGL2 テクスチャへ渡さず、その場で `bitmap.close()` を呼んで破棄する**（これを忘れるとシーク連打で VRAM リーク → OOM クラッシュに直結する）。

---

## 2. バックグラウンドキューと閲覧操作の競合回避（`cacheScheduler.ts` パターンの継承）

- **Yommy `v1.2.0` での教訓**:
  バックグラウンドの先読みや一括取得キューが走っている最中にユーザーが別作品を開くと、API レートリミット（403 / 429）や帯域競合で肝心の「今読みたい1ページ目」が待たされる問題が発生した。これを優先度付きプリエンプション＋レート制御スケジューラで解決した（参考実装: `../03_yommy_reference_files/patterns/cacheScheduler.ts` および `docs_samples/issue-344-priority-cache-scheduler.md`）。
- **ExLibris での適用箇所**:
  **「① リーダーの Fast-Path / Warm Prefetch」vs.「② 本棚ビューポート内の表紙 WebP 即時抽出」vs.「③ 本棚全体のバックグラウンド表紙 WebP 抽出（秒間2冊）」** の 3 階層スケジューリング。
- **必須パターン**:
  - 単一の `DriveRequestScheduler`（または Coordinator トークンバケット）を通し、**優先度 P0（リーダー閲覧中）がアクティブな間は P1/P2（表紙抽出キュー）の新規発火を即座にサスペンド** する。
  - レートリミット用の最終リクエスト時刻（`lastDispatchedAt`）は優先度変更やジョブキャンセル時にもリセットせず、バースト発火による Google Drive `403 userRateLimitExceeded` を確実に防ぐ。

---

## 3. マルチタッチ・ピンチズーム・スワイプの状態汚染防止（Pointer / Touch Ref 分離）

- **Yommy での教訓**:
  Android WebView 実機において、2本指ピンチ操作の離指タイミングやダブルタップ直後のスワイプで、`PointerEvent` と `TouchEvent` の座標キャッシュを同一 Ref に混在させると意図しないページめくり誤爆が発生した。
- **ExLibris での適用箇所**:
  生 WebGL2 キャンバス上の **「慣性スワイプめくり」「2本指ピンチズーム」「ダブルタップ拡大 / 長押しルーペ」「左右端タップゾーン」** の共存。
- **必須パターン**:
  - ジェスチャー認識をステートマシン（`idle` / `panning` / `pinching` / `loupe`）として純粋関数・カスタムフックに切り出す。
  - `pinching` から指が 1 本離れた直後のクールダウン期間（例: 全指が離れるまで、または 150ms）は単一指スワイプめくりへの遷移を抑止する。

---

## 4. 端末間同期（`appDataFolder` LWW）における `updatedAt` 汚染防止

- **Yommy での教訓（原因分類 `S` / `D`）**:
  クラウド同期（Last-Write-Wins: 最終更新時刻勝ち）において、バックグラウンドの自動キャッシュ更新や内部再計算でレコードの `updatedAt` を更新してしまうと、別端末で行ったユーザーの正当な手動編集・読書進捗を「古い」と誤判定して上書き消去してしまう罠があった（参考実装: `../03_yommy_reference_files/patterns/syncEngine.ts`）。
- **ExLibris での適用箇所**:
  `Series`（手動メタデータ編集・ロック）および `Volumes`（表紙 WebP 自動抽出・MD5 更新）と `appDataFolder` バックアップ同期。
- **必須パターン**:
  - **ユーザーの論理操作時刻（`updatedAt`）** と **端末ローカルのキャッシュ生成時刻（`coverExtractedAt`, `cachedAt`）** のカラムを厳格に分離し、表紙抽出完了では `updatedAt` を一切書き換えない。

---

## 5. Android ネイティブ実装の既知の罠（`CloudSyncPlugin.java` / `VolumeKeyPlugin.java`）

`../03_yommy_reference_files/android_and_bridges/android/` に同梱した Java コードには、Android 実機検証で踏み抜いて解決済みの対策が入っています。

1. **`HttpURLConnection` の `PATCH` 非対応**: Android 標準の `HttpURLConnection` は `setRequestMethod("PATCH")` で `ProtocolException` を投げる。Google Drive REST API でファイル更新を行う際は `POST` ＋ `X-HTTP-Method-Override: PATCH` ヘッダーを使うこと。
2. **OAuth 同意画面インテント中の PluginCall 保持**: 初回認証やスコープ追加時、`AuthorizationResult.hasResolution()` が `true` になる。`bridge.saveCall(call)` で保持してから `StartIntentSenderForResult` を呼ばないと、同意画面から戻った際に JS 側の Promise が永遠に解決しない。
3. **音量キーページめくり時のシステム音量バー抑止**: `MainActivity.dispatchKeyEvent` から `VolumeKeyPlugin` へ委譲し、リーダー画面がインターセプト有効な間だけ `KEYCODE_VOLUME_UP` / `KEYCODE_VOLUME_DOWN` で `true`（イベント消費）を返し、本棚画面では通常の音量調整に戻すこと（リーダー unmount 時の解除漏れを UT で必ず検証する）。

---

## 6. 親子テスト完全分離における Vitest モックの罠

- **Yommy での教訓**:
  親コンポーネントのテストで子コンポーネントを `vi.mock('./Child', () => ({ Child: vi.fn() }))` とだけ定義すると、React 19 では `undefined` 返却や `vi.restoreAllMocks()` 後のモック実装消失で意図せず実体レンダリングやエラーが起きることがあった。
- **必須パターン（`docs/guidelines/testing.md` 標準化済み）**:
  ```tsx
  const MockWebGLViewport = vi.fn();
  vi.mock("./WebGLViewport", () => ({
    WebGLViewport: (props: unknown) => MockWebGLViewport(props),
  }));

  beforeEach(() => {
    MockWebGLViewport.mockReset();
    MockWebGLViewport.mockImplementation(() => null);
  });
  ```
  この形に統一することで、親テストは「子に正しい Props（例: `imageBitmap`, `shaderParams`, `spreadMode`）を渡したか」の契約検証だけに 100% 集中でき、テスト修正コストが激減します。

---

## 7. Playwright VRT / IT のフレーク（不安定失敗）根絶ルール

1. **`page.waitForTimeout()` の全面禁止**:
   固定ミリ秒待機はローカルで通っても CI で必ずフレークする。アプリ初期化完了は `data-app-ready="true"` 属性（`ServiceProvider.tsx` 参照）、WebGL2 描画完了は `data-rendered-page="0"` や `data-shader-ready="true"` のような **決定論的 DOM マーカー属性** を待ってからスクリーンショットを撮る。
2. **ポート番号のワークスペース決定論的分離（FNV-1a ハッシュ）**:
   複数ブランチや別ワークスペースで同時に Storybook VRT や Playwright IT を走らせても `EADDRINUSE` にならないよう、`process.cwd()` の FNV-1a ハッシュからポート番号を算出する仕組み（`03_yommy_reference_files/configs/playwright.vrt.config.ts` / `playwright.it.config.ts`）をそのまま継承する。

---

## 8. 複数の AI オーケストレーターによる Milestone 横断レビュー時の ID 衝突回避

- Milestone Step 1 で Claude / Gemini / GPT など複数モデルに並行して横断レビュー（`phase-final-reviewer`）を走らせると、単一モデルでは見落とす境界バグ（原因 `B` / `S`）の検出率が劇的に向上した（Yommy では全 12 マイルストーンで本番流出バグゼロ・Milestone DRE 100% を達成）。
- 一方で並列実行時に Issue コメントの指摘番号（`R1-01`, `R1-02`...）が重複する問題が起きたため、**「開始時は既存コメントを見ない → 全検証完了・投稿直前に最新コメントを取得して連番採番 → 投稿直後に再取得して衝突していれば `gh api --method PATCH` で自動振り直し」** というプロトコルを `.github/skills/phase-final-review/SKILL.md` に標準搭載している。
