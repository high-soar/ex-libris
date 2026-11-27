import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleAuthError } from "../../bridges/oauth/googleAuthErrors";
import { ZipArchiveError } from "../zip/errors";
import { GoogleDriveRangeReader } from "./GoogleDriveRangeReader";

function createBodyWithCancelSpy(bytes: Uint8Array) {
  const cancel = vi.fn(async () => undefined);
  return {
    cancel,
    response: {
      status: 206,
      headers: new Headers({ "Content-Length": String(bytes.byteLength) }),
      body: { cancel },
      arrayBuffer: async () => bytes.slice().buffer,
    } as unknown as Response,
  };
}

describe("GoogleDriveRangeReader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("コンストラクタで不正なdriveFileIdとtotalSizeをREAD_ERRORで拒否し正常値をトリム整合すること (AC-ENG-15)", () => {
    const getAccessToken = vi.fn(async () => "ya29.token");

    for (const badId of ["", "   ", "\t\n"]) {
      expect(
        () =>
          new GoogleDriveRangeReader({
            driveFileId: badId,
            totalSize: 100,
            getAccessToken,
          }),
      ).toThrow(ZipArchiveError);
      try {
        new GoogleDriveRangeReader({
          driveFileId: badId,
          totalSize: 100,
          getAccessToken,
        });
      } catch (error) {
        expect(error).toMatchObject({
          name: "ZipArchiveError",
          code: "READ_ERROR",
        });
      }
    }

    for (const badSize of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        () =>
          new GoogleDriveRangeReader({
            driveFileId: "file-1",
            totalSize: badSize,
            getAccessToken,
          }),
      ).toThrowError(expect.objectContaining({ code: "READ_ERROR" }));
    }

    const trimmedReader = new GoogleDriveRangeReader({
      driveFileId: "  file-abc-123  ",
      totalSize: 0,
      getAccessToken,
    });
    expect(trimmedReader.sourceId).toBe("gdrive:file-abc-123");
    expect(trimmedReader.totalSize).toBe(0);
  });

  it("不正引数・length=0・offset>=totalSizeを通信なしで適切に処理すること (AC-ENG-15)", async () => {
    const getAccessToken = vi.fn(async () => "ya29.token");
    const fetchImpl = vi.fn<typeof fetch>();
    const reader = new GoogleDriveRangeReader({
      driveFileId: "drive-file-1",
      totalSize: 10,
      getAccessToken,
      fetchImpl,
    });

    for (const [offset, length] of [
      [-1, 5],
      [0, -1],
      [1.5, 2],
      [0, 2.5],
      [Number.NaN, 2],
      [0, Number.POSITIVE_INFINITY],
      [Number.MAX_SAFE_INTEGER + 1, 1],
      [0, Number.MAX_SAFE_INTEGER + 1],
    ]) {
      await expect(reader.readRange(offset, length)).rejects.toMatchObject({
        name: "ZipArchiveError",
        code: "READ_ERROR",
      });
    }

    expect(await reader.readRange(0, 0)).toEqual(new Uint8Array(0));
    expect(await reader.readRange(10, 5)).toEqual(new Uint8Array(0));
    expect(await reader.readRange(20, 5)).toEqual(new Uint8Array(0));
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("206 Partial ContentでRange取得・終端クランプ・デフォルトglobalThis.fetch・URLエンコードを実行すること (AC-ENG-15)", async () => {
    const payload = new Uint8Array([10, 20, 30, 40, 50]);
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(payload.subarray(1, 4), {
          status: 206,
          headers: { "Content-Length": "3" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(payload.subarray(3, 5), {
          status: 206,
          headers: { "Content-Length": "invalid-len" },
        }),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const getAccessToken = vi.fn(async () => "ya29.valid-token");
    const reader = new GoogleDriveRangeReader({
      driveFileId: " id/with space ",
      totalSize: 5,
      getAccessToken,
    });

    const controller = new AbortController();
    const slice1 = await reader.readRange(1, 3, controller.signal);
    expect(slice1).toEqual(new Uint8Array([20, 30, 40]));
    expect(slice1.byteOffset).toBe(0);
    expect(slice1.buffer.byteLength).toBe(3);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://www.googleapis.com/drive/v3/files/id%2Fwith%20space?alt=media&supportsAllDrives=true",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer ya29.valid-token",
          Range: "bytes=1-3",
        },
        signal: controller.signal,
      },
    );

    // 終端クランプ & 不正非数値 Content-Length でも実ボディ長が一致すれば成功
    const slice2 = await reader.readRange(3, 100);
    expect(slice2).toEqual(new Uint8Array([40, 50]));
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://www.googleapis.com/drive/v3/files/id%2Fwith%20space?alt=media&supportsAllDrives=true",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer ya29.valid-token",
          Range: "bytes=3-4",
        },
        signal: undefined,
      },
    );
  });

  it("200 OKはファイル全体要求時のみ許容し部分範囲要求時の200 OKやContent-Length超過をOOM防御で即座にbody.cancel()遮断すること (AC-ENG-15)", async () => {
    const fullBytes = new Uint8Array([1, 2, 3, 4]);
    const onDiagnostic = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>();
    const reader = new GoogleDriveRangeReader({
      driveFileId: "file-oom",
      totalSize: 4,
      getAccessToken: async () => "ya29.secret-token",
      fetchImpl,
      onDiagnostic,
    });

    // 1. 全体要求 (offset=0, end=totalSize) の 200 OK は許容
    fetchImpl.mockResolvedValueOnce(
      new Response(fullBytes, {
        status: 200,
        headers: { "Content-Length": "4" },
      }),
    );
    expect(await reader.readRange(0, 10)).toEqual(fullBytes);

    // 2. 部分範囲要求 (offset=1, length=2) に 200 OK -> arrayBuffer() を呼ばず即時 body.cancel()
    const partial200Cancel = vi.fn(async () => undefined);
    const partial200ArrayBuffer = vi.fn(async () => new ArrayBuffer(100));
    fetchImpl.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ "Content-Length": "4" }),
      body: { cancel: partial200Cancel },
      arrayBuffer: partial200ArrayBuffer,
    } as unknown as Response);

    await expect(reader.readRange(1, 2)).rejects.toMatchObject({
      name: "ZipArchiveError",
      code: "READ_ERROR",
    });
    expect(partial200Cancel).toHaveBeenCalledTimes(1);
    expect(partial200ArrayBuffer).not.toHaveBeenCalled();

    // 3. offset=0 でも部分範囲 (end < totalSize) で 200 OK は遮断
    const headPartialCancel = vi.fn(async () => undefined);
    const headPartialArrayBuffer = vi.fn(async () => new ArrayBuffer(4));
    fetchImpl.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ "Content-Length": "4" }),
      body: { cancel: headPartialCancel },
      arrayBuffer: headPartialArrayBuffer,
    } as unknown as Response);

    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
    });
    expect(headPartialCancel).toHaveBeenCalledTimes(1);
    expect(headPartialArrayBuffer).not.toHaveBeenCalled();

    // 4. 206 で Content-Length > expectedLength の場合も arrayBuffer() 前に body.cancel()
    const oversized206Cancel = vi.fn(async () => undefined);
    const oversized206ArrayBuffer = vi.fn(async () => new ArrayBuffer(10));
    fetchImpl.mockResolvedValueOnce({
      status: 206,
      headers: new Headers({ "Content-Length": "10" }),
      body: { cancel: oversized206Cancel },
      arrayBuffer: oversized206ArrayBuffer,
    } as unknown as Response);

    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
    });
    expect(oversized206Cancel).toHaveBeenCalledTimes(1);
    expect(oversized206ArrayBuffer).not.toHaveBeenCalled();

    // 5. 全体要求 200 OK でも Content-Length > expectedLength なら遮断（body.cancel() 失敗・null body も安全処理）
    const failingCancel = vi.fn().mockRejectedValueOnce(new Error("locked"));
    fetchImpl.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ "Content-Length": "999" }),
      body: { cancel: failingCancel },
      arrayBuffer: vi.fn(),
    } as unknown as Response);

    await expect(reader.readRange(0, 4)).rejects.toMatchObject({
      code: "READ_ERROR",
    });
    expect(failingCancel).toHaveBeenCalledTimes(1);

    // 非数値・オーバーフロー Content-Length ("1e309" 相当の巨大桁は Infinity) は無視して実ボディ長へ進むこと
    fetchImpl.mockResolvedValueOnce(
      new Response(fullBytes, {
        status: 200,
        headers: { "Content-Length": "9".repeat(400) },
      }),
    );
    expect(await reader.readRange(0, 4)).toEqual(fullBytes);
    expect(onDiagnostic).toHaveBeenCalledWith(
      "error",
      expect.any(String),
      expect.any(String),
    );
  });

  it("401応答時にbody解放・warn記録の上failedToken付きで1回のみ透過リトライし再401やトークン取得失敗時はREAD_ERRORとマスク済みerror記録を行うこと (AC-ENG-15)", async () => {
    const getAccessToken = vi
      .fn<
        (options?: {
          readonly forceRefresh?: boolean;
          readonly failedToken?: string;
        }) => Promise<string>
      >()
      .mockResolvedValueOnce("ya29.expired-secret")
      .mockResolvedValueOnce("ya29.refreshed-secret");
    const fetchImpl = vi.fn<typeof fetch>();
    const onDiagnostic = vi.fn();
    const reader = new GoogleDriveRangeReader({
      driveFileId: "file-auth",
      totalSize: 10,
      getAccessToken,
      fetchImpl,
      onDiagnostic,
    });

    const first401Cancel = vi.fn(async () => undefined);
    fetchImpl
      .mockResolvedValueOnce({
        status: 401,
        headers: new Headers(),
        body: { cancel: first401Cancel },
        arrayBuffer: vi.fn(),
      } as unknown as Response)
      .mockResolvedValueOnce(
        new Response(new Uint8Array([7, 8]), {
          status: 206,
          headers: { "Content-Length": "2" },
        }),
      );

    expect(await reader.readRange(2, 2)).toEqual(new Uint8Array([7, 8]));
    expect(first401Cancel).toHaveBeenCalledTimes(1);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(getAccessToken).toHaveBeenNthCalledWith(2, {
      forceRefresh: true,
      failedToken: "ya29.expired-secret",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetchImpl.mock.calls[1]![1]?.headers).get("Authorization"),
    ).toBe("Bearer ya29.refreshed-secret");
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    expect(onDiagnostic).toHaveBeenCalledWith(
      "warn",
      expect.any(String),
      expect.not.stringContaining("ya29.expired-secret"),
    );

    // 再リクエストも 401 なら 1 回限りのリトライで打ち切り READ_ERROR
    onDiagnostic.mockClear();
    getAccessToken
      .mockResolvedValueOnce("ya29.tok-a")
      .mockResolvedValueOnce("ya29.tok-b");
    fetchImpl
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(onDiagnostic).toHaveBeenCalledWith(
      "error",
      expect.any(String),
      expect.any(String),
    );

    // リトライ時の getAccessToken 失敗（非AbortError、生トークン含み）はマスクして READ_ERROR
    onDiagnostic.mockClear();
    getAccessToken
      .mockResolvedValueOnce("ya29.tok-c")
      .mockRejectedValueOnce(new Error("Bearer ya29.leaked-in-error"));
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
    });
    const lastErrCall = onDiagnostic.mock.calls.at(-1)!;
    expect(lastErrCall[0]).toBe("error");
    expect(lastErrCall[2]).not.toContain("ya29.leaked-in-error");
    expect(lastErrCall[2]).toContain("[REDACTED]");

    // 初回 getAccessToken 失敗（非Error値）もマスクして READ_ERROR
    getAccessToken.mockRejectedValueOnce("ya29.raw-string-secret failure");
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
    });
    expect(onDiagnostic.mock.calls.at(-1)![2]).not.toContain(
      "ya29.raw-string-secret",
    );
  });

  it("403/404/416/429/5xx/通信断/ストリーム失敗/ボディ長不一致をリトライせずREAD_ERRORにしマスク済み診断記録を行うこと (AC-ENG-15)", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const onDiagnostic = vi.fn();
    const reader = new GoogleDriveRangeReader({
      driveFileId: "file-err",
      totalSize: 10,
      getAccessToken: async () => "ya29.secret",
      fetchImpl,
      onDiagnostic,
    });

    for (const status of [403, 404, 416, 429, 500, 503]) {
      const { response, cancel } = createBodyWithCancelSpy(new Uint8Array(0));
      Object.assign(response, { status });
      fetchImpl.mockResolvedValueOnce(response);

      await expect(reader.readRange(0, 2)).rejects.toMatchObject({
        name: "ZipArchiveError",
        code: "READ_ERROR",
      });
      expect(cancel).toHaveBeenCalledTimes(1);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(6);

    // fetch ネットワーク失敗（Error / 文字列の双方）
    fetchImpl.mockRejectedValueOnce(new Error("network down ya29.net-secret"));
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
    });
    expect(onDiagnostic.mock.calls.at(-1)![2]).not.toContain("ya29.net-secret");

    fetchImpl.mockRejectedValueOnce("offline");
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
    });

    // arrayBuffer() 読込エラー（Error / 文字列の双方）
    fetchImpl.mockResolvedValueOnce({
      status: 206,
      headers: new Headers({ "Content-Length": "2" }),
      body: null,
      arrayBuffer: vi
        .fn()
        .mockRejectedValueOnce(new Error("stream reset ya29.stream-secret")),
    } as unknown as Response);
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
    });
    expect(onDiagnostic.mock.calls.at(-1)![2]).not.toContain(
      "ya29.stream-secret",
    );

    fetchImpl.mockResolvedValueOnce({
      status: 206,
      headers: new Headers({ "Content-Length": "2" }),
      body: null,
      arrayBuffer: vi.fn().mockRejectedValueOnce("truncated stream"),
    } as unknown as Response);
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
    });

    // ボディ長不一致: 短尺切断 (actual < expected)
    fetchImpl.mockResolvedValueOnce(
      new Response(new Uint8Array([1]), {
        status: 206,
        headers: { "Content-Length": "1" },
      }),
    );
    await expect(reader.readRange(0, 3)).rejects.toMatchObject({
      code: "READ_ERROR",
    });

    // ボディ長不一致: Content-Length 省略時の超過応答 (actual > expected)
    fetchImpl.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
      }),
    );
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
    });

    // onDiagnostic 未指定時もエラーが正常に READ_ERROR へ変換されること
    const noDiagReader = new GoogleDriveRangeReader({
      driveFileId: "file-no-diag",
      totalSize: 10,
      getAccessToken: async () => "ya29.tok",
      fetchImpl: vi.fn(async () => new Response(null, { status: 500 })),
    });
    await expect(noDiagReader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
    });
  });

  it("全await境界でのAbortSignal中断をAbortErrorとして再送出しREAD_ERRORや診断エラーログにしないこと (AC-ENG-15)", async () => {
    const onDiagnostic = vi.fn();

    // 1. 事前 abort
    const getAccessToken = vi.fn(async () => "ya29.tok");
    const fetchImpl = vi.fn<typeof fetch>();
    const reader = new GoogleDriveRangeReader({
      driveFileId: "file-abort",
      totalSize: 10,
      getAccessToken,
      fetchImpl,
      onDiagnostic,
    });

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      reader.readRange(0, 2, preAborted.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(getAccessToken).not.toHaveBeenCalled();

    // 2. getAccessToken 中の abort (AbortError 送出 / signal 中断解決)
    getAccessToken.mockRejectedValueOnce(
      new DOMException("Token aborted", "AbortError"),
    );
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      name: "AbortError",
    });

    const tokenAbortCtrl = new AbortController();
    getAccessToken.mockImplementationOnce(async () => {
      tokenAbortCtrl.abort();
      return "ya29.tok";
    });
    await expect(
      reader.readRange(0, 2, tokenAbortCtrl.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });

    // 3. fetch 中の abort (AbortError 送出 / signal.aborted 下の非Abortエラー / fetch 解決後 aborted)
    fetchImpl.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      name: "AbortError",
    });

    const fetchRejectCtrl = new AbortController();
    fetchImpl.mockImplementationOnce(async () => {
      fetchRejectCtrl.abort();
      throw new TypeError("Failed to fetch");
    });
    await expect(
      reader.readRange(0, 2, fetchRejectCtrl.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });

    const postFetchCtrl = new AbortController();
    const cancelOnPostFetchAbort = vi.fn(async () => undefined);
    fetchImpl.mockImplementationOnce(async () => {
      postFetchCtrl.abort();
      return {
        status: 206,
        headers: new Headers(),
        body: { cancel: cancelOnPostFetchAbort },
        arrayBuffer: vi.fn(),
      } as unknown as Response;
    });
    await expect(
      reader.readRange(0, 2, postFetchCtrl.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(cancelOnPostFetchAbort).toHaveBeenCalledTimes(1);

    // 4. arrayBuffer() 中の abort (AbortError 送出 / signal.aborted 下の非Abortエラー / arrayBuffer 解決後 aborted)
    fetchImpl.mockResolvedValueOnce({
      status: 206,
      headers: new Headers({ "Content-Length": "2" }),
      body: null,
      arrayBuffer: vi
        .fn()
        .mockRejectedValueOnce(new DOMException("Body aborted", "AbortError")),
    } as unknown as Response);
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      name: "AbortError",
    });

    const bodyRejectCtrl = new AbortController();
    fetchImpl.mockResolvedValueOnce({
      status: 206,
      headers: new Headers({ "Content-Length": "2" }),
      body: null,
      arrayBuffer: async () => {
        bodyRejectCtrl.abort();
        throw new Error("read aborted");
      },
    } as unknown as Response);
    await expect(
      reader.readRange(0, 2, bodyRejectCtrl.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });

    const postBodyCtrl = new AbortController();
    fetchImpl.mockResolvedValueOnce({
      status: 206,
      headers: new Headers({ "Content-Length": "2" }),
      body: null,
      arrayBuffer: async () => {
        postBodyCtrl.abort();
        return new Uint8Array([1, 2]).buffer;
      },
    } as unknown as Response);
    await expect(
      reader.readRange(0, 2, postBodyCtrl.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(onDiagnostic).not.toHaveBeenCalled();

    // 5. 401 リトライ中の getAccessToken で AbortError 発生時も AbortError 再送出（error ログなし）
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 401 }));
    getAccessToken
      .mockResolvedValueOnce("ya29.tok-1")
      .mockRejectedValueOnce(new DOMException("Refresh aborted", "AbortError"));
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    expect(onDiagnostic).toHaveBeenCalledWith(
      "warn",
      expect.any(String),
      expect.any(String),
    );
  });

  it("429・403 Rate Limit/権限エラー・2回目401・GoogleAuthError・その他HTTPエラーに構造化メタデータを付与すること (AC-COV-06)", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const getAccessToken = vi.fn(async () => "ya29.tok");
    const reader = new GoogleDriveRangeReader({
      driveFileId: "file-meta",
      totalSize: 10,
      getAccessToken,
      fetchImpl,
    });

    // 1. 429 -> httpStatus: 429, isRateLimited: true
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 429 }));
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
      httpStatus: 429,
      isRateLimited: true,
    });

    // 2. 403 Rate Limit reason 4種 -> httpStatus: 403, isRateLimited: true
    for (const reason of [
      "rateLimitExceeded",
      "userRateLimitExceeded",
      "downloadQuotaExceeded",
      "quotaExceeded",
    ]) {
      fetchImpl.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              errors: [{ reason, message: "Limit exceeded" }],
            },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      );
      await expect(reader.readRange(0, 2)).rejects.toMatchObject({
        code: "READ_ERROR",
        httpStatus: 403,
        isRateLimited: true,
      });
    }

    // 3. 403 非Rate Limit reason / 不正構造JSON / 非JSONボディ -> httpStatus: 403, isRateLimited: false
    const nonRateLimit403Payloads = [
      JSON.stringify({
        error: { errors: [{ reason: "insufficientFilePermissions" }] },
      }),
      JSON.stringify({ error: { errors: [null, { reason: 123 }] } }),
      JSON.stringify({ error: "not-an-object" }),
      JSON.stringify(null),
      "<html>Forbidden</html>",
    ];
    for (const body of nonRateLimit403Payloads) {
      fetchImpl.mockResolvedValueOnce(new Response(body, { status: 403 }));
      await expect(reader.readRange(0, 2)).rejects.toMatchObject({
        code: "READ_ERROR",
        httpStatus: 403,
        isRateLimited: false,
      });
    }

    // 4. 403 JSON 読込中の AbortSignal 中断は AbortError を再送出
    const abort403Ctrl = new AbortController();
    fetchImpl.mockResolvedValueOnce({
      status: 403,
      headers: new Headers(),
      body: null,
      json: async () => {
        abort403Ctrl.abort();
        throw new Error("aborted while parsing json");
      },
    } as unknown as Response);
    await expect(
      reader.readRange(0, 2, abort403Ctrl.signal),
    ).rejects.toMatchObject({ name: "AbortError" });

    const abort403AfterJsonCtrl = new AbortController();
    fetchImpl.mockResolvedValueOnce({
      status: 403,
      headers: new Headers(),
      body: null,
      json: async () => {
        abort403AfterJsonCtrl.abort();
        return { error: { errors: [{ reason: "rateLimitExceeded" }] } };
      },
    } as unknown as Response);
    await expect(
      reader.readRange(0, 2, abort403AfterJsonCtrl.signal),
    ).rejects.toMatchObject({ name: "AbortError" });

    // 5. 2回目 401 -> httpStatus: 401, isUnauthorized: true
    fetchImpl
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
      httpStatus: 401,
      isUnauthorized: true,
    });

    // 6. getAccessToken の GoogleAuthError: AUTH_REQUIRED / AUTH_CANCELLED / AUTH_FAILED は isUnauthorized: true、AUTH_NETWORK_ERROR は undefined
    for (const authCode of [
      "AUTH_REQUIRED",
      "AUTH_CANCELLED",
      "AUTH_FAILED",
    ] as const) {
      getAccessToken.mockRejectedValueOnce(
        new GoogleAuthError(authCode, `auth error ${authCode}`),
      );
      await expect(reader.readRange(0, 2)).rejects.toMatchObject({
        code: "READ_ERROR",
        isUnauthorized: true,
      });
    }

    getAccessToken.mockRejectedValueOnce(
      new GoogleAuthError("AUTH_NETWORK_ERROR", "offline"),
    );
    let caughtNetErr: unknown;
    try {
      await reader.readRange(0, 2);
    } catch (error) {
      caughtNetErr = error;
    }
    expect(caughtNetErr).toBeInstanceOf(ZipArchiveError);
    expect((caughtNetErr as ZipArchiveError).isUnauthorized).toBeUndefined();

    // 7. その他の非 206/200 ステータス (404, 503) -> httpStatus: status, isRateLimited: false
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
      httpStatus: 404,
      isRateLimited: false,
    });

    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(reader.readRange(0, 2)).rejects.toMatchObject({
      code: "READ_ERROR",
      httpStatus: 503,
      isRateLimited: false,
    });
  });
});
