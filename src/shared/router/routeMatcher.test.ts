import { describe, expect, it } from "vitest";
import {
  buildReaderVolumePath,
  buildSeriesDetailPath,
  matchRoute,
  normalizePath,
  resolveInitialPath,
} from "./routeMatcher";

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

  describe("buildSeriesDetailPath / buildReaderVolumePath", () => {
    it("IDをURIエンコードしてシリーズ詳細およびDrive巻リーダーのパスを生成すること", () => {
      expect(buildSeriesDetailPath("series-123")).toBe("/series/series-123");
      expect(buildSeriesDetailPath("series 01#日本語")).toBe(
        "/series/series%2001%23%E6%97%A5%E6%9C%AC%E8%AA%9E",
      );
      expect(buildReaderVolumePath("vol-456")).toBe("/read/volume/vol-456");
      expect(buildReaderVolumePath("vol 02?日本語")).toBe(
        "/read/volume/vol%2002%3F%E6%97%A5%E6%9C%AC%E8%AA%9E",
      );
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

    it("'/series/:seriesId' をURLデコード付きで series-detail ルートへ解決すること (AC-SD-01)", () => {
      expect(matchRoute("/series/series-123")).toEqual({
        name: "series-detail",
        path: "/series/series-123",
        seriesId: "series-123",
      });
      expect(matchRoute("/series/series-123/?from=bookshelf#top")).toEqual({
        name: "series-detail",
        path: "/series/series-123",
        seriesId: "series-123",
      });
      expect(matchRoute(buildSeriesDetailPath("作品 01"))).toEqual({
        name: "series-detail",
        path: "/series/%E4%BD%9C%E5%93%81%2001",
        seriesId: "作品 01",
      });
    });

    it("'/read/volume/:volumeId' をURLデコード付きで reader-volume ルートへ解決すること (TR-02b, TR-04)", () => {
      expect(matchRoute("/read/volume/vol-999")).toEqual({
        name: "reader-volume",
        path: "/read/volume/vol-999",
        volumeId: "vol-999",
      });
      expect(matchRoute("/read/volume/vol-999/?page=3#hud")).toEqual({
        name: "reader-volume",
        path: "/read/volume/vol-999",
        volumeId: "vol-999",
      });
      expect(matchRoute(buildReaderVolumePath("第01巻 特別版"))).toEqual({
        name: "reader-volume",
        path: "/read/volume/%E7%AC%AC01%E5%B7%BB%20%E7%89%B9%E5%88%A5%E7%89%88",
        volumeId: "第01巻 特別版",
      });
    });

    it("空セグメント・多段セグメント・スラッシュ含有・不正パーセントエンコード・未知パスは例外を投げず '/' へフォールバックすること", () => {
      expect(matchRoute("/unknown")).toEqual({ name: "bookshelf", path: "/" });
      expect(matchRoute("/series")).toEqual({ name: "bookshelf", path: "/" });
      expect(matchRoute("/series/")).toEqual({ name: "bookshelf", path: "/" });
      expect(matchRoute("/series/%20%20")).toEqual({
        name: "bookshelf",
        path: "/",
      });
      expect(matchRoute("/series/a/b")).toEqual({
        name: "bookshelf",
        path: "/",
      });
      expect(matchRoute("/series/a%2Fb")).toEqual({
        name: "bookshelf",
        path: "/",
      });
      expect(matchRoute("/series/%E0%A4%A")).toEqual({
        name: "bookshelf",
        path: "/",
      });
      expect(matchRoute("/read/volume")).toEqual({
        name: "bookshelf",
        path: "/",
      });
      expect(matchRoute("/read/volume/")).toEqual({
        name: "bookshelf",
        path: "/",
      });
      expect(matchRoute("/read/volume/%20")).toEqual({
        name: "bookshelf",
        path: "/",
      });
      expect(matchRoute("/read/volume/v1/extra")).toEqual({
        name: "bookshelf",
        path: "/",
      });
      expect(matchRoute("/read/volume/v1%2Fv2")).toEqual({
        name: "bookshelf",
        path: "/",
      });
      expect(matchRoute("/read/volume/%ZZ")).toEqual({
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
