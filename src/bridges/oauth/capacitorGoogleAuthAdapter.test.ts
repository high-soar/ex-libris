import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleAuthCapacitorPlugin } from "./types";

const mockPlugin = vi.hoisted((): GoogleAuthCapacitorPlugin => ({
  restoreSession: vi.fn(),
  signIn: vi.fn(),
  refreshAccessToken: vi.fn(),
  signOut: vi.fn(),
}));

const mockRegisterPlugin = vi.hoisted(() => vi.fn(() => mockPlugin));

vi.mock("@capacitor/core", () => ({
  registerPlugin: mockRegisterPlugin,
}));

import { CapacitorGoogleAuthAdapter } from "./capacitorGoogleAuthAdapter";
import { GoogleAuthError } from "./googleAuthErrors";

describe("CapacitorGoogleAuthAdapter", () => {
  beforeEach(() => {
    vi.mocked(mockPlugin.restoreSession).mockReset();
    vi.mocked(mockPlugin.signIn).mockReset();
    vi.mocked(mockPlugin.refreshAccessToken).mockReset();
    vi.mocked(mockPlugin.signOut).mockReset();
  });

  it("デフォルトコンストラクタでregisterPlugin('GoogleAuthPlugin')を利用しrestoreSession/signIn/refresh/signOutを委譲すること (AC-GD-01)", async () => {
    expect(mockRegisterPlugin).toHaveBeenCalledWith("GoogleAuthPlugin");

    const adapter = new CapacitorGoogleAuthAdapter();

    vi.mocked(mockPlugin.restoreSession).mockResolvedValueOnce({
      status: "unlinked",
    });
    expect(await adapter.restoreSession()).toEqual({ status: "unlinked" });

    vi.mocked(mockPlugin.restoreSession).mockResolvedValueOnce({
      status: "connected",
      accessToken: "ya29.restoredNoExp",
      email: "noexp-restore@example.com",
    });
    expect(await adapter.restoreSession()).toEqual({
      status: "connected",
      accessToken: "ya29.restoredNoExp",
      email: "noexp-restore@example.com",
    });

    vi.mocked(mockPlugin.restoreSession).mockResolvedValueOnce({
      status: "connected",
      accessToken: "ya29.restored",
      email: "  user@example.com  ",
      expiresAt: 555666777,
    });
    expect(await adapter.restoreSession()).toEqual({
      status: "connected",
      accessToken: "ya29.restored",
      email: "user@example.com",
      expiresAt: 555666777,
    });

    vi.mocked(mockPlugin.signIn).mockResolvedValueOnce({
      status: "cancelled",
    });
    expect(await adapter.signIn()).toEqual({ status: "cancelled" });

    vi.mocked(mockPlugin.signIn).mockResolvedValueOnce({
      status: "connected",
      accessToken: "ya29.signedInNoExp",
      email: "noexp@example.com",
    });
    expect(await adapter.signIn()).toEqual({
      status: "connected",
      accessToken: "ya29.signedInNoExp",
      email: "noexp@example.com",
    });

    vi.mocked(mockPlugin.signIn).mockResolvedValueOnce({
      status: "connected",
      accessToken: "ya29.signedIn",
      email: "",
      expiresAt: 123456789,
    });
    expect(await adapter.signIn()).toEqual({
      status: "connected",
      accessToken: "ya29.signedIn",
      email: "Google Drive 連携済み",
      expiresAt: 123456789,
    });

    vi.mocked(mockPlugin.refreshAccessToken).mockResolvedValueOnce({
      accessToken: "ya29.refreshed",
      email: "updated@example.com",
      expiresAt: 987654321,
    });
    expect(
      await adapter.refreshAccessToken({
        previousToken: "ya29.old",
        clearCache: true,
      }),
    ).toEqual({
      accessToken: "ya29.refreshed",
      email: "updated@example.com",
      expiresAt: 987654321,
    });
    expect(mockPlugin.refreshAccessToken).toHaveBeenCalledWith({
      previousToken: "ya29.old",
      clearCache: true,
    });

    vi.mocked(mockPlugin.refreshAccessToken).mockResolvedValueOnce({
      accessToken: "ya29.refreshed2",
      email: "   ",
    });
    expect(
      await adapter.refreshAccessToken({
        previousToken: null,
        clearCache: false,
      }),
    ).toEqual({
      accessToken: "ya29.refreshed2",
    });

    vi.mocked(mockPlugin.signOut).mockResolvedValueOnce(undefined);
    await adapter.signOut({ previousToken: "ya29.refreshed2" });
    expect(mockPlugin.signOut).toHaveBeenCalledWith({
      previousToken: "ya29.refreshed2",
    });
  });

  it("空トークン応答・ネイティブエラー拒否時に型付きGoogleAuthErrorへ正規化すること (AC-GD-01)", async () => {
    const customPlugin: GoogleAuthCapacitorPlugin = {
      restoreSession: vi.fn(),
      signIn: vi.fn(),
      refreshAccessToken: vi.fn(),
      signOut: vi.fn(),
    };
    const adapter = new CapacitorGoogleAuthAdapter(customPlugin);

    vi.mocked(customPlugin.restoreSession).mockResolvedValueOnce({
      status: "connected",
      accessToken: "   ",
      email: "user@example.com",
    });
    await expect(adapter.restoreSession()).rejects.toMatchObject({
      name: "GoogleAuthError",
      code: "AUTH_FAILED",
    });

    vi.mocked(customPlugin.restoreSession).mockRejectedValueOnce({
      code: "AUTH_NETWORK_ERROR",
      message: "offline",
    });
    await expect(adapter.restoreSession()).rejects.toMatchObject({
      code: "AUTH_NETWORK_ERROR",
    });

    vi.mocked(customPlugin.signIn).mockResolvedValueOnce({
      status: "connected",
      accessToken: "",
      email: "user@example.com",
    });
    await expect(adapter.signIn()).rejects.toBeInstanceOf(GoogleAuthError);

    vi.mocked(customPlugin.signIn).mockRejectedValueOnce({
      code: "AUTH_FAILED",
      message: "consent launch failed",
    });
    await expect(adapter.signIn()).rejects.toMatchObject({
      code: "AUTH_FAILED",
    });

    vi.mocked(customPlugin.refreshAccessToken).mockResolvedValueOnce({
      accessToken: "",
    });
    await expect(
      adapter.refreshAccessToken({ previousToken: "old", clearCache: true }),
    ).rejects.toMatchObject({
      code: "AUTH_FAILED",
    });

    vi.mocked(customPlugin.refreshAccessToken).mockRejectedValueOnce({
      code: "AUTH_REQUIRED",
      message: "consent required",
    });
    await expect(
      adapter.refreshAccessToken({ previousToken: "old", clearCache: true }),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });

    vi.mocked(customPlugin.signOut).mockRejectedValueOnce(
      new Error("bridge disconnected"),
    );
    await expect(
      adapter.signOut({ previousToken: null }),
    ).rejects.toMatchObject({
      code: "AUTH_FAILED",
    });
  });
});
