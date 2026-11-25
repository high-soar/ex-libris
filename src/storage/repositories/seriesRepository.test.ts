import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetTestDb } from "../db";
import type { SeriesRecord } from "../types";
import { DexieSeriesRepository, isValidSeriesRecord } from "./seriesRepository";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createValidSeries(
  overrides: Partial<SeriesRecord> = {},
): SeriesRecord {
  return {
    id: "series-1",
    title: "ワンピース",
    titleReading: "わんぴーす",
    authors: ["尾田栄一郎"],
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
    addedAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    ...overrides,
  };
}

describe("DexieSeriesRepository", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDb();
  });

  it("findOrCreateByParsedTitleで新規作成・正規化タイトル名寄せ・未ロック著者マージ・ロック保護・updatedAt非汚染が正しく動作すること (AC-GD-11)", async () => {
    let clock = 1000;
    let seq = 0;
    const repo = new DexieSeriesRepository(db, {
      now: () => clock,
      idGenerator: () => {
        seq += 1;
        return `series-gen-${seq}`;
      },
    });

    // 空白のみのタイトルは拒否すること
    await expect(
      repo.findOrCreateByParsedTitle({
        title: "   ",
        titleReading: "",
        authors: [],
      }),
    ).rejects.toThrow();

    // 初回作成（titleReading 空時は title フォールバック、authors はトリム＋重複排除）
    const created = await repo.findOrCreateByParsedTitle({
      title: "  Ｒｅ：ゼロ〜異世界生活  ",
      titleReading: "   ",
      authors: [" 長月達平 ", "", "長月達平"],
    });
    expect(created).toEqual({
      id: "series-gen-1",
      title: "Ｒｅ：ゼロ〜異世界生活",
      titleReading: "Ｒｅ：ゼロ〜異世界生活",
      authors: ["長月達平"],
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
      addedAt: 1000,
      updatedAt: 1000,
      deletedAt: null,
    });

    // 正規化キー一致（半角/全角・波ダッシュ揺れ）で既存へ名寄せ＋未ロック著者マージ（updatedAt は変更しない）
    clock = 2500;
    const matchedWithNewAuthor = await repo.findOrCreateByParsedTitle({
      title: "re:ゼロ～異世界生活",
      titleReading: "re:ぜろ～いせかいせいかつ",
      authors: ["長月達平", "大塚真一郎"],
    });
    expect(matchedWithNewAuthor.id).toBe("series-gen-1");
    expect(matchedWithNewAuthor.authors).toEqual(["長月達平", "大塚真一郎"]);
    expect(matchedWithNewAuthor.addedAt).toBe(1000);
    expect(matchedWithNewAuthor.updatedAt).toBe(1000);

    // 既存著者のみで差分がない場合はそのまま返却し updatedAt も変更しないこと
    clock = 3000;
    const matchedNoDiff = await repo.findOrCreateByParsedTitle({
      title: "Re:ゼロ~異世界生活",
      titleReading: "re:ぜろ~いせかいせいかつ",
      authors: ["大塚真一郎"],
    });
    expect(matchedNoDiff.id).toBe("series-gen-1");
    expect(matchedNoDiff.authors).toEqual(["長月達平", "大塚真一郎"]);
    expect(matchedNoDiff.updatedAt).toBe(1000);

    // metadataLocked === true の場合は新規著者をマージせず保護すること
    await db.series.put({
      ...matchedNoDiff,
      metadataLocked: true,
      updatedAt: 3200,
    });
    clock = 4000;
    const lockedMatch = await repo.findOrCreateByParsedTitle({
      title: "re:ゼロ~異世界生活",
      titleReading: "re:ぜろ~いせかいせいかつ",
      authors: ["新規作画者"],
    });
    expect(lockedMatch.authors).toEqual(["長月達平", "大塚真一郎"]);
    expect(lockedMatch.updatedAt).toBe(3200);

    // deletedAt !== null の論理削除済みシリーズには名寄せせず新規作成すること
    await db.series.put({
      ...lockedMatch,
      deletedAt: 4100,
    });
    clock = 5000;
    const recreated = await repo.findOrCreateByParsedTitle({
      title: "Re:ゼロ~異世界生活",
      titleReading: "re:ぜろ~いせかいせいかつ",
      authors: ["長月達平"],
    });
    expect(recreated.id).toBe("series-gen-2");
    expect(recreated.titleReading).toBe("re:ぜろ~いせかいせいかつ");
    expect(recreated.addedAt).toBe(5000);
    expect(recreated.updatedAt).toBe(5000);
  });

  it("getById・listActive（addedAt昇順・id昇順）・mergeAuthorsIfUnlocked・updateLastReadAtがupdatedAt非汚染で動作すること", async () => {
    const repo = new DexieSeriesRepository();

    await db.series.bulkPut([
      createValidSeries({
        id: "s-b",
        title: "作品B",
        addedAt: 2000,
        updatedAt: 2000,
      }),
      createValidSeries({
        id: "s-a",
        title: "作品A",
        addedAt: 2000,
        updatedAt: 2000,
      }),
      createValidSeries({
        id: "s-0",
        title: "作品0",
        addedAt: 1000,
        updatedAt: 1000,
      }),
      createValidSeries({
        id: "s-deleted",
        title: "削除済み",
        addedAt: 500,
        updatedAt: 500,
        deletedAt: 900,
      }),
    ]);

    expect((await repo.listActive()).map((s) => s.id)).toEqual([
      "s-0",
      "s-a",
      "s-b",
    ]);

    expect(await repo.getById("  ")).toBeNull();
    expect(await repo.getById("missing")).toBeNull();
    expect((await repo.getById(" s-a "))?.title).toBe("作品A");
    expect((await repo.getById("s-deleted"))?.deletedAt).toBe(900);

    // mergeAuthorsIfUnlocked: 未ロック時は重複排除追加し updatedAt 非汚染
    const merged = await repo.mergeAuthorsIfUnlocked(" s-a ", [
      "尾田栄一郎",
      " 共同著者 ",
      "共同著者",
      "   ",
    ]);
    expect(merged?.authors).toEqual(["尾田栄一郎", "共同著者"]);
    expect(merged?.updatedAt).toBe(2000);

    // 変化なし・空著者配列・未存在・空ID・削除済み・ロック済み
    expect(
      (await repo.mergeAuthorsIfUnlocked("s-a", ["共同著者"]))?.authors,
    ).toEqual(["尾田栄一郎", "共同著者"]);
    expect(
      (await repo.mergeAuthorsIfUnlocked("s-a", ["   "]))?.authors,
    ).toEqual(["尾田栄一郎", "共同著者"]);
    expect(await repo.mergeAuthorsIfUnlocked("  ", ["著者"])).toBeNull();
    expect(await repo.mergeAuthorsIfUnlocked("missing", ["著者"])).toBeNull();
    expect(await repo.mergeAuthorsIfUnlocked("s-deleted", ["著者"])).toBeNull();

    await db.series.put(
      createValidSeries({
        id: "s-locked",
        metadataLocked: true,
        authors: ["固定著者"],
        updatedAt: 7777,
      }),
    );
    const lockedMerged = await repo.mergeAuthorsIfUnlocked("s-locked", [
      "新著者",
    ]);
    expect(lockedMerged?.authors).toEqual(["固定著者"]);
    expect(lockedMerged?.updatedAt).toBe(7777);

    // updateLastReadAt: lastReadAt のみ更新し updatedAt は非汚染
    const readUpdated = await repo.updateLastReadAt(" s-b ", 9999);
    expect(readUpdated?.lastReadAt).toBe(9999);
    expect(readUpdated?.updatedAt).toBe(2000);

    expect(await repo.updateLastReadAt("   ", 9999)).toBeNull();
    expect(await repo.updateLastReadAt("s-b", Number.NaN)).toBeNull();
    expect(await repo.updateLastReadAt("missing", 9999)).toBeNull();
    expect(await repo.updateLastReadAt("s-deleted", 9999)).toBeNull();

    // デフォルト idGenerator (crypto.randomUUID) で新規作成できること
    const defaultGenerated = await repo.findOrCreateByParsedTitle({
      title: "UUID生成テスト作品",
      titleReading: "uuidせいせいてすとさくひん",
      authors: [],
    });
    expect(defaultGenerated.id.length).toBeGreaterThan(0);
  });

  it("破損レコードをgetById/listActive/findOrCreateByParsedTitle/mergeAuthorsIfUnlocked/updateLastReadAtで除外・自動削除すること", async () => {
    const repo = new DexieSeriesRepository(db);

    const invalidCases: SeriesRecord[] = [
      createValidSeries({ id: "   " }),
      createValidSeries({ id: "bad-title", title: "   " }),
      createValidSeries({
        id: "bad-reading",
        titleReading: 123 as unknown as string,
      }),
      createValidSeries({
        id: "bad-authors",
        authors: ["ok", 1 as unknown as string],
      }),
      createValidSeries({
        id: "bad-authors-nonarray",
        authors: "str" as unknown as string[],
      }),
      createValidSeries({
        id: "bad-publisher",
        publisher: null as unknown as string,
      }),
      createValidSeries({ id: "bad-label", label: null as unknown as string }),
      createValidSeries({ id: "bad-tags", tags: [null as unknown as string] }),
      createValidSeries({
        id: "bad-synopsis",
        synopsis: 0 as unknown as string,
      }),
      createValidSeries({
        id: "bad-status",
        publicationStatus: "hiatus" as SeriesRecord["publicationStatus"],
      }),
      createValidSeries({ id: "bad-total", knownTotalVolumes: -1 }),
      createValidSeries({ id: "bad-total-float", knownTotalVolumes: 1.5 }),
      createValidSeries({
        id: "bad-external",
        externalIds: null as unknown as SeriesRecord["externalIds"],
      }),
      createValidSeries({
        id: "bad-external-array",
        externalIds: [] as unknown as SeriesRecord["externalIds"],
      }),
      createValidSeries({
        id: "bad-locked",
        metadataLocked: "false" as unknown as boolean,
      }),
      createValidSeries({
        id: "bad-rep",
        representativeVolumeId: 10 as unknown as string,
      }),
      createValidSeries({
        id: "bad-preset",
        readerPresetJson: 10 as unknown as string,
      }),
      createValidSeries({ id: "bad-lastReadAt", lastReadAt: Number.NaN }),
      createValidSeries({
        id: "bad-addedAt",
        addedAt: Number.POSITIVE_INFINITY,
      }),
      createValidSeries({ id: "bad-updatedAt", updatedAt: Number.NaN }),
      createValidSeries({
        id: "bad-deletedAt",
        deletedAt: Number.NEGATIVE_INFINITY,
      }),
    ];

    for (const invalid of invalidCases) {
      expect(isValidSeriesRecord(invalid)).toBe(false);
    }
    expect(
      isValidSeriesRecord(
        createValidSeries({
          publicationStatus: "ongoing",
          knownTotalVolumes: 12,
          representativeVolumeId: "vol-1",
          readerPresetJson: "{}",
          lastReadAt: 500,
          deletedAt: 600,
        }),
      ),
    ).toBe(true);
    expect(
      isValidSeriesRecord(
        createValidSeries({ publicationStatus: "completed" }),
      ),
    ).toBe(true);

    await db.series.bulkPut(invalidCases);
    await db.series.put(createValidSeries({ id: "valid-1" }));

    expect((await repo.listActive()).map((s) => s.id)).toEqual(["valid-1"]);
    expect(await db.series.get("bad-title")).toBeUndefined();

    // getById / mergeAuthorsIfUnlocked / updateLastReadAt の個別破損削除
    await db.series.put(createValidSeries({ id: "corrupt-get", title: "" }));
    expect(await repo.getById("corrupt-get")).toBeNull();
    expect(await db.series.get("corrupt-get")).toBeUndefined();

    await db.series.put(createValidSeries({ id: "corrupt-merge", title: "" }));
    expect(
      await repo.mergeAuthorsIfUnlocked("corrupt-merge", ["著者"]),
    ).toBeNull();
    expect(await db.series.get("corrupt-merge")).toBeUndefined();

    await db.series.put(createValidSeries({ id: "corrupt-read", title: "" }));
    expect(await repo.updateLastReadAt("corrupt-read", 1234)).toBeNull();
    expect(await db.series.get("corrupt-read")).toBeUndefined();
  });

  it("全操作がFIFO直列化され前段失敗時も後続キューが停滞しないこと", async () => {
    const repo = new DexieSeriesRepository(db, {
      now: () => 1000,
      idGenerator: () => "fifo-series",
    });

    const txGate = createDeferred<void>();
    const originalTx = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce(((
      ...args: Parameters<typeof db.transaction>
    ) =>
      txGate.promise.then(() =>
        (originalTx as (...inner: unknown[]) => unknown)(...args),
      )) as unknown as typeof db.transaction);

    const order: string[] = [];
    const op1 = repo
      .findOrCreateByParsedTitle({
        title: "FIFO作品",
        titleReading: "fifoさくひん",
        authors: ["著者A"],
      })
      .then(() => {
        order.push("create");
      });
    const op2 = repo
      .mergeAuthorsIfUnlocked("fifo-series", ["著者B"])
      .then(() => {
        order.push("merge");
      });
    const op3 = repo.updateLastReadAt("fifo-series", 5000).then(() => {
      order.push("read");
    });
    const op4 = repo.getById("fifo-series").then((record) => {
      order.push("get");
      return record;
    });

    await Promise.resolve();
    expect(order).toEqual([]);

    txGate.resolve();
    await op1;
    await op2;
    await op3;
    const record = await op4;

    expect(order).toEqual(["create", "merge", "read", "get"]);
    expect(record?.authors).toEqual(["著者A", "著者B"]);
    expect(record?.lastReadAt).toBe(5000);

    // 前段操作失敗後も後続操作が継続すること
    const failGate = createDeferred<never>();
    vi.spyOn(db.series, "toArray").mockImplementationOnce(
      (() => failGate.promise) as unknown as typeof db.series.toArray,
    );
    const failingList = repo.listActive();
    const followingGet = repo.getById("fifo-series");

    failGate.reject(new Error("transient series error"));
    await expect(failingList).rejects.toThrow("transient series error");
    await expect(followingGet).resolves.toMatchObject({ id: "fifo-series" });
  });
});
