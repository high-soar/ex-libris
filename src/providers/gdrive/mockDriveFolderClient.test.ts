import { describe, expect, it } from "vitest";
import { DriveApiError } from "./driveApiErrors";
import { MockDriveFolderClient } from "./mockDriveFolderClient";

describe("MockDriveFolderClient", () => {
  it("既定フォルダ階層の解決・ページネーション付き一覧取得・各種エラー判定ができること", async () => {
    const client = new MockDriveFolderClient({ pageSize: 1 });

    // root は resolveFolderById では FORBIDDEN、listChildFolders ではトップ階層を返す
    await expect(client.resolveFolderById("root")).rejects.toMatchObject({
      name: "DriveApiError",
      code: "FORBIDDEN",
    });
    await expect(client.resolveFolderById("   ")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(client.listChildFolders("   ")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const page1 = await client.listChildFolders("root");
    expect(page1.folders).toHaveLength(1);
    expect(page1.nextPageToken).not.toBeNull();

    const page2 = await client.listChildFolders("root", {
      pageToken: page1.nextPageToken ?? undefined,
    });
    expect(page2.folders).toHaveLength(1);
    expect(page2.nextPageToken).toBeNull();

    const firstFolder = page1.folders[0]!;
    await expect(client.resolveFolderById(firstFolder.id)).resolves.toEqual(
      firstFolder,
    );
    await expect(client.resolveFolderById("missing-id")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("非フォルダ・ゴミ箱・AbortSignal・テストフック(setNodes/setInjectedError/reset)が動作すること", async () => {
    const client = new MockDriveFolderClient({
      nodes: [
        { id: "f1", name: "Folder 1", parentId: "root" },
        { id: "f2", name: "Trashed", parentId: "root", trashed: true },
        { id: "file1", name: "File.cbz", parentId: "root", isFolder: false },
      ],
    });

    await expect(client.resolveFolderById("f1")).resolves.toEqual({
      id: "f1",
      name: "Folder 1",
    });
    await expect(client.resolveFolderById("f2")).rejects.toMatchObject({
      code: "FOLDER_TRASHED",
    });
    await expect(client.resolveFolderById("file1")).rejects.toMatchObject({
      code: "NOT_A_FOLDER",
    });

    await expect(client.listChildFolders("f2")).rejects.toMatchObject({
      code: "FOLDER_TRASHED",
    });
    await expect(client.listChildFolders("file1")).rejects.toMatchObject({
      code: "NOT_A_FOLDER",
    });
    await expect(client.listChildFolders("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // AbortSignal
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.resolveFolderById("f1", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      client.listChildFolders("root", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    // エラー注入
    client.setInjectedError(new DriveApiError("RATE_LIMITED", "injected"));
    await expect(client.resolveFolderById("f1")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    await expect(client.listChildFolders("root")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });

    // setNodes & reset
    client.setInjectedError(null);
    client.setNodes([{ id: "custom", name: "Custom", parentId: "root" }]);
    expect((await client.listChildFolders("root")).folders).toEqual([
      { id: "custom", name: "Custom" },
    ]);

    client.reset();
    expect(
      (await client.listChildFolders("root")).folders.length,
    ).toBeGreaterThanOrEqual(2);
  });
});
