---
type: spec-delta
title: "Issue #20 差分仕様: Fast-Path＋10MB先読み・80MB L2 LRU・Epoch制御（HO-03対応）"
description: "80MB L2ByteCache LRU（単一80MB超表示中一時保持・独立Uint8Array正規化）、10MB予算・64KBギャップ結合 AdaptivePrefetcher、HO-03共有バッファ非破壊、およびCoordinatorCore/ReaderPageのIn-Flight共有・Epoch制御統合を定義する差分仕様"
status: "Review (#20)"
updated: "2026-11-21"
issue: "#20"
tags:
  [
    delta,
    v0.1,
    l2-cache,
    lru,
    prefetch,
    coalesce,
    epoch,
    ho-03,
    streaming,
    worker,
  ]
related_specs:
  - docs/index.md
  - docs/specs/requirements.md
  - docs/specs/architecture.md
  - docs/specs/screen-transitions.md
  - docs/specs/engine/zip-streaming.md
  - docs/specs/features/reader.md
  - docs/guidelines/workflow.md
  - docs/guidelines/testing.md
  - docs/quality/bug-and-handover-log.md
related_tests:
  - src/engine/constants.test.ts
  - src/engine/zip/zipParser.test.ts
  - src/engine/workers/CoordinatorCore.test.ts
  - src/engine/workers/coordinatorTransfer.test.ts
  - src/features/reader/ReaderPage.test.tsx
  - test/it/local-reader.spec.ts
---

# Issue #20 差分仕様: Fast-Path＋10MB先読み・80MB L2 LRU・Epoch制御（`HO-03` 対応）

## 1. 背景・目的（Why）

