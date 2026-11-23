import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDiagnosticLogger } from "../../diagnostics/diagnosticLogger";
import { db, resetTestDb } from "../../storage/db";
import { GoogleAuthError } from "./googleAuthErrors";
import {
  GoogleAuthTokenManager,
  TOKEN_DEFAULT_TTL_MS,
  TOKEN_EARLY_REFRESH_MARGIN_MS,
} from "./googleAuthTokenManager";
import type {
  GoogleAuthAdapter,
  GoogleAuthAdapterRefreshResult,
  GoogleAuthAdapterRestoreResult,
  GoogleAuthAdapterSignInResult,
  GoogleAuthSession,
} from "./types";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMockAdapter(
  overrides: Partial<GoogleAuthAdapter> = {},
): GoogleAuthAdapter {
  return {
    restoreSession: vi.fn(async () => ({ status: "unlinked" as const })),
    signIn: vi.fn(async () => ({
      status: "connected" as const,
      accessToken: "ya29.sign-in-token",
      email: "reader@example.com",
    })),
    refreshAccessToken: vi.fn(async () => ({
      accessToken: "ya29.refreshed-token",
      email: "reader@example.com",
    })),
    signOut: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("GoogleAuthTokenManager", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDb();
  });

  it("有効期限・事前更新マージン定数を保持し、getCachedSessionと登録時非発火のsubscribeSessionを提供すること (AC-GD-03, AC-GD-04)", async () => {
    expect(TOKEN_DEFAULT_TTL_MS).toBe(3_600_000);
    expect(TOKEN_EARLY_REFRESH_MARGIN_MS).toBe(300_000);

    let now = 1_000_000;
    const adapter = createMockAdapter();
    const manager = new GoogleAuthTokenManager(adapter, { now: () => now });

    expect(manager.getCachedSession()).toBeNull();

    const listener = vi.fn<(session: GoogleAuthSession | null) => void>();
    const unsubscribe = manager.subscribeSession(listener);
    // 登録時点では同期発火しないこと
    expect(listener).not.toHaveBeenCalled();

    // 未連携復元では状態変化しないため購読発火しないこと
    expect(await manager.getSession()).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    // サインイン成功時は期限 now + 3_600_000 を設定し購読通知すること
    const session = await manager.signIn();
    expect(session).toEqual({
      email: "reader@example.com",
      accessToken: "ya29.sign-in-token",
      expiresAt: now + TOKEN_DEFAULT_TTL_MS,
    });
    expect(manager.getCachedSession()).toEqual(session);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(session);

    // 同一内容での再サインインは状態不変のため購読通知しない（expiresAt 変化時のみ通知）
    await manager.signIn();
    expect(listener).toHaveBeenCalledTimes(1);
    now += 1000;
    await manager.signIn();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({
      email: "reader@example.com",
      accessToken: "ya29.sign-in-token",
      expiresAt: now + TOKEN_DEFAULT_TTL_MS,
    });

    // 同一状態での getSession() は restoreSession を追加呼び出ししない
    expect(await manager.getSession()).toEqual(manager.getCachedSession());
    expect(adapter.restoreSession).toHaveBeenCalledTimes(1);

    // 購読解除（2回呼び出し冪等）後は通知されないこと
    unsubscribe();
    unsubscribe();
    await manager.signOut();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(manager.getCachedSession()).toBeNull();
  });

  it("getSessionのSingle-Flight並列集約とAUTH_NETWORK_ERROR時の警告ログ＋null救済、非ネットワークエラー送出を正しく処理すること (AC-GD-03)", async () => {
    const now = 5_000_000;
    const logger = createDiagnosticLogger(20);
    const restoreDeferred = createDeferred<GoogleAuthAdapterRestoreResult>();
    const adapter = createMockAdapter({
      restoreSession: vi.fn(() => restoreDeferred.promise),
    });
    const manager = new GoogleAuthTokenManager(adapter, {
      now: () => now,
      logger,
    });

    // 並列 getSession() は 1 回の adapter.restoreSession() に集約される
    const p1 = manager.getSession();
    const p2 = manager.getSession();
    expect(adapter.restoreSession).toHaveBeenCalledTimes(1);

    restoreDeferred.resolve({
      status: "connected",
      accessToken: "ya29.restored-1",
      email: "restored@example.com",
    });
    const [s1, s2] = await Promise.all([p1, p2]);
    expect(s1).toEqual({
      email: "restored@example.com",
      accessToken: "ya29.restored-1",
      expiresAt: now + TOKEN_DEFAULT_TTL_MS,
    });
    expect(s2).toEqual(s1);

    // 未保持時の AUTH_NETWORK_ERROR は warn ログ記録の上 null 救済
    const offlineManager = new GoogleAuthTokenManager(
      createMockAdapter({
        restoreSession: vi.fn(async () => {
          throw new GoogleAuthError(
            "AUTH_NETWORK_ERROR",
            "offline with ya29.shouldNotLeak",
          );
        }),
      }),
      { logger },
    );
    expect(await offlineManager.getSession()).toBeNull();
    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "warn",
      scope: "oauth",
    });
    expect(entries[0]?.detail).not.toContain("ya29.shouldNotLeak");

    // AUTH_FAILED 等はそのまま reject すること
    const brokenManager = new GoogleAuthTokenManager(
      createMockAdapter({
        restoreSession: vi.fn(async () => {
          throw new GoogleAuthError("AUTH_FAILED", "gms fatal");
        }),
      }),
      { logger },
    );
    await expect(brokenManager.getSession()).rejects.toMatchObject({
      code: "AUTH_FAILED",
    });
  });

  it("残り有効期限5分境界・Single-Flight更新・並列時差401に対するfailedToken Compare-and-Refresh保護が動作すること (AC-GD-03)", async () => {
    let now = 10_000_000;
    const refreshDeferred = createDeferred<GoogleAuthAdapterRefreshResult>();
    const refreshMock = vi
      .fn<GoogleAuthAdapter["refreshAccessToken"]>()
      .mockImplementationOnce(() => refreshDeferred.promise)
      .mockResolvedValueOnce({
        accessToken: "T2",
      });

    const adapter = createMockAdapter({
      signIn: vi.fn(async () => ({
        status: "connected" as const,
        accessToken: "T0",
        email: "reader@example.com",
      })),
      refreshAccessToken: refreshMock,
    });

    const manager = new GoogleAuthTokenManager(adapter, { now: () => now });
    const events: Array<GoogleAuthSession | null> = [];
    manager.subscribeSession((s) => events.push(s));

    await manager.signIn();
    // ちょうど残り 300_000ms (5分) はまだ有効でリフレッシュしない
    now += TOKEN_DEFAULT_TTL_MS - TOKEN_EARLY_REFRESH_MARGIN_MS;
    expect(await manager.getValidAccessToken()).toBe("T0");
    expect(refreshMock).not.toHaveBeenCalled();

    // 1ms 進んで残り 299_999ms (< 5分) になるとプロアクティブ更新を Single-Flight 集約
    now += 1;
    const r1 = manager.getValidAccessToken();
    const r2 = manager.getValidAccessToken({
      forceRefresh: true,
      failedToken: "T0",
    });
    const r3 = manager.getValidAccessToken();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledWith({
      previousToken: "T0",
      clearCache: true,
    });

    refreshDeferred.resolve({
      accessToken: "T1",
    });
    expect(await Promise.all([r1, r2, r3])).toEqual(["T1", "T1", "T1"]);

    // 後発の時差 401 が旧トークン failedToken: "T0" 付きで到着しても Compare-and-Refresh で clearToken をスキップし T1 を即返却
    const late401Token = await manager.getValidAccessToken({
      forceRefresh: true,
      failedToken: "T0",
    });
    expect(late401Token).toBe("T1");
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // 新トークン T1 自体に対する 401 (failedToken: "T1") の場合は実際にリフレッシュを実行
    const t2 = await manager.getValidAccessToken({
      forceRefresh: true,
      failedToken: "T1",
    });
    expect(t2).toBe("T2");
    expect(refreshMock).toHaveBeenCalledTimes(2);
    expect(refreshMock).toHaveBeenLastCalledWith({
      previousToken: "T1",
      clearCache: true,
    });
    expect(manager.getCachedSession()?.email).toBe("reader@example.com");
    expect(events.map((s) => s?.accessToken ?? null)).toEqual([
      "T0",
      "T1",
      "T2",
    ]);

    // Compare-and-Refresh でも現トークン T1/T2 が期限間近 (<5分) の場合は更新へ進むこと
    refreshMock.mockResolvedValueOnce({
      accessToken: "T3",
      expiresAt: now + TOKEN_DEFAULT_TTL_MS,
    });
    now += TOKEN_DEFAULT_TTL_MS - TOKEN_EARLY_REFRESH_MARGIN_MS + 1;
    expect(
      await manager.getValidAccessToken({
        forceRefresh: true,
        failedToken: "T0",
      }),
    ).toBe("T3");
    expect(refreshMock).toHaveBeenCalledTimes(3);
  });

  it("未復元状態からのgetValidAccessToken・AUTH_REQUIRED失効・AUTH_NETWORK_ERROR時のセッション維持を正しく処理すること (AC-GD-03)", async () => {
    const now = 20_000_000;

    // 1. 未連携なら AUTH_REQUIRED
    const unlinkedManager = new GoogleAuthTokenManager(createMockAdapter(), {
      now: () => now,
    });
    await expect(unlinkedManager.getValidAccessToken()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });

    // 2. 未復元・オフライン時は AUTH_NETWORK_ERROR をそのまま送出（AUTH_REQUIRED に誤変換しない）
    const offlineManager = new GoogleAuthTokenManager(
      createMockAdapter({
        restoreSession: vi.fn(async () => {
          throw new GoogleAuthError("AUTH_NETWORK_ERROR", "offline");
        }),
      }),
      { now: () => now },
    );
    await expect(offlineManager.getValidAccessToken()).rejects.toMatchObject({
      code: "AUTH_NETWORK_ERROR",
    });

    // 3. 未復元かつ linked の状態から getValidAccessToken() で復元成功し、forceRefresh + failedToken === restored 時は即リフレッシュ
    const restoreThenRefreshAdapter = createMockAdapter({
      restoreSession: vi.fn(async () => ({
        status: "connected" as const,
        accessToken: "T-restored",
        email: "restored@example.com",
      })),
      refreshAccessToken: vi.fn(async () => ({
        accessToken: "T-after-restored-401",
      })),
    });
    const manager3 = new GoogleAuthTokenManager(restoreThenRefreshAdapter, {
      now: () => now,
    });
    expect(await manager3.getValidAccessToken()).toBe("T-restored");

    const manager4 = new GoogleAuthTokenManager(restoreThenRefreshAdapter, {
      now: () => now,
    });
    expect(
      await manager4.getValidAccessToken({
        forceRefresh: true,
        failedToken: "T-restored",
      }),
    ).toBe("T-after-restored-401");

    const managerColdForceNoFailed = new GoogleAuthTokenManager(
      restoreThenRefreshAdapter,
      { now: () => now },
    );
    expect(
      await managerColdForceNoFailed.getValidAccessToken({
        forceRefresh: true,
      }),
    ).toBe("T-after-restored-401");

    const managerColdDifferentFailed = new GoogleAuthTokenManager(
      restoreThenRefreshAdapter,
      { now: () => now },
    );
    expect(
      await managerColdDifferentFailed.getValidAccessToken({
        forceRefresh: true,
        failedToken: "T-older-different",
      }),
    ).toBe("T-restored");

    // 4. refreshAccessToken で AUTH_REQUIRED ならキャッシュセッション破棄＆購読通知、AUTH_NETWORK_ERROR ならセッション維持
    const listener = vi.fn();
    manager4.subscribeSession(listener);
    vi.mocked(
      restoreThenRefreshAdapter.refreshAccessToken,
    ).mockRejectedValueOnce(
      new GoogleAuthError("AUTH_NETWORK_ERROR", "transient"),
    );
    await expect(
      manager4.getValidAccessToken({ forceRefresh: true }),
    ).rejects.toMatchObject({ code: "AUTH_NETWORK_ERROR" });
    expect(manager4.getCachedSession()?.accessToken).toBe(
      "T-after-restored-401",
    );

    vi.mocked(
      restoreThenRefreshAdapter.refreshAccessToken,
    ).mockRejectedValueOnce(new GoogleAuthError("AUTH_REQUIRED", "revoked"));
    await expect(
      manager4.getValidAccessToken({ forceRefresh: true }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(manager4.getCachedSession()).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(null);
  });

  it("authEpoch世代ガードによりsignOut/新規signIn後の遅延復元・遅延リフレッシュが状態を逆転させず、signOutでIndexedDBデータを保持すること (AC-GD-03, AC-GD-04)", async () => {
    const now = 30_000_000;

    // 1. restoreSession 進行中に signOut された場合、遅延解決でもセッション復活しない
    const restoreDeferred = createDeferred<GoogleAuthAdapterRestoreResult>();
    const adapter1 = createMockAdapter({
      restoreSession: vi.fn(() => restoreDeferred.promise),
    });
    const manager1 = new GoogleAuthTokenManager(adapter1, { now: () => now });
    const pendingRestore = manager1.getSession();
    await manager1.signOut();
    restoreDeferred.resolve({
      status: "connected",
      accessToken: "stale-restored",
      email: "stale@example.com",
    });
    expect(await pendingRestore).toBeNull();
    expect(manager1.getCachedSession()).toBeNull();

    // 2. refreshAccessToken 進行中に signOut された場合、遅延解決を破棄し AUTH_REQUIRED で拒否
    const refreshDeferred = createDeferred<GoogleAuthAdapterRefreshResult>();
    const adapter2 = createMockAdapter({
      refreshAccessToken: vi.fn(() => refreshDeferred.promise),
    });
    const manager2 = new GoogleAuthTokenManager(adapter2, { now: () => now });
    await manager2.signIn();
    const pendingRefresh = manager2.getValidAccessToken({ forceRefresh: true });
    await manager2.signOut();
    refreshDeferred.resolve({ accessToken: "stale-refreshed" });
    await expect(pendingRefresh).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(manager2.getCachedSession()).toBeNull();

    // 3. 未復元状態の getValidAccessToken 待機中に signOut された場合も AUTH_REQUIRED
    const restoreForTokenDeferred =
      createDeferred<GoogleAuthAdapterRestoreResult>();
    const manager3 = new GoogleAuthTokenManager(
      createMockAdapter({
        restoreSession: vi.fn(() => restoreForTokenDeferred.promise),
      }),
      { now: () => now },
    );
    const pendingToken = manager3.getValidAccessToken();
    await manager3.signOut();
    restoreForTokenDeferred.resolve({
      status: "connected",
      accessToken: "late-token",
      email: "late@example.com",
    });
    await expect(pendingToken).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(manager3.getCachedSession()).toBeNull();

    // 4. signIn() 進行中に signOut() された場合、遅延 signIn はセッションを上書きしない
    const signInDeferred = createDeferred<GoogleAuthAdapterSignInResult>();
    const manager4 = new GoogleAuthTokenManager(
      createMockAdapter({
        signIn: vi.fn(() => signInDeferred.promise),
      }),
      { now: () => now },
    );
    const pendingSignIn = manager4.signIn();
    await manager4.signOut();
    signInDeferred.resolve({
      status: "connected",
      accessToken: "late-signin",
      email: "late@example.com",
    });
    await expect(pendingSignIn).rejects.toMatchObject({
      code: "AUTH_CANCELLED",
    });
    expect(manager4.getCachedSession()).toBeNull();

    // 5. signIn() キャンセル・エラーおよび signOut() 失敗時の振る舞い
    const manager5 = new GoogleAuthTokenManager(
      createMockAdapter({
        signIn: vi.fn(async () => ({ status: "cancelled" as const })),
        signOut: vi.fn(async () => {
          throw new Error("revoke bridge failed");
        }),
      }),
      { now: () => now },
    );
    await expect(manager5.signIn()).rejects.toMatchObject({
      code: "AUTH_CANCELLED",
    });
    await expect(manager5.signOut()).rejects.toMatchObject({
      code: "AUTH_FAILED",
    });

    // 6. signOut() 実行時も IndexedDB の readingProgress / syncMeta が削除されず保持されること
    await db.syncMeta.put({ key: "keepMeta", value: "v1" });
    await db.readingProgress.put({
      targetKey: "vol:vol-1",
      volumeId: "vol-1",
      currentPageIndex: 5,
      totalPageCount: 20,
      readStatus: "reading",
      spreadPageOffset: 0,
      lastReadAt: 1000,
      updatedAt: 1000,
    });
    const manager6 = new GoogleAuthTokenManager(createMockAdapter(), {
      now: () => now,
    });
    await manager6.signIn();
    await manager6.signOut();
    expect(await db.syncMeta.get("keepMeta")).toEqual({
      key: "keepMeta",
      value: "v1",
    });
    expect(await db.readingProgress.get("vol:vol-1")).not.toBeNull();
  });
});
