import { describe, expect, it } from "vitest";
import type { VolumeRecord } from "../../storage/types";
import {
  resolveRepresentativeVolume,
  sortSeriesItems,
  type SortableSeriesFields,
} from "./seriesOrdering";

function makeVolume(overrides: Partial<VolumeRecord> = {}): VolumeRecord {
  return {
    id: "v-1",
    seriesId: "s-1",
    rootFolderId: "root-1",
    driveFileId: "df-1",
    parentFolderId: "root-1",
    rawFileName: "sample_01.cbz",
    volumeNumber: 1,
    volumeLabel: "第1巻",
    fileSize: 1000,
    md5Checksum: "md5-1",
    coverStatus: "pending",
    coverBlob: null,
    coverPageIndex: 0,
    coverCropMode: "full",
    coverUpdatedAt: null,
    isTrashed: 0,
    driveModifiedTime: 1000,
    addedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("seriesOrdering (R1-09)", () => {
  it("resolveRepresentativeVolumeが空配列でnull、指定ID一致時は該当巻、不一致時は先頭巻を返すこと", () => {
    const v1 = makeVolume({ id: "v-1" });
    const v2 = makeVolume({ id: "v-2" });

    expect(
      resolveRepresentativeVolume({ representativeVolumeId: "v-2" }, []),
    ).toBeNull();
    expect(
      resolveRepresentativeVolume({ representativeVolumeId: "v-2" }, [v1, v2]),
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

  it("sortSeriesItemsが4軸すべてで入力配列を破壊せず決定論的タイブレーク付きで並び替えること", () => {
    const input: SortableSeriesFields[] = [
      {
        seriesId: "s-b",
        title: "作品B",
        titleReading: "さくひんb",
        volumeCount: 2,
        lastReadAt: null,
        latestVolumeAddedAt: 3000,
        seriesAddedAt: 1000,
      },
      {
        seriesId: "s-a",
        title: "作品A",
        titleReading: "さくひんa",
        volumeCount: 5,
        lastReadAt: 2000,
        latestVolumeAddedAt: 2000,
        seriesAddedAt: 1000,
      },
      {
        seriesId: "s-c",
        title: "作品C",
        titleReading: "さくひんc",
        volumeCount: 5,
        lastReadAt: 5000,
        latestVolumeAddedAt: 1000,
        seriesAddedAt: 500,
      },
      {
        seriesId: "s-d",
        title: "作品D",
        titleReading: "さくひんb",
        volumeCount: 2,
        lastReadAt: null,
        latestVolumeAddedAt: 3000,
        seriesAddedAt: 2000,
      },
    ];

    expect(
      sortSeriesItems(input, "lastReadDesc").map((item) => item.seriesId),
    ).toEqual(["s-c", "s-a", "s-d", "s-b"]);
    expect(
      sortSeriesItems(input, "addedDesc").map((item) => item.seriesId),
    ).toEqual(["s-d", "s-b", "s-a", "s-c"]);
    expect(
      sortSeriesItems(input, "titleAsc").map((item) => item.seriesId),
    ).toEqual(["s-a", "s-b", "s-d", "s-c"]);
    expect(
      sortSeriesItems(input, "volumeCountDesc").map((item) => item.seriesId),
    ).toEqual(["s-a", "s-c", "s-b", "s-d"]);
    expect(input.map((item) => item.seriesId)).toEqual([
      "s-b",
      "s-a",
      "s-c",
      "s-d",
    ]);
  });
});
