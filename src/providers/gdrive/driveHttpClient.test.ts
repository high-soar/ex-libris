import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleAuthError } from "../../bridges/oauth/googleAuthErrors";
import type { GoogleAuthBridge } from "../../bridges/oauth/types";
import { createDiagnosticLogger } from "../../diagnostics/diagnosticLogger";
import {
  DriveHttpClient,
  escapeDriveQueryValue,
  isRecord,
  throwIfAborted,
} from "./driveHttpClient";

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

describe("driveHttpClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("escapeDriveQueryValue・isRecord・throwIfAbortedの基本ユーティリティが仕様通り動作すること", () => {
    expect(escapeDriveQueryValue("a\\'b\\c'd")).toBe("a\\\\\\'b\\\\c\\'d");
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("str")).toBe(false);

    expect(() => throwIfAborted()).not.toThrow();
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrowError(
      /The operation was aborted/,
    );
  });

  it("401発生時に未読ボディ解放とfailedToken付きCompare-and-Refreshで1回のみ透過リトライし、各種HTTP・認証エラーを分類して秘匿ログを残すこと (AC-GD-05, AC-GD-07)", async () => {
    const getValidAccessToken = vi
      .fn<GoogleAuthBridge["getValidAccessToken"]>()
      .mockResolvedValueOnce("ya29.expired-token")
      .mockResolvedValueOnce("ya29.refreshed-token");
    const authBridge = createMockAuthBridge({ getValidAccessToken });
    const fetchFn = vi.fn<typeof fetch>();
    const logger = createDiagnosticLogger();
    const client = new DriveHttpClient({
      authBridge,
      diagnosticScope: "gdrive-sync",
      fetchFn,
      logger,
    });

    const first401 = createJsonResponse({ error: { code: 401 } }, 401);
    const cancelSpy = vi.spyOn(first401.body!, "cancel");
    fetchFn
      .mockResolvedValueOnce(first401)
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));

    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/1"),
    ).resolves.toEqual({ ok: true });
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(getValidAccessToken).toHaveBeenNthCalledWith(1);
    expect(getValidAccessToken).toHaveBeenNthCalledWith(2, {
      forceRefresh: true,
      failedToken: "ya29.expired-token",
    });

    // body=null および body.cancel() 失敗時の401もリトライ継続
    getValidAccessToken
      .mockResolvedValueOnce("ya29.t1")
      .mockResolvedValueOnce("ya29.t2")
      .mockResolvedValueOnce("ya29.t3")
      .mockResolvedValueOnce("ya29.t4");
    fetchFn
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(createJsonResponse({ ok: "null-body" }));
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/2"),
    ).resolves.toEqual({ ok: "null-body" });

    const failingCancelRes = {
      status: 401,
      ok: false,
      body: {
        cancel: vi.fn().mockRejectedValueOnce(new Error("locked")),
      },
      json: vi.fn().mockResolvedValue({}),
    } as unknown as Response;
    fetchFn
      .mockResolvedValueOnce(failingCancelRes)
      .mockResolvedValueOnce(createJsonResponse({ ok: "cancel-err" }));
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/3"),
    ).resolves.toEqual({ ok: "cancel-err" });

    // 2回目も401 -> UNAUTHORIZED
    getValidAccessToken.mockResolvedValue("ya29.always-bad");
    fetchFn
      .mockResolvedValueOnce(
        createJsonResponse({ error: { message: "bad ya29.always-bad" } }, 401),
      )
      .mockResolvedValueOnce(
        createJsonResponse({ error: { message: "still bad" } }, 401),
      );
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/4"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });

    // 403 rateLimitExceeded -> RATE_LIMITED / その他 403 -> FORBIDDEN
    fetchFn.mockResolvedValueOnce(
      createJsonResponse(
        {
          error: {
            message: "rate limit",
            errors: [{ reason: "rateLimitExceeded" }],
          },
        },
        403,
      ),
    );
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/5"),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 403 });

    fetchFn.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/6"),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    // 404 -> NOT_FOUND / 500 -> NETWORK_ERROR / JSON失敗 -> NETWORK_ERROR
    fetchFn.mockResolvedValueOnce(createJsonResponse({}, 404));
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/7"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    fetchFn.mockResolvedValueOnce(createJsonResponse({}, 500));
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/8"),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 500 });

    fetchFn.mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/9"),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });

    // fetch 例外 -> NETWORK_ERROR
    fetchFn.mockRejectedValueOnce(new Error("ECONNRESET ya29.net-secret"));
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/10"),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });

    // 認証エラー変換
    getValidAccessToken.mockRejectedValueOnce(
      new GoogleAuthError("AUTH_NETWORK_ERROR", "offline"),
    );
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/11"),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });

    getValidAccessToken.mockRejectedValueOnce(
      new GoogleAuthError("AUTH_REQUIRED", "reauth"),
    );
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/12"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    getValidAccessToken.mockRejectedValueOnce(
      new Error("unknown auth failure"),
    );
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/13"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const report = logger.formatReport();
    expect(report).toContain("[gdrive-sync]");
    expect(report).not.toContain("ya29.always-bad");
    expect(report).not.toContain("ya29.net-secret");
  });

  it("410は常にTOKEN_EXPIREDとなり、400はtreatInvalidPageTokenAsExpired=trueかつpageToken起因時のみTOKEN_EXPIREDへ変換されること (AC-GD-10)", async () => {
    const authBridge = createMockAuthBridge();
    const fetchFn = vi.fn<typeof fetch>();
    const logger = createDiagnosticLogger();
    const client = new DriveHttpClient({
      authBridge,
      diagnosticScope: "gdrive-sync",
      fetchFn,
      logger,
    });

    // 410 はオプション未指定でも常に TOKEN_EXPIRED
    fetchFn.mockResolvedValueOnce(
      createJsonResponse({ error: { message: "Gone" } }, 410),
    );
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/changes"),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED", status: 410 });

    // 400 + location="pageToken" + reason="invalid" でも treatInvalidPageTokenAsExpired=false なら NETWORK_ERROR
    fetchFn.mockResolvedValueOnce(
      createJsonResponse(
        {
          error: {
            message: "Invalid Value",
            errors: [{ reason: "invalid", location: "pageToken" }],
          },
        },
        400,
      ),
    );
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files"),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 400 });

    // treatInvalidPageTokenAsExpired=true + reason="invalid" + location="pageToken" -> TOKEN_EXPIRED
    fetchFn.mockResolvedValueOnce(
      createJsonResponse(
        {
          error: {
            message: "Invalid Value",
            errors: [{ reason: "invalid", location: "pageToken" }],
          },
        },
        400,
      ),
    );
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/changes", {
        treatInvalidPageTokenAsExpired: true,
      }),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED", status: 400 });

    // treatInvalidPageTokenAsExpired=true + reason="badRequest" + message に "PageToken"（大小非区別） -> TOKEN_EXPIRED
    fetchFn.mockResolvedValueOnce(
      createJsonResponse(
        {
          error: {
            message: "Invalid PageToken specified",
            errors: [{ reason: "badRequest" }],
          },
        },
        400,
      ),
    );
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/changes", {
        treatInvalidPageTokenAsExpired: true,
      }),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED", status: 400 });

    // treatInvalidPageTokenAsExpired=true でも pageToken 無関係な 400 -> NETWORK_ERROR
    fetchFn.mockResolvedValueOnce(
      createJsonResponse(
        {
          error: {
            message: "Invalid fields parameter",
            errors: [{ reason: "invalid", location: "fields" }],
          },
        },
        400,
      ),
    );
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/changes", {
        treatInvalidPageTokenAsExpired: true,
      }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 400 });

    // reason が invalid / badRequest 以外なら pageToken 文言があっても NETWORK_ERROR
    fetchFn.mockResolvedValueOnce(
      createJsonResponse(
        {
          error: {
            message: "pageToken forbidden",
            errors: [{ reason: "otherReason", location: "pageToken" }],
          },
        },
        400,
      ),
    );
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/changes", {
        treatInvalidPageTokenAsExpired: true,
      }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 400 });
  });

  it("RATE_LIMITED発生時に500ms→1000ms→2000msの最大3回指数バックオフリトライを行い、上限超過でRATE_LIMITEDを送出すること (AC-GD-13)", async () => {
    const authBridge = createMockAuthBridge();
    const fetchFn = vi.fn<typeof fetch>();
    const logger = createDiagnosticLogger();
    const sleepCalls: number[] = [];
    const sleepFn = vi.fn(async (ms: number) => {
      sleepCalls.push(ms);
    });
    const client = new DriveHttpClient({
      authBridge,
      diagnosticScope: "gdrive-sync",
      fetchFn,
      logger,
      maxRateLimitRetries: 3,
      baseBackoffMs: 500,
      sleepFn,
    });

    // 429 -> 403(userRateLimitExceeded) -> 429 -> 200 成功
    fetchFn
      .mockResolvedValueOnce(createJsonResponse({}, 429))
      .mockResolvedValueOnce(
        createJsonResponse(
          { error: { errors: [{ reason: "userRateLimitExceeded" }] } },
          403,
        ),
      )
      .mockResolvedValueOnce(createJsonResponse({}, 429))
      .mockResolvedValueOnce(createJsonResponse({ recovered: true }));

    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/changes"),
    ).resolves.toEqual({ recovered: true });
    expect(sleepCalls).toEqual([500, 1000, 2000]);
    expect(fetchFn).toHaveBeenCalledTimes(4);

    // 4回連続 429 -> 3回リトライ後に RATE_LIMITED 送出
    sleepCalls.length = 0;
    fetchFn
      .mockResolvedValueOnce(createJsonResponse({}, 429))
      .mockResolvedValueOnce(createJsonResponse({}, 429))
      .mockResolvedValueOnce(createJsonResponse({}, 429))
      .mockResolvedValueOnce(createJsonResponse({}, 429));

    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/changes"),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(sleepCalls).toEqual([500, 1000, 2000]);
  });

  it("既定sleepFn・既定globalThis.fetch・既定diagnosticLoggerが動作し、バックオフ待機中のAbortSignal発火や通信・JSON読込中Abortで非ログ再送出すること (AC-GD-13)", async () => {
    const authBridge = createMockAuthBridge();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(createJsonResponse({}, 429))
      .mockResolvedValueOnce(createJsonResponse({ ok: "default-sleep" }));

    vi.useFakeTimers();
    const defaultClient = new DriveHttpClient({
      authBridge,
      diagnosticScope: "gdrive-sync",
      maxRateLimitRetries: 1,
      baseBackoffMs: 100,
    });

    // signal なし既定 sleepFn で正常完了
    const promiseNoSignal = defaultClient.fetchJson(
      "https://www.googleapis.com/drive/v3/files/default",
    );
    await vi.advanceTimersByTimeAsync(100);
    await expect(promiseNoSignal).resolves.toEqual({ ok: "default-sleep" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // signal 付き既定 sleepFn で正常完了
    const activeController = new AbortController();
    fetchSpy
      .mockResolvedValueOnce(createJsonResponse({}, 429))
      .mockResolvedValueOnce(createJsonResponse({ ok: "signal-sleep" }));
    const promiseWithSignal = defaultClient.fetchJson(
      "https://www.googleapis.com/drive/v3/files/signal",
      { signal: activeController.signal },
    );
    await vi.advanceTimersByTimeAsync(100);
    await expect(promiseWithSignal).resolves.toEqual({ ok: "signal-sleep" });

    // バックオフ待機中に AbortSignal 発火 -> 即座に AbortError
    const abortDuringSleep = new AbortController();
    fetchSpy.mockResolvedValueOnce(createJsonResponse({}, 429));
    const abortedSleepPromise = defaultClient.fetchJson(
      "https://www.googleapis.com/drive/v3/files/abort-sleep",
      { signal: abortDuringSleep.signal },
    );
    const abortExpectation = expect(abortedSleepPromise).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(20);
    abortDuringSleep.abort();
    await abortExpectation;

    vi.useRealTimers();

    // 事前 Abort / fetch 中 Abort / response.json() 中 Abort は非ログ再送出
    const logger = createDiagnosticLogger();
    const fetchFn = vi.fn<typeof fetch>();
    const client = new DriveHttpClient({
      authBridge,
      diagnosticScope: "gdrive-sync",
      fetchFn,
      logger,
    });

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/pre", {
        signal: preAborted.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    fetchFn.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/fetch-abort"),
    ).rejects.toMatchObject({ name: "AbortError" });

    const okAbortRes = new Response("{}", { status: 200 });
    vi.spyOn(okAbortRes, "json").mockRejectedValueOnce(
      new DOMException("Body aborted", "AbortError"),
    );
    fetchFn.mockResolvedValueOnce(okAbortRes);
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/ok-abort"),
    ).rejects.toMatchObject({ name: "AbortError" });

    const okSignalCtrl = new AbortController();
    const okSignalRes = new Response("{}", { status: 200 });
    vi.spyOn(okSignalRes, "json").mockImplementationOnce(async () => {
      okSignalCtrl.abort();
      throw new TypeError("terminated");
    });
    fetchFn.mockResolvedValueOnce(okSignalRes);
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/ok-sig", {
        signal: okSignalCtrl.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    const errAbortRes = new Response("{}", { status: 500 });
    vi.spyOn(errAbortRes, "json").mockRejectedValueOnce(
      new DOMException("Err body aborted", "AbortError"),
    );
    fetchFn.mockResolvedValueOnce(errAbortRes);
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/err-abort"),
    ).rejects.toMatchObject({ name: "AbortError" });

    const errSignalCtrl = new AbortController();
    const errSignalRes = new Response("{}", { status: 500 });
    vi.spyOn(errSignalRes, "json").mockImplementationOnce(async () => {
      errSignalCtrl.abort();
      throw new TypeError("terminated");
    });
    fetchFn.mockResolvedValueOnce(errSignalRes);
    await expect(
      client.fetchJson("https://www.googleapis.com/drive/v3/files/err-sig", {
        signal: errSignalCtrl.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(logger.getEntries()).toEqual([]);
  });
});
