import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleAuthError } from "./googleAuthErrors";
import {
  DEFAULT_MOCK_GOOGLE_EMAIL,
  MockGoogleAuthAdapter,
} from "./mockGoogleAuthAdapter";

describe("MockGoogleAuthAdapter", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ゼロコンフィグの未連携初期状態からサインイン・サイレント復元・トークンローテーション・サインアウトが動作すること (AC-GD-02)", async () => {
    expect(DEFAULT_MOCK_GOOGLE_EMAIL).toBe("reader@example.com");
    const adapter = new MockGoogleAuthAdapter();

    expect(adapter.getLinkedState()).toEqual({
      linked: false,
      email: "reader@example.com",
      currentAccessToken: null,
      refreshCount: 0,
      lastRefreshOptions: null,
    });
    expect(await adapter.restoreSession()).toEqual({ status: "unlinked" });

    // 未連携時の refreshAccessToken は AUTH_REQUIRED
    await expect(
      adapter.refreshAccessToken({ previousToken: null, clearCache: false }),
    ).rejects.toMatchObject({
      name: "GoogleAuthError",
      code: "AUTH_REQUIRED",
    });

    // サインインでトークン発行・連携済みへ遷移
    const signInRes = await adapter.signIn();
    expect(signInRes).toEqual({
      status: "connected",
      accessToken: "mock-drive-token-1",
      email: "reader@example.com",
    });
    expect(await adapter.restoreSession()).toEqual(signInRes);

    // リフレッシュで自動ローテーションし、カスタム次期トークン指定も反映する
    const refresh1 = await adapter.refreshAccessToken({
      previousToken: "mock-drive-token-1",
      clearCache: true,
    });
    expect(refresh1).toEqual({
      accessToken: "mock-drive-token-2",
      email: "reader@example.com",
    });

    adapter.setEmail("custom@example.com");
    adapter.setNextIssuedToken("custom-rotated-token");
    const refresh2 = await adapter.refreshAccessToken({
      previousToken: "mock-drive-token-2",
      clearCache: true,
    });
    expect(refresh2).toEqual({
      accessToken: "custom-rotated-token",
      email: "custom@example.com",
    });
    expect(adapter.getLinkedState()).toEqual({
      linked: true,
      email: "custom@example.com",
      currentAccessToken: "custom-rotated-token",
      refreshCount: 2,
      lastRefreshOptions: {
        previousToken: "mock-drive-token-2",
        clearCache: true,
      },
    });

    await adapter.signOut({ previousToken: "custom-rotated-token" });
    expect(await adapter.restoreSession()).toEqual({ status: "unlinked" });
    expect(adapter.getLinkedState().currentAccessToken).toBeNull();
  });

  it("シード初期化・キャンセル・遅延応答・各種エラー注入フックおよびresetが動作すること (AC-GD-02)", async () => {
    vi.useFakeTimers();
    const clock = 10_000;
    const adapter = new MockGoogleAuthAdapter({
      initialLinked: true,
      email: "seeded@example.com",
      initialAccessToken: "seeded-token-0",
      tokenTtlMs: 60_000,
      now: () => clock,
    });

    expect(await adapter.restoreSession()).toEqual({
      status: "connected",
      accessToken: "seeded-token-0",
      email: "seeded@example.com",
      expiresAt: 70_000,
    });

    // 1回限りのサインインキャンセル注入
    adapter.queueNextSignInCancelled();
    expect(await adapter.signIn()).toEqual({ status: "cancelled" });
    expect((await adapter.signIn()).status).toBe("connected");

    // 遅延応答（優先度1戻るブロック検証向け）
    adapter.setOperationDelay("signIn", 500);
    let signInResolved = false;
    const delayedSignIn = adapter.signIn().then((res) => {
      signInResolved = true;
      return res;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(signInResolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signInResolved).toBe(true);
    await delayedSignIn;
    adapter.setOperationDelay("signIn", 0);

    // 各操作へのエラー注入
    adapter.queueNextFailure("restoreSession", "AUTH_NETWORK_ERROR");
    await expect(adapter.restoreSession()).rejects.toMatchObject({
      code: "AUTH_NETWORK_ERROR",
    });

    adapter.queueNextFailure(
      "signIn",
      new GoogleAuthError("AUTH_FAILED", "injected sign-in error"),
    );
    await expect(adapter.signIn()).rejects.toMatchObject({
      code: "AUTH_FAILED",
      message: "injected sign-in error",
    });

    adapter.queueNextFailure("refreshAccessToken", "AUTH_REQUIRED");
    await expect(
      adapter.refreshAccessToken({ previousToken: "x", clearCache: true }),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    // AUTH_REQUIRED 発生後は未連携状態へ戻ること
    expect(adapter.getLinkedState().linked).toBe(false);

    adapter.seedLinkedSession({
      email: "reseeded@example.com",
      accessToken: "reseeded-token",
    });
    expect(adapter.getLinkedState()).toMatchObject({
      linked: true,
      email: "reseeded@example.com",
      currentAccessToken: "reseeded-token",
    });

    adapter.seedLinkedSession();
    expect(adapter.getLinkedState().linked).toBe(true);

    adapter.queueNextFailure("signOut", new Error("signout hook failure"));
    await expect(
      adapter.signOut({ previousToken: "reseeded-token" }),
    ).rejects.toMatchObject({
      code: "AUTH_FAILED",
    });

    // reset で全状態とフックを初期化すること
    adapter.reset();
    expect(adapter.getLinkedState()).toEqual({
      linked: false,
      email: "reader@example.com",
      currentAccessToken: null,
      refreshCount: 0,
      lastRefreshOptions: null,
    });
    expect(await adapter.restoreSession()).toEqual({ status: "unlinked" });

    // initialLinked: true かつ initialAccessToken 省略時の自動採番
    const autoSeeded = new MockGoogleAuthAdapter({ initialLinked: true });
    expect(await autoSeeded.restoreSession()).toEqual({
      status: "connected",
      accessToken: "mock-drive-token-1",
      email: "reader@example.com",
    });
  });
});