- [requirements.md §3](../requirements.md#3-非機能要件システムリソース基準nfr-xx) の **`NFR-01`**（初速 TTFP < 1.0s / 再開 < 0.5s）および **`NFR-02`**（Worker 内 L2 キャッシュ上限 **80MB**、Warm Prefetch 1 リクエスト上限 **10MB**、物理ギャップ **64KB** 以内結合）を実現し、高解像度連続めくり・次期 Google Drive ストリーミング（`v0.2`）における通信往復回数（RTT）とデコード待ち時間を最小化する。
- Phase 3 横断レビューからの申し送り事項 [`HO-03`](../../quality/bug-and-handover-log.md)（後半）である **`L2ByteCache` 導入時の共有 `ArrayBuffer` 非破壊（`prepareDecodeTransfer` での所有権分離）** を完遂し、L1（5 ページ）退避後の再めくり時にも `L2ByteCache` から再通信ゼロで安全に再デコードできるようにする。

### 1.1 Step 1 合意事項（`/grill-me` 確定内容：Q1〜Q6）

1. **Warm Prefetch の候補窓と 10MB 予算適用順序（Q1）**:
   - `ReaderPage` から閲覧優先順の候補配列 `prefetchIndices`（進行方向 `+1`〜`+20` ページ ＋ 逆方向 `-1`〜`-2` ページ、`0 <= idx < totalPages` にクランプ）を渡す。
   - `AdaptivePrefetcher` は `prefetchIndices` の優先順で重複・範囲外・L2 格納済み・In-Flight 中・単一 `compressedSize > L2_CACHE_MAX_BYTES`（80MB 超：Warm Prefetch では格納対象外）を除外し、**1 サイクル合計 `WARM_PREFETCH_BUDGET_BYTES`（10MB）以内** となる連続候補を選抜する（先頭候補 1 件が単独で `10MB < fetchSpan` かつ `compressedSize <= 80MB` の場合のみその 1 件単独を選抜し、予算超過が発生した時点で後続候補の選抜を打ち切る）。選抜後、`localHeaderOffset` 昇順で 64KB ギャップ結合を行う。
2. **L1 近傍要求と Warm Prefetch の I/O 連携・In-Flight 共有（Q2）**:
   - 現在表示ページ `N` が L1 未ヒット時はまず `requestVisiblePages([N], prefetchIndices, epoch, { visiblePageIndices: [N] })` で `N` 単独の Fast-Path 取得・最速描画を完了させ、直後に Coordinator 内で `prefetchIndices` の 10MB 結合 Warm Prefetch を非同期開始する。
   - 続く L1 近傍要求（`[N+1, N+2, N-1]` の L1 未保持分）は `ReaderPage` 側で **1 回の `requestVisiblePages(missingNeighbors, [], epoch, { visiblePageIndices: [N] })` にバッチ化** し、Coordinator 内のページ単位 In-Flight 共有マップ（`inflightPageReads`）により進行中 Warm Prefetch の完了スライスを共有して二重 `readRange` を防止する。
   - 早期ページめくり時は `cancelEpochBelow(nextEpoch)` が進行中 Warm Prefetch を即時 `AbortController.abort()` して単独 Fast-Path へ切り替える。また `N` および L1 近傍すべてが L1 ヒットした場合も `requestVisiblePages([], prefetchIndices, epoch, { visiblePageIndices: [N] })` で L2 補充と表示ピン更新を行える契約とする。1 つの `epoch` あたりの Warm Prefetch 起動は最大 1 サイクルに制限する。
3. **`L2ByteCache` の 80MB 超例外ページ一時保持と独立 `Uint8Array` 正規化（Q3）**:
   - `L2ByteCache` は `allowOversized: true`（現在表示ページの Fast-Path 格納）に限り、`byteLength > maxBytes`（80MB 超）の単一エントリ格納を許容（既存エントリ全退避＋表示中ピン保護により後続 Warm Prefetch による誤退避や追加格納を防止）し、表示対象（`pinnedPages`）から外れた時点または `clear()` 時に即時退避して `totalBytes <= maxBytes` へ復帰させる。Warm Prefetch や L1 近傍（`allowOversized: false`）の 80MB 超エントリは L2 格納をスキップする。
   - 10MB 結合バッファの部分 `subarray` 保持による裏側 `ArrayBuffer` 居残りリークを防ぐため、`L2ByteCache.put` は `byteOffset !== 0 || byteLength !== buffer.byteLength`（または非 `ArrayBuffer`）のスライスを必ず `slice()` で独立 `Uint8Array` へ正規化して保持する。
4. **`HO-03`（共有 `ArrayBuffer` 非破壊）の実装方式（Q4）**:
   - `coordinator.worker.ts` の条件分岐ゼロ規約（[testing.md §2.1](../../guidelines/testing.md)）と既存の `DecodeWorkerApi` シグネチャを維持するため、`coordinatorTransfer.ts` に `WeakSet<ArrayBuffer>` ベースの `markSharedBuffer` / `isSharedBuffer` と明示オプション `PrepareDecodeTransferOptions`（`{ shared?: boolean }`）を導入する。
   - `L2ByteCache.put`（および複数待機者が共有する In-Flight スライス）で `markSharedBuffer(buffer)` を自動付与し、`prepareDecodeTransfer` は共有印付きバッファまたは `options?.shared === true` に対して `byteOffset === 0` であっても必ず `compressedData.slice()` の複製バッファを `transferables` に渡す。
5. **`AdaptivePrefetcher` の結合境界式と投機的先読みの異常系挙動（Q5）**:
   - 結合条件は `gap = next.localHeaderOffset - prev.physicalEnd` が `0 <= gap <= MAX_COALESCE_GAP_BYTES`（`65_536` = 64KB）かつブロック実 Range 長 `nextFetchEnd - blockStart <= WARM_PREFETCH_BUDGET_BYTES`（`10_485_760` = 10MB、単一ページ単独超過時のみ 1 件許容）の双方を満たすこととする。
   - 結合ブロック末尾エントリで LFH `extraField` が 1KB マージンを超過した場合は、`zipParser.ts` と共通化した補完読込ロジック（ケース 2a / 2b）で不足分のみ追加取得して L2 格納する。
   - 投機的バックグラウンド処理である Warm Prefetch 中の `AbortError`・通信失敗（`READ_ERROR`）・一部エントリの LFH 破損（`CORRUPT_ZIP`）は未処理例外とせず握り潰し、同一結合バッファ内の正常エントリは無駄なく `L2ByteCache` へ格納して破損エントリのみスキップする（実ページ到達時の Fast-Path で `AC-RD-07` のページ単位エラーとして確定処理する）。
6. **Sub-issue 3 分割と Android 実機検証区分 B（Q6）**:
   - MK-1（`L2ByteCache`・`coordinatorTransfer` `HO-03`・`zipParser` 共通化・`AdaptivePrefetcher`）→ MK-2（`CoordinatorCore` 統合・`ReaderPage` 先読み窓＆L1 近傍バッチ化）→ Step 4 IT（7 ページ以上の連続往復による L1 退避→L2 再デコード実 Worker 検証・`HO-03` `Resolved` 精算）の 3 段階で進行し、実機検証は **区分 B（`Milestone v0.1 完了前` に一括実施 / `HO-06`）** とする。

---

## 2. 変更対象の App 全体正本一覧

|   種別   | 正本ファイル                                                     | 変更概要                                                                                                                                                                                        |
| :------: | :--------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **更新** | [zip-streaming.md](../engine/zip-streaming.md)                   | `L2ByteCache`・`AdaptivePrefetcher`・LFH 共通抽出ヘルパ・`CoordinatorCore` In-Flight 共有＆Epoch プリエンプション・`HO-03` `markSharedBuffer` 所有権分離を追記、`AC-ENG-12`〜`14` を追加        |
| **更新** | [architecture.md](../architecture.md)                            | `RequestVisiblePagesOptions`（`visiblePageIndices`）追加および `CoordinatorWorkerApi.requestVisiblePages` の `v0.1` 契約（Fast-Path ＋ L1 近傍バッチ ＋ 10MB Warm Prefetch ＋ 80MB L2 LRU）更新 |
| **更新** | [reader.md](../features/reader.md)                               | `ReaderPage` の優先順 `prefetchIndices`（進行 `+1..+20`・逆 `-1..-2`）構築、L1 近傍バッチ要求、L1 全ヒット時の L2 補充呼び出し、`AC-RD-05` 連携を更新                                           |
| **更新** | [screen-transitions.md](../screen-transitions.md)                | `SCN-02` 対応要件へ `AC-ENG-12`〜`AC-ENG-14` を追加し、7 ページ以上の連続往復による L1(5P) 退避後の L2 再デコード（`HO-03` 非破壊実 Worker 検証）を追記                                         |
| **更新** | [bug-and-handover-log.md](../../quality/bug-and-handover-log.md) | `HO-03` の解決先 Issue を `#20` へ具体化し、区分 B の Android 実機検証申し送り **`HO-06`**（完了ゲート: `Milestone v0.1 完了前`）を新規登録                                                     |

---

## 3. 追加・変更する仕様の差分サマリー

### 3.1 `HO-03` 共有バッファ非破壊契約（`src/engine/workers/coordinatorTransfer.ts` / `AC-ENG-14`）

1. **共有 `ArrayBuffer` レジストリ（`WeakSet<ArrayBuffer>`）**:
   - `markSharedBuffer(buffer: ArrayBufferLike): void`: `buffer instanceof ArrayBuffer` の場合にモジュール内 `WeakSet<ArrayBuffer>` へ登録する（GC を阻害せずメモリリークしない）。
   - `isSharedBuffer(buffer: ArrayBufferLike): boolean`: `buffer instanceof ArrayBuffer` かつ上記 `WeakSet` に登録済みなら `true` を返す。
2. **`prepareDecodeTransfer(compressedData, options?: PrepareDecodeTransferOptions)`**:
   - `PrepareDecodeTransferOptions` として `{ readonly shared?: boolean }` を定義する。
   - `options?.shared === true` または `isSharedBuffer(compressedData.buffer) === true` の場合、`byteOffset === 0 && byteLength === compressedData.buffer.byteLength` であっても元バッファを `transferables` に入れず、必ず `const copied = compressedData.slice()` で独立 `ArrayBuffer` を新規複製して `{ data: copied, transferables: [copied.buffer] }` を返す。
   - 非共有かつ `byteOffset === 0 && byteLength === compressedData.buffer.byteLength && compressedData.buffer instanceof ArrayBuffer` の独立一時バッファのみ、従来通り Zero-Copy 転送する。
   - `coordinator.worker.ts` は既存の `prepareDecodeTransfer(compressedData)` 呼び出しを維持し、条件分岐を一切追加しない。

### 3.2 `L2ByteCache`（80MB LRU キャッシュ / `src/engine/cache/L2ByteCache.ts` / `AC-ENG-12`）

1. **基本構成・初期化**:
   - `L2ByteCacheOptions`: `{ readonly maxBytes?: number }`（未指定または非有限値時は `ENGINE_BUDGETS.L2_CACHE_MAX_BYTES = 83_886_080`、有限値は `Math.max(1, Math.floor(maxBytes))` に正規化）。
   - `size`（保持ページ数）、`totalBytes`（保持中 `Uint8Array.byteLength` 合計）、`has(pageIndex)`、`peek(pageIndex)`、`get(pageIndex)`（ヒット時に MRU へ移動）、`delete(pageIndex)`、`clear()` を備える。
2. **独立 `Uint8Array` 正規化 ＆ `markSharedBuffer` 自動付与**:
   - 格納対象 `data: Uint8Array` が部分ビュー（`byteOffset !== 0 || byteLength !== data.buffer.byteLength`）または非 `ArrayBuffer` の場合は `data.slice()` でちょうどの長さの独立 `Uint8Array` を生成し、10MB 結合バッファ全体の居残りリークを防ぐ。
   - 格納確定した `Uint8Array.buffer` には必ず `markSharedBuffer(stored.buffer)` を呼び出し、後段 `prepareDecodeTransfer` でのデタッチ破壊を構造的に遮断する。
3. **80MB LRU 退避と単一 80MB 超例外ページの表示中一時保持（`NFR-02`）**:
   - `setPinnedPages(pageIndices: Iterable<number>): void`:
     - 現在表示中のページ集合 `pinnedPages` を更新する。
     - 保持中に `entry.byteLength > maxBytes` の 80MB 超例外エントリが存在し、その `pageIndex` が新しい `pinnedPages` に含まれなくなった場合、即座に当該エントリを退避して `totalBytes <= maxBytes` へ戻す。
   - `put(pageIndex: number, data: Uint8Array, options?: { readonly allowOversized?: boolean }): boolean`:
     - 同一 `pageIndex` の既存エントリがある場合は先に削除して `totalBytes` から減算する。
     - **ケース A（`data.byteLength > maxBytes`：単一 80MB 超ページ）**:
       - `options?.allowOversized !== true`（Warm Prefetch・L1 近傍）の場合、または既に別ページの 80MB 超ピン中エントリが保持されている場合（`hasOversizedPinnedEntry() === true`）は、既存キャッシュを退避せず格納をスキップし、`false` を返す（複数表示ページ並列要求時でも 80MB 超の 2 件同時保持や追い出し競合を起こさない）。
       - 上記以外の `options?.allowOversized === true`（現在表示ページ）の場合は既存エントリを全退避した上で当該 1 件のみ格納し、`true` を返す。
     - **ケース B（`data.byteLength <= maxBytes`：通常ページ）**:
       - 同一 `pageIndex` の既存分削除後に `hasOversizedPinnedEntry() === true`（別ページの 80MB 超ピン中エントリが保持中）の場合、**`options?.allowOversized` の真偽を問わず** 当該 80MB 超表示ページを保護し、かつ退避不能ループや完了順依存の追い出しを防ぐため追加格納をスキップして `false` を返す。
       - それ以外の場合は `totalBytes + data.byteLength > maxBytes` の間、まず `pinnedPages` 外の最古 LRU エントリから順に退避し（全候補が `pinnedPages` 内の通常ページで埋まっている場合のみ最古エントリを退避して `maxBytes` 上限を厳守）、MRU として格納して `true` を返す。
   - `hasOversizedPinnedEntry(): boolean`（`pinnedPages` に含まれる `entry.byteLength > maxBytes` の保持有無）を提供し、80MB 超ページ表示中に `AdaptivePrefetcher` が無駄な Range 通信を行わないよう判定可能にする。

### 3.3 LFH 切り出し共通化と `AdaptivePrefetcher`（`src/engine/zip/zipParser.ts`, `src/engine/prefetch/AdaptivePrefetcher.ts` / `AC-ENG-13`）

1. **`zipParser.ts` の LFH 計算・切り出しヘルパ共通化**:
   - `computeEntryFetchSpan(entry: ZipPageEntry): number`: `maxSpan = entry.physicalEnd - entry.localHeaderOffset` に対し `Math.min(maxSpan, 30 + entry.entryNameByteLength + entry.compressedSize + ENGINE_BUDGETS.LFH_EXTRA_MARGIN_BYTES)` を返す純関数を公開する。
   - `extractCompressedSliceFromBuffer(reader, entry, initialBuf, signal?)`: 取得済みバッファ（単一ページ先頭バッファまたは結合バッファの部分 `subarray`）から LFH シグネチャ・可変長 `fileNameLength` / `extraFieldLength`・`maxSpan` 境界を検証し、1 RTT 切り出しまたは LFH 1KB 超過時の 2 RTT 補完取得（ケース 2a: 先頭＋不足末尾結合、ケース 2b: `dataStart >= initialBuf.byteLength` 直接取得）を行う共通関数として切り出し、`readCompressedPageSlice` と `AdaptivePrefetcher` の双方から利用する。
2. **`AdaptivePrefetcher` の 2 段階プランニング（`planPrefetchBatches`）**:
   - 事前ガード: `l2Cache.hasOversizedPinnedEntry()` が `true` の場合は空配列 `[]` を返し、通信を行わない。
   - **Step 1（優先順 10MB 選抜）**:
     - `prefetchIndices` を先頭から走査し、非整数・範囲外・重複・除外対象（現在表示中・`l2Cache.has(idx)`・同世代 In-Flight 取得中）・構造不正（`localHeaderOffset < 0 || physicalEnd - localHeaderOffset < 30`）・単一 `compressedSize > l2Cache.maxBytes`（80MB 超）をスキップする。
     - 各候補の `span = computeEntryFetchSpan(entry)` を積算し、`selected.length === 0 && span > WARM_PREFETCH_BUDGET_BYTES`（単一 10MB 超〜80MB 以下）の場合はその 1 件のみを選抜して終了する。それ以外は `accumulatedBytes + span <= WARM_PREFETCH_BUDGET_BYTES`（10MB）を満たす間だけ追加し、最初に超過した時点で打ち切る（優先度順の連続性を維持し人為的なギャップを作らない）。
   - **Step 2（物理オフセット昇順ソート ＆ 64KB ギャップ・実 Range 長 10MB 結合）**:
     - 選抜エントリを `localHeaderOffset` 昇順にソートする。
     - 隣接エントリ `prev`, `next` に対し、`gap = next.localHeaderOffset - prev.physicalEnd` および結合時の終端 `candidateEnd = next.localHeaderOffset + computeEntryFetchSpan(next)` を算出し、以下 2 条件を同時に満たす場合のみ同一 `PrefetchBatch`（`{ entries, rangeOffset, rangeLength }`）へ結合する：
       1. `0 <= gap <= ENGINE_BUDGETS.MAX_COALESCE_GAP_BYTES`（`65_536` = 64KB）
       2. `candidateEnd - currentBatch.rangeOffset <= ENGINE_BUDGETS.WARM_PREFETCH_BUDGET_BYTES`（`10_485_760` = 10MB）
     - いずれかを満たさない場合は現在のバッチを確定し、`next` から新バッチを開始する。
3. **全バッチ一括先行 In-Flight 登録と結合バッチ実行・部分救済（`runPrefetchBatches`）**:
   - Warm Prefetch 起動直後・**最初の `await` に入る前** に、`planPrefetchBatches` で確定した全バッチの対象ページ（`batches.flatMap(b => b.entries)` のうち `l2Cache` 未保持かつ同世代 `inflightPageReads` 未登録分）を同期的に一括で In-Flight 待機マップへ先行登録する。これにより 64KB 超ギャップで `Batch 0 = [N-2, N-1]`, `Batch 1 = [N+1, N+2, ...]` に分割された場合でも、`Batch 0` 実行中に到着する `missingNeighbors`（`[N+1, N+2, N-1]`）が `Batch 1` 側の In-Flight エントリに確実に合流でき、二重 `readRange` や上書き競合が発生しない。
   - 各バッチ実行前に `signal.aborted` を確認し、バッチ内の全ページが既に `l2Cache.has` 済みであれば当該バッチの `readRange` をスキップして解決通知する。未取得ページがある場合は `reader.readRange(batch.rangeOffset, batch.rangeLength, signal)` で結合バッファを 1 RTT 取得する。
   - バッチ内各 `entry` について、既に `l2Cache.has(entry.pageIndex)` であれば既存キャッシュを上書きせずそのまま待機者を解決し、未格納分のみ `relStart = entry.localHeaderOffset - batch.rangeOffset`, `relEnd = Math.min(coalescedBuf.byteLength, entry.physicalEnd - batch.rangeOffset)` のスライスから `extractCompressedSliceFromBuffer` を実行して `l2Cache.put(entry.pageIndex, slice, { allowOversized: false })` へ格納し、In-Flight 待機者へ解決通知する。
   - 一部エントリで `CORRUPT_ZIP` 等が発生しても同一バッチ内の他エントリの L2 格納は継続し、通信失敗（`READ_ERROR`）や `AbortError` 時も未処理例外を送出せず、`finally`（および `abort` イベント時）で未解決の全 In-Flight 待機者に漏れなく `null` を解決通知してマップから除去する（Fast-Path 側の通常処理へ安全に委譲する）。

### 3.4 `CoordinatorCore`・`coordinator.worker.ts` 統合 ＆ `ReaderPage` 先読み配線（`AC-ENG-07`, `AC-ENG-14`, `AC-RD-05`）

1. **`CoordinatorWorkerApi.requestVisiblePages` 契約拡張と Worker ブートストラップ中継**:
   - `RequestVisiblePagesOptions`: `{ readonly visiblePageIndices?: readonly number[] }` を `src/engine/types.ts` に追加し、`requestVisiblePages(pageIndices, prefetchIndices, epoch, options?)` とする（`options` 省略時は `visiblePageIndices = pageIndices` として既存呼び出しと完全互換）。
   - `src/engine/workers/coordinator.worker.ts` の `requestVisiblePages(pageIndices, prefetchIndices, epoch, options)` も第 4 引数 `options` をそのまま `core.requestVisiblePages(pageIndices, prefetchIndices, epoch, options)` へ条件分岐ゼロで透過中継する（中継漏れによる `visiblePageIndices` 消失を防止）。
2. **`CoordinatorCore` の L2 ヒット・In-Flight 同期無効化共有・Epoch 制御**:
   - `openArchive` 時のリセットおよび `closeArchive` 時に `l2Cache.clear()` と進行中全 I/O・`inflightPageReads` を全破棄する。
   - `InflightPageRead` は `{ epoch, signal, promise, consumerCount }` を保持し、対応する `AbortController` の `abort` イベントリスナー（`{ once: true }`）および `finally` により、**`abort()` 発火と同期的（`LocalFileReader` の `arrayBuffer()` 完了を待たず即座）に `inflightPageReads` から該当エントリを削除して `promise` を `null` 解決** する。これにより新世代 Fast-Path が旧世代の 10MB 読込完了待ちでブロックされることを防ぐ。
   - `requestVisiblePages` 開始時（`epoch >= minActiveEpoch` かつ `activeReader !== null`）：
     - 古い世代（`activePrefetchEpoch < epoch`）の進行中 Warm Prefetch があれば即座に `abort()` して帯域と旧 `inflightPageReads` を解放する。
     - `effectiveVisible = options?.visiblePageIndices ?? pageIndices` で `l2Cache.setPinnedPages(effectiveVisible)` を更新する（前ページの 80MB 超一時保持があればここで即時退避される）。
     - `pageIndices` の各ページ取得（`fetchPageSlice`）では、① `l2Cache.get(pageIndex)` ヒット時は `readRange` ゼロで即時 Decode Worker へ投入、② `inflightPageReads` に **同一世代かつ未中断（`inflight.epoch === epoch && !inflight.signal.aborted`）** の進行中取得があればその完了を待機（複数待機者共有時は `markSharedBuffer` 保護、`null` 解決かつ自身の `signal` が未中断の場合のみ直接 `readCompressedPageSlice` へフォールバック）、③ いずれも無ければ（`compressedSize <= l2Cache.maxBytes` なら同世代 `inflightPageReads` へ登録しつつ）`readCompressedPageSlice` を実行して `l2Cache.put(pageIndex, slice, { allowOversized: isVisiblePage })` に格納した上で Decode Worker へ投入する。
     - `pageIndices` のデコード完了後（`pageIndices.length === 0` の L2 補充呼び出し時を含む）、未中断かつ `prefetchIndices.length > 0` かつ当該 `epoch` で Warm Prefetch 未実行の場合、新たな `AbortController` を `inflightAbortControllers`（該当 `epoch`）に登録し、全計画バッチの `inflightPageReads` 先行登録を同期実行した上でバックグラウンド Warm Prefetch を非同期起動し、RPC 自体は待たずに `DecodedPageFrame[]` を即座に返却する。
   - `cancelEpochBelow(minActiveEpoch)` 呼び出し時、`minActiveEpoch` 未満の Fast-Path および Warm Prefetch 双方の `AbortController.abort()` が即時発火され、対応する旧世代 `inflightPageReads` も同期的にクリアされる。
3. **`ReaderPage` の先読み候補構築と L1 近傍バッチ要求**:
   - `buildPrefetchTargets(pageIndex, totalPages)`: 進行方向 `[pageIndex + 1 .. pageIndex + 20]` に続けて逆方向 `[pageIndex - 1, pageIndex - 2]`（`0 <= idx < totalPages`）を返す。
   - 共通ヘルパ `fetchAndStorePages` は常に第 4 引数 `{ visiblePageIndices: [pageIndex] }` を明示付与して `requestVisiblePages` を呼び出す：
     - `pageIndex` が L1 未ヒットの場合: `await fetchAndStorePages(runtime, [pageIndex], prefetchTargets, epoch, protectedPages, [pageIndex])` を実行（Fast-Path 完了と同時に当該 `epoch` の Warm Prefetch が起動される）。続く L1 未保持近傍 `missingNeighbors` が非空の場合は `void fetchAndStorePages(runtime, missingNeighbors, [], epoch, protectedPages, [pageIndex])` を 1 バッチで呼び出す。
     - `pageIndex` が L1 ヒットの場合: 即座に `setCurrentFrame(cached)` した上で、`missingNeighbors.length > 0 || prefetchTargets.length > 0` であれば `void fetchAndStorePages(runtime, missingNeighbors, prefetchTargets, epoch, protectedPages, [pageIndex])` を 1 回呼び出し、L1 近傍補充（L2 0RTT デコード）と L2 Warm Prefetch 補充・表示ピン更新を一括実行する。

---

## 4. テスト計画（UT / VRT / IT）

| 層                                              | テスト手法・対象                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 合格基準                                                    |
| :---------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------- |
| **MK-1: Cache・Transfer・Prefetch Engine UT**   | `coordinatorTransfer.test.ts`（`markSharedBuffer` / `isSharedBuffer` / `options.shared` 時の `slice()` 強制複製と非共有 `byteOffset === 0` の Zero-Copy 維持）、`L2ByteCache.test.ts`（80MB 境界 LRU 退避、`get` による MRU 昇格、`subarray` 入力の独立 `ArrayBuffer` 正規化＋`markSharedBuffer` 付与、`allowOversized` による 80MB 超表示中 1 件保持・複数表示ページ並列格納時や背景格納時の `hasOversizedPinnedEntry` 決定論的スキップ・`setPinnedPages` 移動時の即時退避）、`zipParser.test.ts`（共通 LFH ヘルパ境界）、`AdaptivePrefetcher.test.ts`（優先順 10MB 選抜打ち切り、単一 10MB 超〜80MB 単独許容、80MB 超除外、物理オフセット昇順、64KB 境界 `65536` 結合 vs `65537` 分割、ギャップ込み 10MB 超過分割、全バッチ先行 In-Flight コールバック連携、末尾 LFH >1KB ケース 2a/2b 補完、一部破損時正常分救済、`READ_ERROR` / `AbortSignal` 安全停止） | C0 / C1 / Functions / Lines **100%** PASS                   |
| **MK-2: Coordinator 統合・ReaderPage UT / VRT** | `CoordinatorCore.test.ts`（L2 ヒット時 `readRange` 0 回デコード、実 `structuredClone(..., { transfer })` デタッチ模擬下での `HO-03` L2 再デコード成功、64KB 超ギャップ複数バッチ分割時を含む同世代 Warm Prefetch と L1 近傍要求の先行 In-Flight 共有による重複 `readRange` ゼロ、遅延 `readRange` 中の `cancelEpochBelow` 発火時に新世代 Fast-Path が旧世代完了を待たず即時単独取得を開始する非ブロッキング検証、Warm Prefetch 失敗時の Fast-Path フォールバック、空 `pageIndices` での L2 補充、1 `epoch` 1 回制限、80MB 超ページのピン移動退避、`openArchive` / `closeArchive` での L2 全破棄）、`ReaderPage.test.tsx`（`+1..+20` / `-1..-2` `prefetchIndices` と常時 `{ visiblePageIndices: [N] }` の RPC 呼び出し契約、L1 ミス時・L1 ヒット時・L1 全ヒット時、近傍バッチエラー格納）                                                                     | C0 / C1 / Functions / Lines **100%** PASS ＆ VRT 62/62 PASS |
| **Step 4: Playwright IT (`SCN-02`)**            | `test/it/local-reader.spec.ts` に 7 ページ以上（`L1_MAX_PAGES = 5` 超過）の合成アーカイブを用いた連続順送り（`0 → 6` で先頭ページを L1 から確実に退避）→ 先頭までの連続逆戻り（`6 → 0` で実 `coordinator.worker.ts`［第 4 引数 `options` 中継含む］＋ `Comlink.transfer` 越しに `L2ByteCache` から再デコードされ、`HO-03` バッファデタッチ破壊なくピクセル色が完全一致すること）および高速連続めくり（Epoch キャンセル）シナリオを追加し、全 IT シナリオ回帰実行                                                                                                                                                                                                                                                                                                                                                                                             | 全 `SCN-01` / `SCN-02` **100% PASS**                        |

---

## 5. 実装 Sub-issue 分割計画（MK 2分割 ＋ 最終 IT）

1. **MK-1: `HO-03` 共有バッファ保護・`L2ByteCache`（80MB LRU）・`AdaptivePrefetcher`（10MB 予算・64KB ギャップ結合）実装（Engine 層）**:
   - 対象: `src/engine/workers/coordinatorTransfer.ts`, `src/engine/cache/L2ByteCache.ts`, `src/engine/zip/zipParser.ts`, `src/engine/prefetch/AdaptivePrefetcher.ts`, 各 `*.test.ts`（および関連仕様書 `related_tests` への新規テストパス追記）
   - 完了条件: TDD（Red → Green → Refactor）、C0/C1/Functions/Lines 100%、Gate 1〜6 完了後に AI 自律マージ（`Closes #Sub-issue`）
2. **MK-2: `CoordinatorCore` / `coordinator.worker.ts` L2・Prefetch・先行 In-Flight・Epoch 統合 ＆ `ReaderPage` 先読み窓・近傍バッチ配線（Worker & UI 層）**:
   - 対象: `src/engine/types.ts`, `src/engine/workers/CoordinatorCore.ts`, `src/engine/workers/coordinator.worker.ts`, `src/features/reader/ReaderPage.tsx`, 各 `*.test.*`
   - 完了条件: TDD（Red → Green → Refactor）、`coordinator.worker.ts` 条件分岐ゼロ維持、親子分離、C0/C1/Functions/Lines 100%、VRT PASS、Gate 1〜6 完了後に AI 自律マージ（`Closes #Sub-issue`）
3. **Step 4 (IT PR): Playwright `SCN-02` L1退避→L2再デコード往復検証・`HO-03` `Resolved` 精算・差分仕様アーカイブ（`Closes #20`）**:
   - 対象: `test/it/helpers.ts`, `test/it/local-reader.spec.ts`, `docs/quality/bug-and-handover-log.md`（`HO-03` → `Resolved`）, 本差分仕様書の `Completed (Archived)` 化 ＆ `docs/specs/changes/archive/` 移動
   - 完了条件: 全 IT PASS、Gate 1〜6 完了後に **人間レビュー・マージ** で親 Issue `#20` をクローズ

---

## 6. 申し送り事項・Android 実機検証計画

- **判定（[workflow.md §2.2](../../guidelines/workflow.md#22-android-実機検証の実施判断基準と試験項目表フォーマット)）**: **区分 B（Milestone `v0.1` 完了前に一括実施）**
  - **根拠**: Coordinator Worker 内のオンメモリ LRU キャッシュ・Range 結合プランナー・Epoch キャンセルおよび `ReaderPage` の RPC 引数配線であり、Android ネイティブ層・Google OAuth・WebGL2 シェーダー・物理ジェスチャー操作の新設・変更を含まないため。
- **申し送り事項管理**:
  - **`HO-03`**（既存 `Open`）: 本 Issue `#20` の MK-1 / MK-2 で実装し、Step 4 最終 IT PR（実 Worker 間 `Comlink.transfer` 往復検証 PASS）にて `Open` → `Resolved` へ精算する。
  - **`HO-06`**（新規登録・状態: `Open`、完了ゲート: `Milestone v0.1 完了前`）: Milestone `v0.1` 完了時の一括実機検証にて以下を確認する：
    1. 10 ページ以上のローカル `.zip` / `.cbz` を開き、連続めくりおよび前後往復（L1 5 ページ退避後の再表示）を行ってもデコードエラー・黒画面・WebView OOM クラッシュが発生せず即座に描画されること。
    2. 高速連続タップ／スワイプめくり時に表示ページの追従が詰まらず、不要なエラーログが診断ロガーに記録されないこと。
