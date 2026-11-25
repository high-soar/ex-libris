import { describe, expect, it, vi } from "vitest";
import type { GoogleAuthBridge } from "../../bridges/oauth/types";
import { createDiagnosticLogger } from "../../diagnostics/diagnosticLogger";
import { GoogleDriveSyncClient } from "./googleDriveSyncClient";

function createMockAuthBridge(): GoogleAuthBridge {
  return {
    getCachedSession: vi.fn().mockReturnValue(null),
    getSession: vi.fn().mockResolvedValue(null),
    signIn: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    getValidAccessToken: vi.fn().mockResolvedValue("ya29.sync-token"),
    subscribeSession: vi.fn().mockReturnValue(() => {}),
  };
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GoogleDriveSyncClient", () => {
  it("getStartPageTokenでトークンを取得し、不正応答はNETWORK_ERRORとすること (AC-GD-10)", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const logger = createDiagnosticLogger();
    const client = new GoogleDriveSyncClient({
      authBridge: createMockAuthBridge(),
      fetchFn,
      logger,
    });

    fetchFn.mockResolvedValueOnce(
      createJsonResponse({ startPageToken: "  4201  " }),
    );
    await expect(client.getStartPageToken()).resolves.toBe("4201");
    expect(fetchFn.mock.calls[0]![0]).toBe(
      "https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true",
    );

    // 欠落・空文字応答 -> NETWORK_ERROR
    fetchFn.mockResolvedValueOnce(createJsonResponse({ startPageToken: "  " }));
    await expect(client.getStartPageToken()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    fetchFn.mockResolvedValueOnce(createJsonResponse("invalid"));
    await expect(client.getStartPageToken()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("listItemsInParentsで複数親IDのorクエリ・エスケープ・pageSize=1000・pageToken・サイズ変換を正しく処理すること (AC-GD-09)", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const logger = createDiagnosticLogger();
    const client = new GoogleDriveSyncClient({
      authBridge: createMockAuthBridge(),
      fetchFn,
      logger,
    });

    // 空親配列（空白のみ含む）は通信せず空ページ返却
    await expect(client.listItemsInParents(["", "  "])).resolves.toEqual({
      files: [],
      nextPageToken: null,
    });
    expect(fetchFn).not.toHaveBeenCalled();

    fetchFn.mockResolvedValueOnce(
      createJsonResponse({
        nextPageToken: "next-p2",
        files: [
          {
            id: "sub-1",
            name: "アクション",
            mimeType: "application/vnd.google-apps.folder",
            parents: ["root-a"],
            modifiedTime: "2026-11-25T10:00:00.000Z",
            trashed: false,
          },
          {
            id: "file-1",
            name: "作品A 第01巻.cbz",
            mimeType: "application/octet-stream",
            parents: ["root-a"],
            size: "123456",
            md5Checksum: "abc123",
            modifiedTime: "2026-11-25T11:00:00.000Z",
            trashed: false,
          },
          {
            id: "file-2",
            name: "作品B 第02巻.zip",
            mimeType: "application/zip",
            size: 654321,
            md5Checksum: "  ",
            modifiedTime: "not-a-date",
          },
        ],
      }),
    );

    const page = await client.listItemsInParents(["root-a", "dir\\'b", "  "], {
      pageToken: "  page-1  ",
    });
    expect(page).toEqual({
      nextPageToken: "next-p2",
      files: [
        {
          id: "sub-1",
          name: "アクション",
          mimeType: "application/vnd.google-apps.folder",
          parents: ["root-a"],
          size: null,
          md5Checksum: null,
          modifiedTime: Date.parse("2026-11-25T10:00:00.000Z"),
          trashed: false,
        },
        {
          id: "file-1",
          name: "作品A 第01巻.cbz",
          mimeType: "application/octet-stream",
          parents: ["root-a"],
          size: 123456,
          md5Checksum: "abc123",
          modifiedTime: Date.parse("2026-11-25T11:00:00.000Z"),
          trashed: false,
        },
        {
          id: "file-2",
          name: "作品B 第02巻.zip",
          mimeType: "application/zip",
          parents: [],
          size: 654321,
          md5Checksum: null,
          modifiedTime: 0,
          trashed: false,
        },
      ],
    });

    const url = new URL(String(fetchFn.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/drive/v3/files",
    );
    expect(url.searchParams.get("q")).toBe(
      "('root-a' in parents or 'dir\\\\\\'b' in parents) and trashed = false",
    );
    expect(url.searchParams.get("pageSize")).toBe("1000");
    expect(url.searchParams.get("fields")).toBe(
      "nextPageToken,files(id,name,mimeType,parents,size,md5Checksum,modifiedTime,trashed)",
    );
    expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("pageToken")).toBe("page-1");

    // pageToken 未指定 / 空ページ
    fetchFn.mockResolvedValueOnce(
      createJsonResponse({ nextPageToken: "", files: [] }),
    );
    await expect(client.listItemsInParents(["root-a"])).resolves.toEqual({
      files: [],
      nextPageToken: null,
    });
    const url2 = new URL(String(fetchFn.mock.calls[1]![0]));
    expect(url2.searchParams.has("pageToken")).toBe(false);

    // 不正応答・不正ファイル要素 -> NETWORK_ERROR
    fetchFn.mockResolvedValueOnce(createJsonResponse({ files: "not-array" }));
    await expect(client.listItemsInParents(["root-a"])).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    fetchFn.mockResolvedValueOnce(
      createJsonResponse({ files: [{ id: "", name: "x", mimeType: "a" }] }),
    );
    await expect(client.listItemsInParents(["root-a"])).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    fetchFn.mockResolvedValueOnce(
      createJsonResponse({
        files: [
          {
            id: "f1",
            name: "a.cbz",
            mimeType: "application/zip",
            parents: [123],
          },
        ],
      }),
    );
    await expect(client.listItemsInParents(["root-a"])).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    fetchFn.mockResolvedValueOnce(
      createJsonResponse({
        files: [
          {
            id: "f1",
            name: "a.cbz",
            mimeType: "application/zip",
            size: "not-a-number",
          },
        ],
      }),
    );
    await expect(client.listItemsInParents(["root-a"])).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    fetchFn.mockResolvedValueOnce(
      createJsonResponse({
        files: [
          {
            id: "f1",
            name: "a.cbz",
            mimeType: "application/zip",
            size: -5,
          },
        ],
      }),
    );
    await expect(client.listItemsInParents(["root-a"])).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("getFileMetadataで404時はnullを返し、その他のエラーは再送出し正常メタデータを解析すること (AC-GD-10)", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const logger = createDiagnosticLogger();
    const client = new GoogleDriveSyncClient({
      authBridge: createMockAuthBridge(),
      fetchFn,
      logger,
    });

    await expect(client.getFileMetadata("   ")).resolves.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();

    fetchFn.mockResolvedValueOnce(
      createJsonResponse({
        id: "folder-sub",
        name: "サブフォルダ",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root-a"],
        modifiedTime: "2026-11-25T12:00:00.000Z",
        trashed: false,
      }),
    );
    await expect(client.getFileMetadata(" folder-sub ")).resolves.toEqual({
      id: "folder-sub",
      name: "サブフォルダ",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["root-a"],
      size: null,
      md5Checksum: null,
      modifiedTime: Date.parse("2026-11-25T12:00:00.000Z"),
      trashed: false,
    });
    expect(fetchFn.mock.calls[0]![0]).toBe(
      "https://www.googleapis.com/drive/v3/files/folder-sub?fields=id,name,mimeType,parents,size,md5Checksum,modifiedTime,trashed&supportsAllDrives=true",
    );

    // 404 -> null
    fetchFn.mockResolvedValueOnce(createJsonResponse({}, 404));
    await expect(client.getFileMetadata("missing-id")).resolves.toBeNull();

    // 403 -> FORBIDDEN 再送出
    fetchFn.mockResolvedValueOnce(createJsonResponse({}, 403));
    await expect(client.getFileMetadata("forbidden-id")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("listChangesで差分一覧を解析し、400 pageToken失効をTOKEN_EXPIREDへ変換・429指数バックオフが有効であること (AC-GD-10, AC-GD-13)", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const sleepCalls: number[] = [];
    const client = new GoogleDriveSyncClient({
      authBridge: createMockAuthBridge(),
      fetchFn,
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    // 空トークン -> TOKEN_EXPIRED
    await expect(client.listChanges("   ")).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });

    // 429 リトライ後に正常取得
    fetchFn
      .mockResolvedValueOnce(createJsonResponse({}, 429))
      .mockResolvedValueOnce(
        createJsonResponse({
          nextPageToken: "",
          newStartPageToken: "5000",
          changes: [
            {
              fileId: "file-del",
              removed: true,
            },
            {
              fileId: "file-add",
              removed: false,
              file: {
                id: "file-add",
                name: "新刊 第03巻.cbz",
                mimeType: "application/zip",
                parents: ["sub-1"],
                size: "4096",
                md5Checksum: "md5-new",
                modifiedTime: "2026-11-25T13:00:00.000Z",
                trashed: false,
              },
            },
          ],
        }),
      );

    const changesPage = await client.listChanges(" 4201 ");
    expect(sleepCalls).toEqual([500]);
    expect(changesPage).toEqual({
      nextPageToken: null,
      newStartPageToken: "5000",
      changes: [
        { fileId: "file-del", removed: true, file: null },
        {
          fileId: "file-add",
          removed: false,
          file: {
            id: "file-add",
            name: "新刊 第03巻.cbz",
            mimeType: "application/zip",
            parents: ["sub-1"],
            size: 4096,
            md5Checksum: "md5-new",
            modifiedTime: Date.parse("2026-11-25T13:00:00.000Z"),
            trashed: false,
          },
        },
      ],
    });

    const url = new URL(String(fetchFn.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/drive/v3/changes",
    );
    expect(url.searchParams.get("pageToken")).toBe("4201");
    expect(url.searchParams.get("pageSize")).toBe("1000");
    expect(url.searchParams.get("includeRemoved")).toBe("true");
    expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("fields")).toBe(
      "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,parents,size,md5Checksum,modifiedTime,trashed))",
    );

    // 400 + invalid pageToken -> TOKEN_EXPIRED
    fetchFn.mockResolvedValueOnce(
      createJsonResponse(
        {
          error: {
            message: "Invalid pageToken",
            errors: [{ reason: "invalid", location: "pageToken" }],
          },
        },
        400,
      ),
    );
    await expect(client.listChanges("bad-token")).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
      status: 400,
    });

    // 不正 changes 応答 -> NETWORK_ERROR
    fetchFn.mockResolvedValueOnce(createJsonResponse({ changes: "bad" }));
    await expect(client.listChanges("4201")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    fetchFn.mockResolvedValueOnce(
      createJsonResponse({ changes: [{ fileId: "" }] }),
    );
    await expect(client.listChanges("4201")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    // 中間ページ（nextPageToken あり、newStartPageToken なし）
    fetchFn.mockResolvedValueOnce(
      createJsonResponse({
        nextPageToken: "4202",
        changes: [],
      }),
    );
    await expect(client.listChanges("4201")).resolves.toEqual({
      changes: [],
      nextPageToken: "4202",
      newStartPageToken: null,
    });
  });
});
