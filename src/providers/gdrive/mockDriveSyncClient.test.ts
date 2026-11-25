import { describe, expect, it } from "vitest";
import { DriveApiError } from "./driveApiErrors";
import { MockDriveSyncClient } from "./mockDriveSyncClient";

describe("MockDriveSyncClient", () => {
  it("MockDriveFolderClientと統一された初期ルートID配下の決定論的サンプル木を走査でき、ページネーションとgetFileMetadataが動作すること (AC-GD-14)", async () => {
    const client = new MockDriveSyncClient();

    const comicsRoot = await client.getFileMetadata("mock-folder-comics");
    const mangaRoot = await client.getFileMetadata("mock-folder-manga");
    expect(comicsRoot?.name).toBe("Comics");
    expect(mangaRoot?.name).toBe("自炊マンガ");
    await expect(client.getFileMetadata("unknown-id")).resolves.toBeNull();

    // Comics 直下にはサブフォルダ（アクション・SF）と非アーカイブ（README.txt）が存在
    const comicsChildren = await client.listItemsInParents([
      "mock-folder-comics",
    ]);
    expect(comicsChildren.files.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "mock-folder-action",
        "mock-folder-scifi",
        "mock-file-readme",
      ]),
    );
    expect(comicsChildren.nextPageToken).toBeNull();

    // ページネーション確認
    client.setPageSize(2);
    const page1 = await client.listItemsInParents(["mock-folder-comics"]);
    expect(page1.files).toHaveLength(2);
    expect(page1.nextPageToken).not.toBeNull();
    const page2 = await client.listItemsInParents(["mock-folder-comics"], {
      pageToken: page1.nextPageToken!,
    });
    expect(page2.files.length).toBeGreaterThanOrEqual(1);
    expect(page2.nextPageToken).toBeNull();

    // 対象外フォルダ配下の ZIP も木に含まれていること
    const otherChildren = await client.listItemsInParents([
      "mock-folder-other",
    ]);
    expect(otherChildren.files.some((item) => item.name.endsWith(".cbz"))).toBe(
      true,
    );
  });

  it("upsertItem・trashItem・removeItem・pushChange・expireAllIssuedTokens・reset・setInjectedError・AbortSignalが仕様通り動作すること (AC-GD-14)", async () => {
    const client = new MockDriveSyncClient();
    const token1 = await client.getStartPageToken();

    // 変更なし時は空配列と同一トークン
    await expect(client.listChanges(token1)).resolves.toEqual({
      changes: [],
      nextPageToken: null,
      newStartPageToken: token1,
    });

    // ファイル追加・ゴミ箱・完全削除・手動変更イベント投入
    client.upsertItem({
      id: "new-file-1",
      name: "新規コミック 第01巻.cbz",
      mimeType: "application/zip",
      parents: ["mock-folder-action"],
      size: 1024,
      md5Checksum: "md5-1",
      modifiedTime: 1_700_000_000_000,
      trashed: false,
    });
    client.trashItem("new-file-1");
    client.trashItem("non-existent-file");
    client.removeItem("mock-file-vol1");
    client.pushChange({
      fileId: "custom-change",
      removed: true,
      file: null,
    });

    // ページサイズ2で差分ページネーション検証
    client.setPageSize(2);
    const ch1 = await client.listChanges(token1);
    expect(ch1.changes).toHaveLength(2);
    expect(ch1.nextPageToken).not.toBeNull();
    expect(ch1.newStartPageToken).toBeNull();

    const ch2 = await client.listChanges(ch1.nextPageToken!);
    expect(ch2.changes).toHaveLength(2);
    expect(ch2.nextPageToken).toBeNull();
    expect(ch2.newStartPageToken).not.toBeNull();

    // 410 TOKEN_EXPIRED シミュレーション
    client.expireAllIssuedTokens();
    await expect(client.listChanges(token1)).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
      status: 410,
    });

    // 無効な数値外トークンも TOKEN_EXPIRED
    await expect(client.listChanges("not-a-token")).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
      status: 410,
    });

    // エラー注入・AbortSignal
    client.setInjectedError(new DriveApiError("NETWORK_ERROR", "injected"));
    await expect(client.getStartPageToken()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      client.getStartPageToken(aborted.signal),
    ).rejects.toMatchObject({ name: "AbortError" });

    // setItems / recordChange=false / reset
    client.setInjectedError(null);
    client.setItems([]);
    expect(
      (await client.listItemsInParents(["mock-folder-comics"])).files,
    ).toEqual([]);
    client.upsertItem(
      {
        id: "silent-1",
        name: "silent.cbz",
        mimeType: "application/zip",
        parents: ["mock-folder-comics"],
        size: 100,
        md5Checksum: null,
        modifiedTime: 1,
        trashed: false,
      },
      false,
    );
    client.trashItem("silent-1", false);
    client.removeItem("silent-1", false);

    client.reset();
    expect(await client.getFileMetadata("mock-file-vol1")).not.toBeNull();
  });
});
