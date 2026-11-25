import { describe, expect, it } from "vitest";
import { parseMangaFilename } from "./mangaFilenameParser";

describe("parseMangaFilename", () => {
  describe("商業誌・同人誌・著者タグ・ノイズ除去 (AC-FP-01)", () => {
    it("典型的な商業誌ファイル名からノイズを除去しタイトル・著者・単巻情報を抽出する (AC-FP-01)", () => {
      const result = parseMangaFilename({
        fileName: "[作者名] 作品名 第01巻 (一般コミック).cbz",
      });

      expect(result).toEqual({
        title: "作品名",
        normalizedTitleKey: "作品名",
        titleReading: "作品名",
        authors: ["作者名"],
        volumeNumber: 1,
        volumeLabel: "第01巻",
        isOmnibus: false,
        volumeRangeEnd: null,
        editionNote: null,
      });
    });

    it("先頭ノイズタグ・複数著者区切り・末尾ノイズタグ・大文字拡張子を組み合わせて解析する (AC-FP-01)", () => {
      const result = parseMangaFilename({
        fileName: "(一般コミック) [著者A×著者B] 作品名 02 [DL版].ZIP",
      });

      expect(result).toEqual({
        title: "作品名",
        normalizedTitleKey: "作品名",
        titleReading: "作品名",
        authors: ["著者A", "著者B"],
        volumeNumber: 2,
        volumeLabel: "第02巻",
        isOmnibus: false,
        volumeRangeEnd: null,
        editionNote: null,
      });
    });

    it("多様な複数著者区切り記号（・, &, ＆, ,, 、, /）を分割し重複を排除する (AC-FP-01)", () => {
      const result = parseMangaFilename({
        fileName:
          "【著者A・著者B & 著者C＆著者A, 著者D、著者E/著者B】 テスト作品 第3巻 (RAW) [デジタル版] (WebP).cbz",
      });

      expect(result.authors).toEqual([
        "著者A",
        "著者B",
        "著者C",
        "著者D",
        "著者E",
      ]);
      expect(result.title).toBe("テスト作品");
      expect(result.volumeNumber).toBe(3);
      expect(result.volumeLabel).toBe("第03巻");
    });

    it("同人誌のサークル括弧注記・空括弧を整形しつつ先頭以外の括弧を著者と誤認しない (AC-FP-01)", () => {
      const doujin = parseMangaFilename({
        fileName:
          "(同人誌) [サークル名 ( 著者名 ) ()] 異世界冒険 [番外編] 第04巻 (JP).zip",
      });

      expect(doujin.authors).toEqual(["サークル名 (著者名)"]);
      expect(doujin.title).toBe("異世界冒険 [番外編]");
      expect(doujin.volumeNumber).toBe(4);
      expect(doujin.volumeLabel).toBe("第04巻");
    });

    it("全角ブラケット著者・複数先頭著者ブロック・各種分類ノイズタグを処理する (AC-FP-01)", () => {
      const result = parseMangaFilename({
        fileName:
          "(成年コミック) ［原作者］ [作画者] タイトル (商業誌) [単行本] [完結] (JPG) (PNG) (AVIF) (日本語) 第12巻.cbz",
      });

      expect(result.authors).toEqual(["原作者", "作画者"]);
      expect(result.title).toBe("タイトル");
      expect(result.volumeNumber).toBe(12);
      expect(result.volumeLabel).toBe("第12巻");
    });

    it("先頭ブロックが巻数タグやタイトル全体のみの場合は著者として誤抽出しない (AC-FP-01)", () => {
      const volBracket = parseMangaFilename({
        fileName: "[第01巻] 作品名.zip",
      });
      expect(volBracket.authors).toEqual([]);
      expect(volBracket.title).toBe("作品名");
      expect(volBracket.volumeNumber).toBe(1);

      const onlyBracket = parseMangaFilename({
        fileName: "[単独タイトル].cbz",
      });
      expect(onlyBracket.authors).toEqual([]);
      expect(onlyBracket.title).toBe("[単独タイトル]");
      expect(onlyBracket.volumeNumber).toBeNull();
      expect(onlyBracket.volumeLabel).toBe("単巻");
    });
  });

  describe("巻数・小数巻・0巻・版付記・合本・上下前後編・単発本 (AC-FP-02)", () => {
    it("0巻・10巻以上・小数巻および多様な明示単巻表記を決定論的に解析する (AC-FP-02)", () => {
      expect(
        parseMangaFilename({ fileName: "呪術廻戦 第0巻.cbz" }),
      ).toMatchObject({
        title: "呪術廻戦",
        volumeNumber: 0,
        volumeLabel: "第00巻",
        isOmnibus: false,
        volumeRangeEnd: null,
      });

      expect(
        parseMangaFilename({ fileName: "作品名 第10.5巻.cbz" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: 10.5,
        volumeLabel: "第10.5巻",
      });

      expect(
        parseMangaFilename({ fileName: "作品名 10.5巻.zip" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: 10.5,
        volumeLabel: "第10.5巻",
      });

      expect(
        parseMangaFilename({ fileName: "作品名 Vol.01.cbz" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: 1,
        volumeLabel: "第01巻",
      });

      expect(
        parseMangaFilename({ fileName: "作品名 vol 2.cbz" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: 2,
        volumeLabel: "第02巻",
      });

      expect(parseMangaFilename({ fileName: "作品名 v03.cbz" })).toMatchObject({
        title: "作品名",
        volumeNumber: 3,
        volumeLabel: "第03巻",
      });

      expect(parseMangaFilename({ fileName: "作品名 #04.cbz" })).toMatchObject({
        title: "作品名",
        volumeNumber: 4,
        volumeLabel: "第04巻",
      });

      expect(parseMangaFilename({ fileName: "作品名 No.5.cbz" })).toMatchObject(
        {
          title: "作品名",
          volumeNumber: 5,
          volumeLabel: "第05巻",
        },
      );

      expect(
        parseMangaFilename({ fileName: "作品名 その1.cbz" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: 1,
        volumeLabel: "第01巻",
      });

      expect(
        parseMangaFilename({ fileName: "作品名 （02）.cbz" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: 2,
        volumeLabel: "第02巻",
      });
    });

    it("版付記（括弧内・末尾独立トークン・複数指定）を抽出し volumeLabel へ付与する (AC-FP-02)", () => {
      const single = parseMangaFilename({
        fileName: "作品名 第3巻 限定版.cbz",
      });
      expect(single).toMatchObject({
        title: "作品名",
        volumeNumber: 3,
        volumeLabel: "第03巻 限定版",
        editionNote: "限定版",
      });

      const bracketed = parseMangaFilename({
        fileName: "作品名 第05巻 (特装版) [小冊子付き].zip",
      });
      expect(bracketed).toMatchObject({
        title: "作品名",
        volumeNumber: 5,
        volumeLabel: "第05巻 特装版 小冊子付き",
        editionNote: "特装版 小冊子付き",
      });

      const oneshotEdition = parseMangaFilename({
        fileName: "単発作品 (新装版).cbz",
      });
      expect(oneshotEdition).toMatchObject({
        title: "単発作品",
        volumeNumber: null,
        volumeLabel: "単巻 新装版",
        editionNote: "新装版",
      });
    });

    it("合本範囲・全N巻・数値なし合本を解析する (AC-FP-02)", () => {
      expect(
        parseMangaFilename({ fileName: "作品名 01-05巻 合本.zip" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: 1,
        volumeRangeEnd: 5,
        isOmnibus: true,
        volumeLabel: "第01-05巻 合本",
      });

      expect(
        parseMangaFilename({ fileName: "作品名 第1〜3巻.cbz" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: 1,
        volumeRangeEnd: 3,
        isOmnibus: true,
        volumeLabel: "第01-03巻 合本",
      });

      expect(
        parseMangaFilename({ fileName: "作品名 第1巻-第12巻 特装版.cbz" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: 1,
        volumeRangeEnd: 12,
        isOmnibus: true,
        volumeLabel: "第01-12巻 合本 特装版",
        editionNote: "特装版",
      });

      expect(
        parseMangaFilename({ fileName: "作品名 v01-05.cbz" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: 1,
        volumeRangeEnd: 5,
        isOmnibus: true,
        volumeLabel: "第01-05巻 合本",
      });

      expect(
        parseMangaFilename({ fileName: "作品名 01~05 合本.cbz" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: 1,
        volumeRangeEnd: 5,
        isOmnibus: true,
        volumeLabel: "第01-05巻 合本",
      });

      expect(
        parseMangaFilename({ fileName: "作品名 全5巻.cbz" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: 1,
        volumeRangeEnd: 5,
        isOmnibus: true,
        volumeLabel: "第01-05巻 合本",
      });

      expect(
        parseMangaFilename({ fileName: "作品名 全巻合本.zip" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: null,
        volumeRangeEnd: null,
        isOmnibus: true,
        volumeLabel: "全巻合本",
      });

      expect(
        parseMangaFilename({ fileName: "作品名 [全巻セット] (完全版).zip" }),
      ).toMatchObject({
        title: "作品名",
        volumeNumber: null,
        volumeRangeEnd: null,
        isOmnibus: true,
        volumeLabel: "全巻合本 完全版",
        editionNote: "完全版",
      });
    });

    it("上下巻・末尾独立トークン上中下・前後編へ 1/2/3 を割り当てる (AC-FP-02)", () => {
      expect(parseMangaFilename({ fileName: "物語 上巻.cbz" })).toMatchObject({
        title: "物語",
        volumeNumber: 1,
        volumeLabel: "上巻",
        isOmnibus: false,
      });
      expect(parseMangaFilename({ fileName: "物語 中巻.cbz" })).toMatchObject({
        title: "物語",
        volumeNumber: 2,
        volumeLabel: "中巻",
      });
      expect(parseMangaFilename({ fileName: "物語 下巻.cbz" })).toMatchObject({
        title: "物語",
        volumeNumber: 3,
        volumeLabel: "下巻",
      });
      expect(parseMangaFilename({ fileName: "物語 上.cbz" })).toMatchObject({
        title: "物語",
        volumeNumber: 1,
        volumeLabel: "上巻",
      });
      expect(parseMangaFilename({ fileName: "物語 中.cbz" })).toMatchObject({
        title: "物語",
        volumeNumber: 2,
        volumeLabel: "中巻",
      });
      expect(parseMangaFilename({ fileName: "物語 下.cbz" })).toMatchObject({
        title: "物語",
        volumeNumber: 3,
        volumeLabel: "下巻",
      });
      expect(parseMangaFilename({ fileName: "物語 前編.cbz" })).toMatchObject({
        title: "物語",
        volumeNumber: 1,
        volumeLabel: "前編",
      });
      expect(parseMangaFilename({ fileName: "物語 中編.cbz" })).toMatchObject({
        title: "物語",
        volumeNumber: 2,
        volumeLabel: "中編",
      });
      expect(parseMangaFilename({ fileName: "物語 後編.cbz" })).toMatchObject({
        title: "物語",
        volumeNumber: 3,
        volumeLabel: "後編",
      });
    });

    it("末尾数値フォールバックおよび巻数なし単発本を解析する (AC-FP-02)", () => {
      expect(parseMangaFilename({ fileName: "タイトル_02.cbz" })).toMatchObject(
        {
          title: "タイトル",
          volumeNumber: 2,
          volumeLabel: "第02巻",
        },
      );

      expect(
        parseMangaFilename({ fileName: "タイトル 10.5.cbz" }),
      ).toMatchObject({
        title: "タイトル",
        volumeNumber: 10.5,
        volumeLabel: "第10.5巻",
      });

      expect(parseMangaFilename({ fileName: "読み切り作品.zip" })).toEqual({
        title: "読み切り作品",
        normalizedTitleKey: "読み切り作品",
        titleReading: "読み切り作品",
        authors: [],
        volumeNumber: null,
        volumeLabel: "単巻",
        isOmnibus: false,
        volumeRangeEnd: null,
        editionNote: null,
      });
    });
  });

  describe("シリーズ自動名寄せキー統一 (AC-FP-03)", () => {
    it("単巻・合本・全角半角揺れ・著者有無が異なるファイル群から同一の normalizedTitleKey を生成する (AC-FP-03)", () => {
      const vol1 = parseMangaFilename({
        fileName: "[著者A] ＭＡＮＧＡ〜外伝〜 第01巻.cbz",
      });
      const omnibus = parseMangaFilename({
        fileName: "(一般コミック) manga～外伝～ 01-05巻 合本.zip",
      });
      const vol6 = parseMangaFilename({
        fileName: "MANGA~外伝~ 06 [DL版].cbz",
      });

      expect(vol1.normalizedTitleKey).toBe("manga~外伝~");
      expect(omnibus.normalizedTitleKey).toBe(vol1.normalizedTitleKey);
      expect(vol6.normalizedTitleKey).toBe(vol1.normalizedTitleKey);
    });
  });

  describe("親サブフォルダ名フォールバック vs ルート直下非補完 (AC-FP-04)", () => {
    it("非ルートサブフォルダ配下でタイトルが空のファイル名に対し親フォルダからタイトルと著者を補完する (AC-FP-04)", () => {
      const result = parseMangaFilename({
        fileName: "01.cbz",
        parentFolderName: "(一般コミック) [親著者] サブフォルダ作品",
        isParentSyncRoot: false,
      });

      expect(result).toEqual({
        title: "サブフォルダ作品",
        normalizedTitleKey: "サブフォルダ作品",
        titleReading: "さぶふぉるだ作品",
        authors: ["親著者"],
        volumeNumber: 1,
        volumeLabel: "第01巻",
        isOmnibus: false,
        volumeRangeEnd: null,
        editionNote: null,
      });
    });

    it("ファイル名にタイトルがあり著者が空の場合、非ルート親フォルダに著者タグがあれば著者のみ補完する (AC-FP-04)", () => {
      const result = parseMangaFilename({
        fileName: "作品名 第02巻.zip",
        parentFolderName: "[親著者A×親著者B] 作品名",
        isParentSyncRoot: false,
      });

      expect(result.title).toBe("作品名");
      expect(result.authors).toEqual(["親著者A", "親著者B"]);
      expect(result.volumeNumber).toBe(2);
    });

    it("ファイル名に既に著者がある場合は非ルート親フォルダの著者で上書きしない (AC-FP-04)", () => {
      const result = parseMangaFilename({
        fileName: "[子著者] 第03巻.zip",
        parentFolderName: "[親著者] 親タイトル",
        isParentSyncRoot: false,
      });

      expect(result.title).toBe("親タイトル");
      expect(result.authors).toEqual(["子著者"]);
      expect(result.volumeNumber).toBe(3);
    });

    it("isParentSyncRoot が true のルート直下では親フォルダ名へ誤集約せず安全フォールバックする (AC-FP-04)", () => {
      const result = parseMangaFilename({
        fileName: "01.cbz",
        parentFolderName: "Comics",
        isParentSyncRoot: true,
      });

      expect(result.title).toBe("01");
      expect(result.normalizedTitleKey).toBe("01");
      expect(result.authors).toEqual([]);
      expect(result.volumeNumber).toBe(1);
      expect(result.volumeLabel).toBe("第01巻");
    });

    it("親フォルダ名が空・ノイズのみの場合は生ベース名または無題へフォールバックする (AC-FP-04)", () => {
      const result = parseMangaFilename({
        fileName: "第02巻.zip",
        parentFolderName: "(一般コミック)",
        isParentSyncRoot: false,
      });

      expect(result.title).toBe("第02巻");
      expect(result.volumeNumber).toBe(2);
    });
  });

  describe("境界入力・不正範囲・西暦除外・空文字フォールバック (AC-FP-05)", () => {
    it("不正な合本範囲（start <= 0 または end <= start、全1巻）を合本として誤認識しない (AC-FP-05)", () => {
      const reversed = parseMangaFilename({ fileName: "作品名 10-05巻.cbz" });
      expect(reversed.isOmnibus).toBe(false);
      expect(reversed.volumeRangeEnd).toBeNull();
      expect(reversed.volumeNumber).toBeNull();
      expect(reversed.title).toBe("作品名 10-05巻");

      const equalRange = parseMangaFilename({
        fileName: "作品名 第01-01巻.cbz",
      });
      expect(equalRange.isOmnibus).toBe(false);
      expect(equalRange.volumeRangeEnd).toBeNull();

      const zeroStart = parseMangaFilename({ fileName: "作品名 00-05巻.cbz" });
      expect(zeroStart.isOmnibus).toBe(false);
      expect(zeroStart.volumeRangeEnd).toBeNull();

      const singleAll = parseMangaFilename({ fileName: "作品名 全1巻.cbz" });
      expect(singleAll.isOmnibus).toBe(false);
      expect(singleAll.volumeRangeEnd).toBeNull();
    });

    it("西暦4桁（1900〜2099）および末尾単独0を巻数として誤認識しない (AC-FP-05)", () => {
      const yearBare = parseMangaFilename({
        fileName: "サイバーパンク 2024.cbz",
      });
      expect(yearBare.title).toBe("サイバーパンク 2024");
      expect(yearBare.volumeNumber).toBeNull();
      expect(yearBare.volumeLabel).toBe("単巻");

      const yearParen = parseMangaFilename({
        fileName: "年鑑コミック (2024).zip",
      });
      expect(yearParen.title).toBe("年鑑コミック (2024)");
      expect(yearParen.volumeNumber).toBeNull();

      const trailingZero = parseMangaFilename({
        fileName: "レベル 0.cbz",
      });
      expect(trailingZero.title).toBe("レベル 0");
      expect(trailingZero.volumeNumber).toBeNull();
    });

    it("拡張子のみや空文字に近い入力でも例外を送出せず非空の不変条件を満たす (AC-FP-05)", () => {
      for (const fileName of [".zip", "  .CBZ  ", "", "   "]) {
        const result = parseMangaFilename({ fileName });
        expect(result.title).toBe("無題");
        expect(result.normalizedTitleKey).toBe("無題");
        expect(result.titleReading).toBe("無題");
        expect(result.volumeLabel).toBe("単巻");
        expect(result.volumeNumber).toBeNull();
        expect(result.isOmnibus).toBe(false);
        expect(result.volumeRangeEnd).toBeNull();
        expect(result.editionNote).toBeNull();
        expect(result.authors).toEqual([]);
      }
    });
  });
});
