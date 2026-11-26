import { describe, expect, it } from "vitest";
import type {
  ReadingProgressRecord,
  SeriesRecord,
  VolumeRecord,
} from "../../storage/types";
import {
  buildBookshelfSeriesItems,
  buildSeriesDetailViewModel,
  computeProgressPercent,
  formatByteSize,
  formatSyncTimestamp,
  isOmnibusVolume,
  resolveQuickLaunchVolume,
  resolveRepresentativeVolume,
  sortBookshelfSeriesItems,
} from "./bookshelfViewModel";

function createSeries(
  id: string,
  overrides: Partial<SeriesRecord> = {},
): SeriesRecord {
  return {
    id,
    title: `作品 ${id}`,
    titleReading: `さくひん ${id}`,
    authors: ["著者A"],
    publisher: "",
    label: "",
    tags: [],
    synopsis: "",
    publicationStatus: "unknown",
    knownTotalVolumes: null,
    externalIds: {},
    metadataLocked: false,
    representativeVolumeId: null,
    readerPresetJson: null,
    lastReadAt: null,
    addedAt: 1_000,
    updatedAt: 1_000,
    deletedAt: null,
    ...overrides,
  };
}

function createVolume(
  id: string,
  seriesId: string,
  overrides: Partial<VolumeRecord> = {},
): VolumeRecord {
  return {
    id,
    seriesId,
    volumeNumber: 1,
    volumeLabel: "第01巻",
    rawFileName: `${seriesId}_${id}.cbz`,
    driveFileId: `drive-${id}`,
    parentFolderId: "root-1",
    rootFolderId: "root-1",
    fileSize: 1024 * 500,
    md5Checksum: "md5-1",
    driveModifiedTime: 1_000,
    coverBlob: null,
    coverStatus: "pending",
    coverCropMode: "auto",
    coverPageIndex: 0,
    coverUpdatedAt: null,
    isTrashed: 0,
    addedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function createProgress(
  volumeId: string,
  overrides: Partial<ReadingProgressRecord> = {},
): ReadingProgressRecord {
  return {
    targetKey: `vol:${volumeId}`,
    volumeId,
    currentPageIndex: 0,
    totalPageCount: 20,
    readStatus: "reading",
    spreadPageOffset: 0,
    lastReadAt: 2_000,
    updatedAt: 2_000,
    ...overrides,
  };
}

describe("bookshelfViewModel", () => {
  it("isOmnibusVolumeが合本ラベルを判定すること (AC-SD-02)", () => {
    expect(isOmnibusVolume({ volumeLabel: "第01-05巻 合本" })).toBe(true);
    expect(isOmnibusVolume({ volumeLabel: "第01巻" })).toBe(false);
    expect(isOmnibusVolume({ volumeLabel: "単巻" })).toBe(false);
  });

  it("resolveRepresentativeVolumeがrepresentativeVolumeId優先・不在時は先頭巻・空配列時はnullを返すこと (AC-BS-12)", () => {
    const v1 = createVolume("v1", "s1", { volumeNumber: 1 });
    const v2 = createVolume("v2", "s1", { volumeNumber: 2 });

    expect(
      resolveRepresentativeVolume({ representativeVolumeId: null }, []),
    ).toBeNull();
    expect(
      resolveRepresentativeVolume({ representativeVolumeId: "v2" }, [v1, v2]),
    ).toBe(v2);
    expect(
      resolveRepresentativeVolume({ representativeVolumeId: "v-missing" }, [
        v1,
        v2,
      ]),
    ).toBe(v1);
    expect(
      resolveRepresentativeVolume({ representativeVolumeId: null }, [v1, v2]),
    ).toBe(v1);
  });

  it("resolveQuickLaunchVolumeが①最新reading(同値先頭)→②最小未読了(0冊/1冊以上)→③全読了先頭巻を決定論的に選ぶこと (AC-BS-11, AC-SD-03)", () => {
    const v1 = createVolume("v1", "s1", {
      volumeNumber: 1,
      volumeLabel: "第01巻",
    });
    const v2 = createVolume("v2", "s1", {
      volumeNumber: 2,
      volumeLabel: "第02巻",
    });
    const v3 = createVolume("v3", "s1", {
      volumeNumber: 3,
      volumeLabel: "第03巻",
    });

    // 空配列は null
    expect(resolveQuickLaunchVolume([], new Map())).toBeNull();

    // 全未読（進捗なし / unread） -> 先頭巻「読む」「読み始める」
    const allUnread = resolveQuickLaunchVolume(
      [v1, v2],
      new Map([["v1", createProgress("v1", { readStatus: "unread" })]]),
    );
    expect(allUnread).toEqual({
      volume: v1,
      kind: "start",
      bookshelfLabel: "読む (第01巻)",
      seriesDetailLabel: "読み始める（第01巻）",
    });

    // 1巻読了・2巻未読 -> 「次を読む」
    const nextUnread = resolveQuickLaunchVolume(
      [v1, v2, v3],
      new Map([["v1", createProgress("v1", { readStatus: "completed" })]]),
    );
    expect(nextUnread).toEqual({
      volume: v2,
      kind: "next",
      bookshelfLabel: "次を読む (第02巻)",
      seriesDetailLabel: "次を読む（第02巻）",
    });

    // 複数 reading -> lastReadAt 最大の巻を選択
    const latestReading = resolveQuickLaunchVolume(
      [v1, v2, v3],
      new Map([
        [
          "v1",
          createProgress("v1", { readStatus: "reading", lastReadAt: 5_000 }),
        ],
        [
          "v2",
          createProgress("v2", { readStatus: "reading", lastReadAt: 9_000 }),
        ],
      ]),
    );
    expect(latestReading).toEqual({
      volume: v2,
      kind: "continue",
      bookshelfLabel: "続きを読む (第02巻)",
      seriesDetailLabel: "続きを読む（第02巻）",
    });

    // 複数 reading の lastReadAt 同値時は巻順先頭を優先
    const tiedReading = resolveQuickLaunchVolume(
      [v1, v2],
      new Map([
        [
          "v1",
          createProgress("v1", { readStatus: "reading", lastReadAt: 7_000 }),
        ],
        [
          "v2",
          createProgress("v2", { readStatus: "reading", lastReadAt: 7_000 }),
        ],
      ]),
    );
    expect(tiedReading?.volume).toBe(v1);

    // 全巻 completed -> 先頭巻「最初から読む」
    const allCompleted = resolveQuickLaunchVolume(
      [v1, v2],
      new Map([
        ["v1", createProgress("v1", { readStatus: "completed" })],
        ["v2", createProgress("v2", { readStatus: "completed" })],
      ]),
    );
    expect(allCompleted).toEqual({
      volume: v1,
      kind: "reread",
      bookshelfLabel: "最初から読む",
      seriesDetailLabel: "最初から読む（第01巻）",
    });
  });

  it("computeProgressPercentがcompleted時100%、それ以外は0〜100%へ丸めて返すこと", () => {
    expect(
      computeProgressPercent({
        readStatus: "completed",
        currentPageIndex: 0,
        totalPageCount: 10,
      }),
    ).toBe(100);
    expect(
      computeProgressPercent({
        readStatus: "reading",
        currentPageIndex: 4,
        totalPageCount: 20,
      }),
    ).toBe(25);
    expect(
      computeProgressPercent({
        readStatus: "reading",
        currentPageIndex: 19,
        totalPageCount: 20,
      }),
    ).toBe(100);
  });

  it("buildBookshelfSeriesItemsがTombstone・空シリーズ・ゴミ箱巻を除外し、シリーズ状態・代表表紙・クイック起動を集約すること (AC-BS-09, AC-BS-11)", () => {
    const activeUnread = createSeries("s-unread", {
      title: "未読作品",
      titleReading: "みどくさくひん",
      addedAt: 1_000,
    });
    const activeReading = createSeries("s-reading", {
      title: "読書中作品",
      titleReading: "どくしょちゅう",
      representativeVolumeId: "v-r2",
      lastReadAt: 8_000,
      addedAt: 2_000,
    });
    const activeCompleted = createSeries("s-done", {
      title: "読了作品",
      titleReading: "どくりょう",
      lastReadAt: 9_000,
      addedAt: 3_000,
    });
    const activeInProgressOnly = createSeries("s-in-progress", {
      title: "途中読書作品",
      titleReading: "とちゅう",
      lastReadAt: 7_500,
      addedAt: 2_800,
    });
    const emptySeries = createSeries("s-empty");
    const tombstonedSeries = createSeries("s-deleted", { deletedAt: 5_000 });

    const visibleVolumes: VolumeRecord[] = [
      createVolume("v-u1", "s-unread", {
        volumeNumber: 1,
        volumeLabel: "第01巻",
        addedAt: 1_500,
      }),
      // 意図的に逆順で渡して内部ソートを検証
      createVolume("v-r2", "s-reading", {
        volumeNumber: 2,
        volumeLabel: "第02巻",
        addedAt: 2_500,
      }),
      createVolume("v-r1", "s-reading", {
        volumeNumber: 1,
        volumeLabel: "第01巻",
        addedAt: 2_100,
      }),
      createVolume("v-trashed", "s-unread", {
        volumeNumber: 2,
        isTrashed: 1,
      }),
      createVolume("v-d1", "s-done", {
        volumeNumber: 1,
        volumeLabel: "単巻",
        addedAt: 3_100,
      }),
      createVolume("v-p1", "s-in-progress", {
        volumeNumber: 1,
        volumeLabel: "第01巻",
        addedAt: 2_900,
      }),
      createVolume("v-del1", "s-deleted", {
        volumeNumber: 1,
      }),
    ];

    const progress = new Map<string, ReadingProgressRecord>([
      ["v-r1", createProgress("v-r1", { readStatus: "completed" })],
      ["v-d1", createProgress("v-d1", { readStatus: "completed" })],
      ["v-p1", createProgress("v-p1", { readStatus: "reading" })],
    ]);

    const items = buildBookshelfSeriesItems({
      seriesList: [
        activeUnread,
        activeReading,
        activeCompleted,
        activeInProgressOnly,
        emptySeries,
        tombstonedSeries,
      ],
      visibleVolumes,
      progressByVolumeId: progress,
    });

    expect(items.map((item) => item.seriesId)).toEqual([
      "s-unread",
      "s-reading",
      "s-done",
      "s-in-progress",
    ]);

    expect(items[0]).toMatchObject({
      seriesId: "s-unread",
      volumeCount: 1,
      completedCount: 0,
      readStatus: "unread",
      latestVolumeAddedAt: 1_500,
      quickLaunchVolumeId: "v-u1",
      quickLaunchLabel: "読む (第01巻)",
    });
    expect(items[1]).toMatchObject({
      seriesId: "s-reading",
      volumeCount: 2,
      completedCount: 1,
      readStatus: "reading",
      latestVolumeAddedAt: 2_500,
      quickLaunchVolumeId: "v-r2",
      quickLaunchLabel: "次を読む (第02巻)",
    });
    expect(items[1]?.representativeVolume.id).toBe("v-r2");

    expect(items[2]).toMatchObject({
      seriesId: "s-done",
      volumeCount: 1,
      completedCount: 1,
      readStatus: "completed",
      quickLaunchVolumeId: "v-d1",
      quickLaunchLabel: "最初から読む",
    });

    expect(items[3]).toMatchObject({
      seriesId: "s-in-progress",
      volumeCount: 1,
      completedCount: 0,
      readStatus: "reading",
      quickLaunchVolumeId: "v-p1",
      quickLaunchLabel: "続きを読む (第01巻)",
    });
  });

  it("sortBookshelfSeriesItemsが4軸すべてで入力配列を破壊せず決定論的タイブレーク付きでソートすること (AC-BS-10)", () => {
    const vBase = createVolume("v0", "s0");
    const makeItem = (
      id: string,
      overrides: Partial<
        ReturnType<typeof buildBookshelfSeriesItems>[number]
      > = {},
    ) => ({
      seriesId: id,
      title: `作品${id}`,
      titleReading: `さくひん${id}`,
      authors: [],
      volumeCount: 1,
      completedCount: 0,
      readStatus: "unread" as const,
      lastReadAt: null,
      latestVolumeAddedAt: 1_000,
      seriesAddedAt: 1_000,
      representativeVolume: vBase,
      quickLaunchVolumeId: "v0",
      quickLaunchLabel: "読む (第01巻)",
      ...overrides,
    });

    const a = makeItem("s-a", {
      title: "Bタイトル",
      titleReading: "あ",
      volumeCount: 2,
      lastReadAt: 5_000,
      latestVolumeAddedAt: 1_000,
      seriesAddedAt: 1_000,
    });
    const b = makeItem("s-b", {
      title: "Aタイトル",
      titleReading: "あ",
      volumeCount: 5,
      lastReadAt: 9_000,
      latestVolumeAddedAt: 2_000,
      seriesAddedAt: 1_500,
    });
    const c = makeItem("s-c", {
      title: "Cタイトル",
      titleReading: "い",
      volumeCount: 5,
      lastReadAt: null,
      latestVolumeAddedAt: 4_000,
      seriesAddedAt: 1_000,
    });
    const d = makeItem("s-d", {
      title: "Dタイトル",
      titleReading: "い",
      volumeCount: 2,
      lastReadAt: null,
      latestVolumeAddedAt: 4_000,
      seriesAddedAt: 3_000,
    });
    const e1 = makeItem("s-e2", {
      title: "同タイトル",
      titleReading: "う",
      volumeCount: 1,
      lastReadAt: 5_000,
      latestVolumeAddedAt: 1_000,
      seriesAddedAt: 1_000,
    });
    const e2 = makeItem("s-e1", {
      title: "同タイトル",
      titleReading: "う",
      volumeCount: 1,
      lastReadAt: 5_000,
      latestVolumeAddedAt: 1_000,
      seriesAddedAt: 1_000,
    });

    const input = [a, b, c, d, e1, e2];

    // 1. lastReadDesc: lastReadAt 非null降順 -> 同値時は addedDesc -> title -> id、null は末尾で addedDesc
    expect(
      sortBookshelfSeriesItems(input, "lastReadDesc").map((i) => i.seriesId),
    ).toEqual(["s-b", "s-a", "s-e1", "s-e2", "s-d", "s-c"]);

    // 2. addedDesc: latestVolumeAddedAt 降順 -> seriesAddedAt 降順 -> titleReading -> title -> id
    expect(
      sortBookshelfSeriesItems(input, "addedDesc").map((i) => i.seriesId),
    ).toEqual(["s-d", "s-c", "s-b", "s-a", "s-e1", "s-e2"]);

    // 3. titleAsc: titleReading 昇順 -> title 昇順 -> seriesId 昇順
    expect(
      sortBookshelfSeriesItems(input, "titleAsc").map((i) => i.seriesId),
    ).toEqual(["s-b", "s-a", "s-c", "s-d", "s-e1", "s-e2"]);

    // 4. volumeCountDesc: volumeCount 降順 -> titleReading -> title -> id
    expect(
      sortBookshelfSeriesItems(input, "volumeCountDesc").map((i) => i.seriesId),
    ).toEqual(["s-b", "s-c", "s-a", "s-d", "s-e1", "s-e2"]);

    // 入力配列が破壊されていないこと
    expect(input.map((i) => i.seriesId)).toEqual([
      "s-a",
      "s-b",
      "s-c",
      "s-d",
      "s-e2",
      "s-e1",
    ]);
  });

  it("buildSeriesDetailViewModelがTombstone・無効ルート・ゴミ箱巻を除外し、巻詳細とクイック起動を構築すること (AC-SD-01, AC-SD-02, AC-SD-04)", () => {
    const series = createSeries("s1", {
      title: "テスト作品",
      representativeVolumeId: "v2",
    });
    const enabledRoots = new Set(["root-1"]);

    // 1. series が null または deletedAt !== null (Tombstone) -> null
    expect(
      buildSeriesDetailViewModel({
        series: null,
        volumes: [],
        enabledRootIds: enabledRoots,
        progressByVolumeId: new Map(),
      }),
    ).toBeNull();
    expect(
      buildSeriesDetailViewModel({
        series: createSeries("s1", { deletedAt: 1_234 }),
        volumes: [createVolume("v1", "s1")],
        enabledRootIds: enabledRoots,
        progressByVolumeId: new Map(),
      }),
    ).toBeNull();

    // 2. 有効巻 0 件（ゴミ箱・無効ルート・他シリーズのみ）-> null
    expect(
      buildSeriesDetailViewModel({
        series,
        volumes: [
          createVolume("v-trashed", "s1", { isTrashed: 1 }),
          createVolume("v-disabled", "s1", { rootFolderId: "root-disabled" }),
          createVolume("v-other", "s-other"),
        ],
        enabledRootIds: enabledRoots,
        progressByVolumeId: new Map(),
      }),
    ).toBeNull();

    // 3. 正常構築（合本判定・ファイルサイズ・進捗・ソート順）
    const v2 = createVolume("v2", "s1", {
      volumeNumber: 1,
      volumeLabel: "第01-03巻 合本",
      fileSize: 1024 * 1024 * 12,
    });
    const v1 = createVolume("v1", "s1", {
      volumeNumber: 1,
      volumeLabel: "第01巻",
      fileSize: 2048,
    });
    const v3 = createVolume("v3", "s1", {
      volumeNumber: 2,
      volumeLabel: "第02巻",
      fileSize: 4096,
    });
    const progress = new Map<string, ReadingProgressRecord>([
      [
        "v1",
        createProgress("v1", {
          currentPageIndex: 9,
          totalPageCount: 20,
          readStatus: "reading",
        }),
      ],
      [
        "v3",
        createProgress("v3", {
          currentPageIndex: 19,
          totalPageCount: 20,
          readStatus: "completed",
        }),
      ],
    ]);

    const vm = buildSeriesDetailViewModel({
      series,
      volumes: [v3, v2, v1],
      enabledRootIds: enabledRoots,
      progressByVolumeId: progress,
    });

    expect(vm).not.toBeNull();
    expect(vm?.series).toBe(series);
    expect(vm?.representativeVolume).toBe(v2);
    expect(vm?.volumeCount).toBe(3);
    expect(vm?.completedCount).toBe(1);
    expect(vm?.quickLaunch).toEqual({
      volume: v1,
      kind: "continue",
      bookshelfLabel: "続きを読む (第01巻)",
      seriesDetailLabel: "続きを読む（第01巻）",
    });
    expect(vm?.volumes).toHaveLength(3);
    expect(vm?.volumes[0]).toMatchObject({
      volume: v1,
      isOmnibus: false,
      fileSizeLabel: "2.0 KB",
      readStatus: "reading",
      progressPercent: 50,
    });
    expect(vm?.volumes[1]).toMatchObject({
      volume: v2,
      isOmnibus: true,
      fileSizeLabel: "12.0 MB",
      readStatus: "unread",
      progress: null,
      progressPercent: null,
    });
    expect(vm?.volumes[2]).toMatchObject({
      volume: v3,
      isOmnibus: false,
      fileSizeLabel: "4.0 KB",
      readStatus: "completed",
      progressPercent: 100,
    });
  });

  it("formatSyncTimestampがAsia/Tokyo固定および指定タイムゾーンでYYYY/MM/DD HH:mm形式へ決定論的に整形すること", () => {
    // 2026-11-25T15:00:00.000Z === 2026-11-26 00:00 Asia/Tokyo (00:00 境界テスト)
    const midnightJst = Date.UTC(2026, 10, 25, 15, 0, 0);
    expect(formatSyncTimestamp(midnightJst)).toBe("2026/11/26 00:00");
    expect(formatSyncTimestamp(midnightJst, "UTC")).toBe("2026/11/25 15:00");

    // 2026-01-02T03:04:00.000Z === 2026-01-02 12:04 Asia/Tokyo
    const daytimeJst = Date.UTC(2026, 0, 2, 3, 4, 0);
    expect(formatSyncTimestamp(daytimeJst)).toBe("2026/01/02 12:04");
  });

  it("formatByteSizeがB/KB/MB/GBおよび非正・非有限値を人間可読形式へ整形すること", () => {
    expect(formatByteSize(-5)).toBe("0 B");
    expect(formatByteSize(Number.NaN)).toBe("0 B");
    expect(formatByteSize(0)).toBe("0 B");
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(1024)).toBe("1.0 KB");
    expect(formatByteSize(1024 * 1024 * 2.5)).toBe("2.5 MB");
    expect(formatByteSize(1024 * 1024 * 1024 * 1.25)).toBe("1.3 GB");
  });
});
