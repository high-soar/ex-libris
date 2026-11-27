import { composeStories } from "@storybook/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoverThumbnail } from "./CoverThumbnail";
import * as stories from "./CoverThumbnail.stories";

const {
  PendingPlaceholder,
  ReadyImage,
  Error: ErrorStory,
  ErrorFallback,
} = composeStories(stories);

describe("CoverThumbnail", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("未抽出プレースホルダおよびエラーフォールバックのストーリーを描画できること (AC-BS-12, AC-COV-02)", () => {
    const { unmount } = render(<PendingPlaceholder />);
    expect(screen.getByTestId("cover-thumbnail")).toBeInTheDocument();
    expect(
      screen.getByTestId("cover-thumbnail-placeholder"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("cover-thumbnail-initial")).toHaveTextContent(
      "葬",
    );
    expect(screen.getByTestId("cover-thumbnail-badge")).toHaveTextContent(
      "全 12 巻",
    );
    expect(screen.queryByTestId("cover-thumbnail-error-badge")).toBeNull();
    expect(screen.queryByTestId("cover-thumbnail-image")).toBeNull();
    unmount();

    const { unmount: unmountError } = render(<ErrorStory />);
    expect(
      screen.getByTestId("cover-thumbnail-placeholder"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("cover-thumbnail-initial")).toHaveTextContent(
      "葬",
    );
    expect(screen.getByTestId("cover-thumbnail-error-badge")).toHaveTextContent(
      "取得失敗",
    );
    expect(screen.getByTestId("cover-thumbnail-badge")).toHaveTextContent(
      "全 12 巻",
    );
    unmountError();

    render(<ErrorFallback />);
    expect(screen.getByTestId("cover-thumbnail-initial")).toHaveTextContent(
      "?",
    );
    expect(screen.getByTestId("cover-thumbnail-error-badge")).toHaveTextContent(
      "取得失敗",
    );
    expect(screen.queryByTestId("cover-thumbnail-badge")).toBeNull();
  });

  it("ready かつ coverBlob ありの場合に createObjectURL で lazy/async 属性付き画像を表示し、変更・アンマウント時に revokeObjectURL を厳格実行すること (AC-BS-12)", () => {
    let urlSeq = 0;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const createObjectUrlSpy = vi.fn(() => `blob:mock-cover-${++urlSeq}`);
    const revokeObjectUrlSpy = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectUrlSpy,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectUrlSpy,
    });

    try {
      const { unmount: unmountStory } = render(<ReadyImage />);
      expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
      const storyImage = screen.getByTestId("cover-thumbnail-image");
      expect(storyImage).toHaveAttribute("src", "blob:mock-cover-1");
      expect(storyImage).toHaveAttribute("alt", "ダンジョン飯 の表紙");
      expect(storyImage).toHaveAttribute("loading", "lazy");
      expect(storyImage).toHaveAttribute("decoding", "async");
      expect(screen.queryByTestId("cover-thumbnail-error-badge")).toBeNull();
      expect(screen.getByTestId("cover-thumbnail-badge")).toHaveTextContent(
        "全 14 巻",
      );
      unmountStory();
      expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:mock-cover-1");

      const blobA = new Blob(["a"], { type: "image/webp" });
      const blobB = new Blob(["b"], { type: "image/webp" });
      const { rerender, unmount } = render(
        <CoverThumbnail coverBlob={blobA} coverStatus="ready" title="作品A" />,
      );
      expect(screen.getByTestId("cover-thumbnail-image")).toHaveAttribute(
        "src",
        "blob:mock-cover-2",
      );

      rerender(
        <CoverThumbnail coverBlob={blobB} coverStatus="ready" title="作品A" />,
      );
      expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:mock-cover-2");
      expect(screen.getByTestId("cover-thumbnail-image")).toHaveAttribute(
        "src",
        "blob:mock-cover-3",
      );

      // ready -> pending へ戻った際にも即座に revoke してプレースホルダへ切り替わること
      rerender(
        <CoverThumbnail
          coverBlob={blobB}
          coverStatus="pending"
          title="作品A"
        />,
      );
      expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:mock-cover-3");
      expect(screen.queryByTestId("cover-thumbnail-image")).toBeNull();
      expect(
        screen.getByTestId("cover-thumbnail-placeholder"),
      ).toBeInTheDocument();

      unmount();
      expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(3);
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: originalCreate,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: originalRevoke,
      });
    }
  });
});
