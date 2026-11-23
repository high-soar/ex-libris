import { composeStories } from "@storybook/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as stories from "./DriveSetupBanner.stories";

const { Unauthenticated, NoRoots, Ready, Loading } = composeStories(stories);

describe("DriveSetupBanner", () => {
  it("Unauthenticatedストーリーで未連携案内と「設定を開いて連携する」CTAを表示し押下でonOpenSettingsを呼ぶこと (AC-BS-07)", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();

    render(<Unauthenticated onOpenSettings={onOpenSettings} />);

    const banner = screen.getByTestId("drive-setup-banner");
    expect(banner).toHaveAttribute("data-banner-kind", "unauthenticated");
    expect(banner).toHaveTextContent("Google アカウントが未連携");

    const cta = screen.getByTestId("drive-setup-banner-cta");
    expect(cta).toHaveTextContent("設定を開いて連携する");
    expect(cta).toHaveClass("touch-manipulation");

    await user.click(cta);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("NoRootsストーリーで連携メールアドレスとフォルダ未設定案内・「フォルダを設定する」CTAを表示し押下でonOpenSettingsを呼ぶこと (AC-BS-07)", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();

    render(<NoRoots onOpenSettings={onOpenSettings} />);

    const banner = screen.getByTestId("drive-setup-banner");
    expect(banner).toHaveAttribute("data-banner-kind", "no-roots");
    expect(screen.getByTestId("drive-setup-banner-email")).toHaveTextContent(
      "reader@example.com",
    );
    expect(banner).toHaveTextContent("マンガ保管ルートフォルダが未設定です");

    const cta = screen.getByTestId("drive-setup-banner-cta");
    expect(cta).toHaveTextContent("フォルダを設定する");
    expect(cta).toHaveClass("touch-manipulation");

    await user.click(cta);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("ReadyおよびLoadingストーリーでは何も描画しないこと (AC-BS-07)", () => {
    const { container: readyContainer, unmount: unmountReady } = render(
      <Ready />,
    );
    expect(readyContainer.firstElementChild).toBeEmptyDOMElement();
    expect(screen.queryByTestId("drive-setup-banner")).not.toBeInTheDocument();
    unmountReady();

    const { container: loadingContainer } = render(<Loading />);
    expect(loadingContainer.firstElementChild).toBeEmptyDOMElement();
    expect(screen.queryByTestId("drive-setup-banner")).not.toBeInTheDocument();
  });
});
