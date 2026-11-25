import { describe, expect, it } from "vitest";
import {
  generateInitialTitleReading,
  normalizeSeriesTitleKey,
} from "./textNormalization";

describe("textNormalization", () => {
  describe("normalizeSeriesTitleKey", () => {
    it("全角英数・半角カタカナ・記号を NFKC 正規化し ASCII 英字を小文字化する (AC-FP-03)", () => {
      expect(normalizeSeriesTitleKey("ＳＰＹ×ＦＡＭＩＬＹ　ﾏﾝｶﾞ！")).toBe(
        "spy×family マンガ!",
      );
    });

    it("波ダッシュ・チルダ系を ~ に、ハイフン・ダッシュ揺れを - に統一し長音符 ー は保持する (AC-FP-03)", () => {
      expect(normalizeSeriesTitleKey("作品〜第１章～テスト")).toBe(
        "作品~第1章~テスト",
      );
      expect(normalizeSeriesTitleKey("Ａ‐Ｂ‑Ｃ‒Ｄ–Ｅ—Ｆ―Ｇ−Ｈ")).toBe(
        "a-b-c-d-e-f-g-h",
      );
      expect(normalizeSeriesTitleKey("オーバーロードー外伝")).toBe(
        "オーバーロードー外伝",
      );
    });

    it("全角スペースを含む連続空白を単一スペースへ圧縮して前後トリムする (AC-FP-03)", () => {
      expect(normalizeSeriesTitleKey("  　銀河鉄道\t\n　 999  　")).toBe(
        "銀河鉄道 999",
      );
    });

    it("空文字や空白のみの入力では空文字を返す (AC-FP-05)", () => {
      expect(normalizeSeriesTitleKey("")).toBe("");
      expect(normalizeSeriesTitleKey(" 　\t ")).toBe("");
    });
  });

  describe("generateInitialTitleReading", () => {
    it("全角カタカナおよび半角カタカナをひらがなへ変換し英字を小文字化する (AC-FP-06)", () => {
      expect(generateInitialTitleReading("ワンピース ONE PIECE ﾏﾝｶﾞ")).toBe(
        "わんぴーす one piece まんが",
      );
    });

    it("カタカナ境界（ァ U+30A1 〜 ヶ U+30F6）を漏れなくひらがな化し長音符と漢字は保持する (AC-FP-06)", () => {
      expect(generateInitialTitleReading("ァィゥェォヵヶヴ・進撃の巨人")).toBe(
        "ぁぃぅぇぉゕゖゔ・進撃の巨人",
      );
    });

    it("全角英数と連続空白を NFKC 正規化・圧縮・トリムして返す (AC-FP-06)", () => {
      expect(generateInitialTitleReading("　Ｒｅ：ゼロ　　から始める　")).toBe(
        "re:ぜろ から始める",
      );
    });
  });
});
