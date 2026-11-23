import { describe, expect, it, vi } from "vitest";
import { GoogleAuthError } from "../../bridges/oauth/googleAuthErrors";
import type { GoogleAuthBridge } from "../../bridges/oauth/types";
import { createDiagnosticLogger } from "../../diagnostics/diagnosticLogger";
import { DriveApiError } from "./driveApiErrors";
import { GoogleDriveFolderClient } from "./googleDriveFolderClient";

function createMockAuthBridge(
  overrides: Partial<GoogleAuthBridge> = {},
): GoogleAuthBridge {
  return {
    getCachedSession: vi.fn().mockReturnValue(null),
    getSession: vi.fn().mockResolvedValue(null),
    signIn: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    getValidAccessToken: vi.fn().mockResolvedValue("ya29.valid-initial-token"),
    subscribeSession: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GoogleDriveFolderClient", () => {
  it("resolveFolderByIdでroot/空IDをfetch前に拒否し、正常フォルダ・非フォルダ・ゴミ箱・不正応答を判別すること (AC-GD-07)", async () => {
    const authBridge = createMockAuthBridge();
    const fetchFn = vi.fn<typeof fetch>();
    const logger = createDiagnosticLogger();
    const client = new GoogleDriveFolderClient({
      authBridge,
      fetchFn,
      logger,
    });

    for (const forbiddenId of ["", "   ", "root", "ROOT", "  Root  "]) {
      await expect(client.resolveFolderById(forbiddenId)).rejects.toMatchObject(
        {
          name: "DriveApiError",
          code: "FORBIDDEN",
        },
      );
    }
    expect(authBridge.getValidAccessToken).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();

    // 正常フォルダ取得
    fetchFn.mockResolvedValueOnce(
      createJsonResponse({
        id: "folder-123",
        name: "Comics",
        mimeType: "application/vnd.google-apps.folder",
        trashed: false,
      }),
    );
    await expect(client.resolveFolderById(" folder-123 ")).resolves.toEqual({
      id: "folder-123",
      name: "Comics",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchFn.mock.calls[0]!;
    expect(requestUrl).toBe(
      "https://www.googleapis.com/drive/v3/files/folder-123?fields=id,name,mimeType,trashed&supportsAllDrives=true",
    );
    expect(new Headers(requestInit?.headers).get("Authorization")).toBe(
      "Bearer ya29.valid-initial-token",
    );

    // フォルダ以外の MIME タイプ -> NOT_A_FOLDER
    fetchFn.mockResolvedValueOnce(
      createJsonResponse({
        id: "zip-1",
        name: "comic.cbz",
        mimeType: "application/zip",
        trashed: false,
      }),
    );
    await expect(client.resolveFolderById("zip-1")).rejects.toMatchObject({
      code: "NOT_A_FOLDER",
    });

    // ゴミ箱内フォルダ -> FOLDER_TRASHED
    fetchFn.mockResolvedValueOnce(
      createJsonResponse({
        id: "trashed-1",
        name: "Old",
        mimeType: "application/vnd.google-apps.folder",
        trashed: true,
      }),
    );
    await expect(client.resolveFolderById("trashed-1")).rejects.toMatchObject({
      code: "FOLDER_TRASHED",
    });

    // JSON 解析失敗 -> NETWORK_ERROR
    fetchFn.mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    await expect(client.resolveFolderById("bad-json")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    // 必須フィールド欠落の不正 JSON -> NETWORK_ERROR
    fetchFn.mockResolvedValueOnce(createJsonResponse({ id: "", name: 123 }));
    await expect(client.resolveFolderById("bad-shape")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("401発生時にfailedToken付きforceRefreshで1回のみ透過リトライし、各種HTTP・認証エラーをDriveApiErrorへ変換して秘匿ログを残すこと (AC-GD-07, AC-GD-05)", async () => {
    const getValidAccessToken = vi
      .fn<GoogleAuthBridge["getValidAccessToken"]>()
      .mockResolvedValueOnce("ya29.expired-secret-token")
      .mockResolvedValueOnce("ya29.refreshed-secret-token");
    const authBridge = createMockAuthBridge({ getValidAccessToken });
    const fetchFn = vi.fn<typeof fetch>();
    const logger = createDiagnosticLogger();
    const client = new GoogleDriveFolderClient({
      authBridge,
      fetchFn,
      logger,
    });

    // 1回目 401 -> 未読ボディ解放後にリフレッシュして再実行し 200 成功
    const first401 = createJsonResponse({ error: { code: 401 } }, 401);
    const cancelSpy = vi.spyOn(first401.body!, "cancel");
    fetchFn.mockResolvedValueOnce(first401).mockResolvedValueOnce(
      createJsonResponse({
        id: "f-ok",
        name: "MyManga",
        mimeType: "application/vnd.google-apps.folder",
        trashed: false,
      }),
    );

    await expect(client.resolveFolderById("f-ok")).resolves.toEqual({
      id: "f-ok",
      name: "MyManga",
    });
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(getValidAccessToken).toHaveBeenNthCalledWith(1);
    expect(getValidAccessToken).toHaveBeenNthCalledWith(2, {
      forceRefresh: true,
      failedToken: "ya29.expired-secret-token",
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetchFn.mock.calls[1]![1]?.headers).get("Authorization"),
    ).toBe("Bearer ya29.refreshed-secret-token");

    // body が null の 401 および body.cancel() 失敗時もリトライを継続できること
    getValidAccessToken
      .mockResolvedValueOnce("ya29.null-body-expired")
      .mockResolvedValueOnce("ya29.null-body-refreshed")
      .mockResolvedValueOnce("ya29.cancel-err-expired")
      .mockResolvedValueOnce("ya29.cancel-err-refreshed");
    fetchFn
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        createJsonResponse({
          id: "f-null-body",
          name: "NullBody",
          mimeType: "application/vnd.google-apps.folder",
          trashed: false,
        }),
      );
    await expect(client.resolveFolderById("f-null-body")).resolves.toEqual({
      id: "f-null-body",
      name: "NullBody",
    });

    const failingCancelResponse = {
      status: 401,
      ok: false,
      body: {
        cancel: vi.fn().mockRejectedValueOnce(new Error("stream locked")),
      },
      json: vi.fn().mockResolvedValue({}),
    } as unknown as Response;
    fetchFn.mockResolvedValueOnce(failingCancelResponse).mockResolvedValueOnce(
      createJsonResponse({
        id: "f-cancel-err",
        name: "CancelErr",
        mimeType: "application/vnd.google-apps.folder",
        trashed: false,
      }),
    );
    await expect(client.resolveFolderById("f-cancel-err")).resolves.toEqual({
      id: "f-cancel-err",
      name: "CancelErr",
    });
    expect(failingCancelResponse.body!.cancel).toHaveBeenCalledTimes(1);

    // 2回目も 401 の場合は無限リトライせず UNAUTHORIZED
    const callsBeforeDouble401 = fetchFn.mock.calls.length;
    getValidAccessToken.mockResolvedValue("ya29.bad-token");
    fetchFn
      .mockResolvedValueOnce(
        createJsonResponse({ error: { message: "bad ya29.bad-token" } }, 401),
      )
      .mockResolvedValueOnce(
        createJsonResponse({ error: { message: "still bad" } }, 401),
      );
    await expect(client.resolveFolderById("f-unauth")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
    expect(fetchFn).toHaveBeenCalledTimes(callsBeforeDouble401 + 2);

    // 403 rateLimitExceeded / userRateLimitExceeded -> RATE_LIMITED
    fetchFn.mockResolvedValueOnce(
      createJsonResponse(
        {
          error: {
            code: 403,
            message: "Rate limit",
            errors: [{ reason: "userRateLimitExceeded" }],
          },
        },
        403,
      ),
    );
    await expect(client.resolveFolderById("f-rate-403")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 403,
    });

    // 403 その他（非 JSON 応答含む） -> FORBIDDEN
    fetchFn.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    await expect(client.resolveFolderById("f-403")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });

    // 404 -> NOT_FOUND
    fetchFn.mockResolvedValueOnce(
      createJsonResponse({ error: { message: "Not found" } }, 404),
    );
    await expect(client.resolveFolderById("f-404")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });

    // 429 -> RATE_LIMITED
    fetchFn.mockResolvedValueOnce(createJsonResponse({}, 429));
    await expect(client.resolveFolderById("f-429")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });

    // 500 & fetch 例外 -> NETWORK_ERROR
    fetchFn.mockResolvedValueOnce(createJsonResponse({}, 500));
    await expect(client.resolveFolderById("f-500")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 500,
    });

    fetchFn.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED ya29.secret123"),
    );
    await expect(client.resolveFolderById("f-net")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    // 認証取得失敗（GoogleAuthError / 一般エラー）のマッピング
    getValidAccessToken.mockRejectedValueOnce(
      new GoogleAuthError("AUTH_NETWORK_ERROR", "offline"),
    );
    await expect(client.resolveFolderById("f-auth-net")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    getValidAccessToken.mockRejectedValueOnce(
      new GoogleAuthError("AUTH_REQUIRED", "reauth needed"),
    );
    await expect(client.resolveFolderById("f-auth-req")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    getValidAccessToken.mockRejectedValueOnce(
      new Error("unexpected auth error"),
    );
    await expect(client.resolveFolderById("f-auth-misc")).rejects.toMatchObject(
      {
        code: "UNAUTHORIZED",
      },
    );

    // 診断ログにトークンが平文残留していないこと
    const report = logger.formatReport();
    expect(report).toContain("[gdrive-folder]");
    expect(report).not.toContain("ya29.bad-token");
    expect(report).not.toContain("ya29.secret123");
    expect(report).not.toContain("ya29.expired-secret-token");
  });

  it("listChildFoldersでクエリエスケープ・pageToken・AbortSignal非ログ透過再スローを正しく処理すること (AC-GD-07)", async () => {
    const authBridge = createMockAuthBridge();
    const fetchFn = vi.fn<typeof fetch>();
    const logger = createDiagnosticLogger();
    const client = new GoogleDriveFolderClient({
      authBridge,
      fetchFn,
      logger,
    });

    // 空親フォルダIDは拒否
    await expect(client.listChildFolders("  ")).rejects.toBeInstanceOf(
      DriveApiError,
    );

    // 事前 Abort 済み signal は即 AbortError 再スローしエラーログを残さない
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      client.listChildFolders("root", { signal: preAborted.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(logger.getEntries()).toEqual([]);

    // fetch 中 Abort もエラーログを残さず再スロー
    const midAbort = new AbortController();
    fetchFn.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await expect(
      client.listChildFolders("root", { signal: midAbort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(logger.getEntries()).toEqual([]);

    // クエリエスケープ（\ と '）および pageToken・pageSize=100・orderBy=name_natural 検証
    fetchFn.mockResolvedValueOnce(
      createJsonResponse({
        nextPageToken: "next-page-2",
        files: [
          {
            id: "child-1",
            name: "1巻",
            mimeType: "application/vnd.google-apps.folder",
            trashed: false,
          },
          {
            id: "child-2",
            name: "2巻",
            mimeType: "application/vnd.google-apps.folder",
            trashed: false,
          },
        ],
      }),
    );
    const page1 = await client.listChildFolders("a\\'b", {
      pageToken: "  token-1  ",
    });
    expect(page1).toEqual({
      folders: [
        { id: "child-1", name: "1巻" },
        { id: "child-2", name: "2巻" },
      ],
      nextPageToken: "next-page-2",
    });

    const requestedUrl = new URL(String(fetchFn.mock.calls[1]![0]));
    expect(requestedUrl.origin + requestedUrl.pathname).toBe(
      "https://www.googleapis.com/drive/v3/files",
    );
    expect(requestedUrl.searchParams.get("q")).toBe(
      "'a\\\\\\'b' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    );
    expect(requestedUrl.searchParams.get("orderBy")).toBe("name_natural");
    expect(requestedUrl.searchParams.get("pageSize")).toBe("100");
    expect(requestedUrl.searchParams.get("fields")).toBe(
      "nextPageToken,files(id,name,mimeType,trashed)",
    );
    expect(requestedUrl.searchParams.get("includeItemsFromAllDrives")).toBe(
      "true",
    );
    expect(requestedUrl.searchParams.get("supportsAllDrives")).toBe("true");
    expect(requestedUrl.searchParams.get("pageToken")).toBe("token-1");

    // pageToken 未指定 / 空白時は nextPageToken: null を返し pageToken クエリを付与しない
    fetchFn.mockResolvedValueOnce(
      createJsonResponse({ nextPageToken: "", files: [] }),
    );
    const emptyPage = await client.listChildFolders("root", {
      pageToken: "   ",
    });
    expect(emptyPage).toEqual({ folders: [], nextPageToken: null });
    const emptyPageUrl = new URL(String(fetchFn.mock.calls[2]![0]));
    expect(emptyPageUrl.searchParams.has("pageToken")).toBe(false);

    // 不正な files 配列 / 要素構造は NETWORK_ERROR
    fetchFn.mockResolvedValueOnce(createJsonResponse({ files: "not-array" }));
    await expect(client.listChildFolders("root")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    fetchFn.mockResolvedValueOnce(
      createJsonResponse({ files: [{ id: 123, name: "bad" }] }),
    );
    await expect(client.listChildFolders("root")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("既定のglobalThis.fetchとdiagnosticLoggerを使用でき、resolveFolderByIdでもAbortSignalを受け付けること (AC-GD-07)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      createJsonResponse({
        id: "default-folder",
        name: "Default",
        mimeType: "application/vnd.google-apps.folder",
        trashed: false,
      }),
    );
    const authBridge = createMockAuthBridge();
    const client = new GoogleDriveFolderClient({ authBridge });

    const activeController = new AbortController();
    await expect(
      client.resolveFolderById("default-folder", {
        signal: activeController.signal,
      }),
    ).resolves.toEqual({
      id: "default-folder",
      name: "Default",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const abortedController = new AbortController();
    abortedController.abort();
    await expect(
      client.resolveFolderById("default-folder", {
        signal: abortedController.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    fetchSpy.mockRestore();
  });

  it("200正常応答およびエラー応答のresponse.json()読込中にAbortErrorが発生した場合、ログ記録せずAbortErrorをそのまま再送出すること (AC-GD-07)", async () => {
    const authBridge = createMockAuthBridge();
    const fetchFn = vi.fn<typeof fetch>();
    const logger = createDiagnosticLogger();
    const client = new GoogleDriveFolderClient({
      authBridge,
      fetchFn,
      logger,
    });

    // 1) 200応答の response.json() が AbortError で拒否
    const okAbortRes = new Response("{}", { status: 200 });
    vi.spyOn(okAbortRes, "json").mockRejectedValueOnce(
      new DOMException("Body read aborted", "AbortError"),
    );
    fetchFn.mockResolvedValueOnce(okAbortRes);
    await expect(client.listChildFolders("root")).rejects.toMatchObject({
      name: "AbortError",
    });

    // 2) 200応答の response.json() 読込中に signal が abort（TypeError 送出）
    const okSignalController = new AbortController();
    const okSignalRes = new Response("{}", { status: 200 });
    vi.spyOn(okSignalRes, "json").mockImplementationOnce(async () => {
      okSignalController.abort();
      throw new TypeError("stream terminated");
    });
    fetchFn.mockResolvedValueOnce(okSignalRes);
    await expect(
      client.listChildFolders("root", { signal: okSignalController.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    // 3) エラー応答 (500) の response.json() が AbortError で拒否
    const errAbortRes = new Response("{}", { status: 500 });
    vi.spyOn(errAbortRes, "json").mockRejectedValueOnce(
      new DOMException("Error body aborted", "AbortError"),
    );
    fetchFn.mockResolvedValueOnce(errAbortRes);
    await expect(client.listChildFolders("root")).rejects.toMatchObject({
      name: "AbortError",
    });

    // 4) エラー応答 (500) の response.json() 読込中に signal が abort
    const errSignalController = new AbortController();
    const errSignalRes = new Response("{}", { status: 500 });
    vi.spyOn(errSignalRes, "json").mockImplementationOnce(async () => {
      errSignalController.abort();
      throw new TypeError("stream terminated");
    });
    fetchFn.mockResolvedValueOnce(errSignalRes);
    await expect(
      client.listChildFolders("root", { signal: errSignalController.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(logger.getEntries()).toEqual([]);
  });
});
