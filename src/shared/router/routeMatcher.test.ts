import { describe, expect, it } from "vitest";
import { matchRoute, normalizePath, resolveInitialPath } from "./routeMatcher";

describe("routeMatcher", () => {
  describe("normalizePath", () => {
    it("空文字・空白・ルートスラッシュを '/' に正規化すること", () => {
      expect(normalizePath("")).toBe("/");
      expect(normalizePath("   ")).toBe("/");
      expect(normalizePath("/")).toBe("/");
      expect(normalizePath("///")).toBe("/");
      expect(normalizePath("/?foo=bar")).toBe("/");
      expect(normalizePath("?foo=bar")).toBe("/");
      expect(normalizePath("/#section")).toBe("/");
    });

    it("前後空白・末尾スラッシュ・クエリ文字列・ハッシュを除去してパスを正規化すること", () => {
      expect(normalizePath("/read/local")).toBe("/read/local");
      expect(normalizePath("/read/local/")).toBe("/read/local");
      expect(normalizePath("  /read/local///  ")).toBe("/read/local");
      expect(normalizePath("/read/local?page=1&mode=rtl")).toBe("/read/local");
      expect(normalizePath("/read/local/?page=1#top")).toBe("/read/local");
      expect(normalizePath("/unknown/path/")).toBe("/unknown/path");
    });
  });

  describe("matchRoute", () => {
    it("空文字および '/' を bookshelf ルートへ解決すること", () => {
      expect(matchRoute("")).toEqual({ name: "bookshelf", path: "/" });
      expect(matchRoute("   ")).toEqual({ name: "bookshelf", path: "/" });
      expect(matchRoute("/")).toEqual({ name: "bookshelf", path: "/" });
      expect(matchRoute("/?tab=recent")).toEqual({
        name: "bookshelf",
        path: "/",
      });
    });

    it("'/read/local' を末尾スラッシュやクエリ付きも含め reader-local ルートへ解決すること", () => {
      expect(matchRoute("/read/local")).toEqual({
        name: "reader-local",
        path: "/read/local",
      });
      expect(matchRoute("/read/local/")).toEqual({
        name: "reader-local",
        path: "/read/local",
      });
      expect(matchRoute("/read/local?from=bookshelf")).toEqual({
        name: "reader-local",
        path: "/read/local",
      });
      expect(matchRoute("  /read/local/?foo=bar#hash  ")).toEqual({
        name: "reader-local",
        path: "/read/local",
      });
    });

    it("'/settings' を末尾スラッシュやクエリ付きも含め settings ルートへ解決すること", () => {
      expect(matchRoute("/settings")).toEqual({
        name: "settings",
        path: "/settings",
      });
      expect(matchRoute("/settings/")).toEqual({
        name: "settings",
        path: "/settings",
      });
      expect(matchRoute("/settings?tab=oauth")).toEqual({
        name: "settings",
        path: "/settings",
      });
      expect(matchRoute("  /settings/?foo=bar#diag  ")).toEqual({
        name: "settings",
        path: "/settings",
      });
    });

    it("未知または不正なパスは例外を投げず bookshelf ルート '/' へフォールバックすること", () => {
      expect(matchRoute("/unknown")).toEqual({ name: "bookshelf", path: "/" });
      expect(matchRoute("/series/123")).toEqual({
        name: "bookshelf",
        path: "/",
      });
      expect(matchRoute("/settings/extra")).toEqual({
        name: "bookshelf",
        path: "/",
      });
      expect(matchRoute("/read/local/extra")).toEqual({
        name: "bookshelf",
        path: "/",
      });
      expect(matchRoute("settings")).toEqual({ name: "bookshelf", path: "/" });
      expect(matchRoute("read/local")).toEqual({
        name: "bookshelf",
        path: "/",
      });
    });
  });

  describe("resolveInitialPath", () => {
    it("initialPath > fallbackPath > '/' の優先順位で初期パスを決定すること", () => {
      expect(resolveInitialPath("/read/local", "/")).toBe("/read/local");
      expect(resolveInitialPath("/", "/read/local")).toBe("/");
      expect(resolveInitialPath("", "/read/local")).toBe("");
      expect(resolveInitialPath(undefined, "/read/local")).toBe("/read/local");
      expect(resolveInitialPath(undefined, "")).toBe("/");
      expect(resolveInitialPath(undefined, undefined)).toBe("/");
    });
  });
});
