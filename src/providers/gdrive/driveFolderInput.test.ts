import { describe, expect, it } from "vitest";
import { parseDriveFolderInput } from "./driveFolderInput";

describe("parseDriveFolderInput", () => {
  it("各種Google DriveフォルダURL形式および直接フォルダIDを正規化して抽出すること (AC-GD-06)", () => {
    expect(parseDriveFolderInput("1AbCd_EfG-123")).toBe("1AbCd_EfG-123");
    expect(parseDriveFolderInput("  abc  ")).toBe("abc");
    const maxLenId = "A".repeat(128);
    expect(parseDriveFolderInput(maxLenId)).toBe(maxLenId);

    expect(
      parseDriveFolderInput("https://drive.google.com/drive/folders/1AbCd_EfG"),
    ).toBe("1AbCd_EfG");
    expect(
      parseDriveFolderInput(
        "  https://drive.google.com/drive/folders/1AbCd_EfG/?usp=sharing  ",
      ),
    ).toBe("1AbCd_EfG");
    expect(
      parseDriveFolderInput(
        "https://drive.google.com/drive/folders/1AbCd_EfG?resourcekey=0-xyz",
      ),
    ).toBe("1AbCd_EfG");
    expect(
      parseDriveFolderInput(
        "https://drive.google.com/drive/u/0/folders/1XyZ-987_654",
      ),
    ).toBe("1XyZ-987_654");
    expect(
      parseDriveFolderInput(
        "https://drive.google.com/drive/u/12/folders/1XyZ-987_654/",
      ),
    ).toBe("1XyZ-987_654");
    expect(
      parseDriveFolderInput(
        "https://drive.google.com/open?id=1OpenFolder_Id&authuser=0",
      ),
    ).toBe("1OpenFolder_Id");
  });

  it("予約語root（大文字小文字非区別）・ファイルURL・不正ホスト・不正文字をnullで拒否すること (AC-GD-06)", () => {
    const invalidInputs = [
      "",
      "   ",
      "ab",
      "A".repeat(129),
      "root",
      "ROOT",
      "Root",
      "  root  ",
      "invalid folder id",
      "abc$def",
      "https://drive.google.com/drive/folders/root",
      "https://drive.google.com/drive/u/1/folders/ROOT?usp=sharing",
      "https://drive.google.com/open?id=Root",
      "https://drive.google.com/file/d/1AbCd_EfG/view",
      "https://drive.google.com/drive/my-drive",
      "https://drive.google.com/drive/folders/1AbCd_EfG/extra",
      "https://drive.google.com/drive/folders/ab",
      "https://drive.google.com/open",
      "https://drive.google.com/open?id=ab",
      "http://drive.google.com/drive/folders/1AbCd_EfG",
      "https://docs.google.com/drive/folders/1AbCd_EfG",
      "https://evil.example/open?id=1AbCd_EfG",
    ];

    for (const raw of invalidInputs) {
      expect(parseDriveFolderInput(raw)).toBeNull();
    }
  });
});
