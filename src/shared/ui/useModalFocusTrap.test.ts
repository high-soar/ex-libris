import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useModalFocusTrap } from "./useModalFocusTrap";

interface HarnessProps {
  readonly isOpen: boolean;
  readonly hasFocusables?: boolean;
  readonly includeInertSubtree?: boolean;
  readonly mountContainer?: boolean;
  readonly useFallbackRef?: boolean;
  readonly fallbackDisabled?: boolean;
}

function FocusTrapHarness({
  isOpen,
  hasFocusables = true,
  includeInertSubtree = false,
  mountContainer = true,
  useFallbackRef = false,
  fallbackDisabled = false,
}: HarnessProps): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fallbackRef = useRef<HTMLButtonElement | null>(null);

  useModalFocusTrap({
    isOpen,
    containerRef,
    ...(useFallbackRef ? { fallbackFocusRef: fallbackRef } : {}),
  });

  const dialogChildren: ReactNode[] = hasFocusables
    ? [
        createElement(
          "button",
          {
            key: "disabled",
            type: "button",
            disabled: true,
            "data-testid": "disabled-btn",
          },
          "無効ボタン",
        ),
        includeInertSubtree
          ? createElement(
              "div",
              { key: "inert-wrap", inert: true },
              createElement(
                "button",
                { type: "button", "data-testid": "inert-btn" },
                "inertボタン",
              ),
            )
          : null,
        createElement(
          "button",
          { key: "first", type: "button", "data-testid": "first-btn" },
          "先頭ボタン",
        ),
        createElement("input", {
          key: "middle",
          type: "text",
          "data-testid": "middle-input",
        }),
        createElement(
          "button",
          { key: "last", type: "button", "data-testid": "last-btn" },
          "末尾ボタン",
        ),
      ]
    : [createElement("p", { key: "empty" }, "フォーカス可能要素なし")];

  return createElement(
    "div",
    null,
    createElement(
      "button",
      { type: "button", "data-testid": "outside-trigger" },
      "開く",
    ),
    createElement(
      "button",
      {
        ref: fallbackRef,
        type: "button",
        disabled: fallbackDisabled,
        "data-testid": "fallback-target",
      },
      "フォールバック",
    ),
    isOpen && mountContainer
      ? createElement(
          "div",
          {
            ref: containerRef,
            tabIndex: -1,
            role: "dialog",
            "aria-modal": "true",
            "data-testid": "trap-dialog",
          },
          ...dialogChildren,
        )
      : null,
  );
}

describe("useModalFocusTrap", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("オープン時に先頭フォーカス可能要素へ初期フォーカスし、Tab/Shift+Tabで循環・外部からの引き戻しを行うこと", () => {
    const { rerender } = render(
      createElement(FocusTrapHarness, { isOpen: false }),
    );
    const trigger = screen.getByTestId("outside-trigger");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(
      createElement(FocusTrapHarness, {
        isOpen: true,
        includeInertSubtree: true,
      }),
    );
    const firstBtn = screen.getByTestId("first-btn");
    const middleInput = screen.getByTestId("middle-input");
    const lastBtn = screen.getByTestId("last-btn");
    const dialog = screen.getByTestId("trap-dialog");

    // disabled・inert 要素をスキップして先頭有効要素へフォーカス
    expect(document.activeElement).toBe(firstBtn);

    // 先頭から Shift+Tab -> 末尾へ循環
    const shiftTabAtFirst = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      cancelable: true,
    });
    document.dispatchEvent(shiftTabAtFirst);
    expect(shiftTabAtFirst.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(lastBtn);

    // 末尾から Tab -> 先頭へ循環
    const tabAtLast = new KeyboardEvent("keydown", {
      key: "Tab",
      cancelable: true,
    });
    document.dispatchEvent(tabAtLast);
    expect(tabAtLast.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(firstBtn);

    // 中間要素では preventDefault せずブラウザ既定の Tab 移動に委ねる
    middleInput.focus();
    const tabAtMiddle = new KeyboardEvent("keydown", {
      key: "Tab",
      cancelable: true,
    });
    document.dispatchEvent(tabAtMiddle);
    expect(tabAtMiddle.defaultPrevented).toBe(false);

    const shiftTabAtMiddle = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      cancelable: true,
    });
    document.dispatchEvent(shiftTabAtMiddle);
    expect(shiftTabAtMiddle.defaultPrevented).toBe(false);

    // Tab 以外のキーは無視する
    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    document.dispatchEvent(escapeEvent);
    expect(escapeEvent.defaultPrevented).toBe(false);

    // ダイアログ自身にフォーカスがある状態で Shift+Tab -> 末尾へ
    dialog.focus();
    const shiftTabAtDialog = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      cancelable: true,
    });
    document.dispatchEvent(shiftTabAtDialog);
    expect(shiftTabAtDialog.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(lastBtn);

    // ダイアログ外へフォーカスが外れた場合: Tab -> 先頭、Shift+Tab -> 末尾へ引き戻す
    trigger.focus();
    const tabFromOutside = new KeyboardEvent("keydown", {
      key: "Tab",
      cancelable: true,
    });
    document.dispatchEvent(tabFromOutside);
    expect(tabFromOutside.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(firstBtn);

    trigger.focus();
    const shiftTabFromOutside = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      cancelable: true,
    });
    document.dispatchEvent(shiftTabFromOutside);
    expect(shiftTabFromOutside.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(lastBtn);

    // クローズ時に元のトリガー要素へフォーカス復帰
    rerender(createElement(FocusTrapHarness, { isOpen: false }));
    expect(document.activeElement).toBe(trigger);
  });

  it("フォーカス可能要素が0件のときはダイアログ自身へフォーカスし、Tab/Shift+Tabでもダイアログ内を維持すること", () => {
    const { rerender } = render(
      createElement(FocusTrapHarness, { isOpen: false, hasFocusables: false }),
    );
    const trigger = screen.getByTestId("outside-trigger");
    trigger.focus();

    rerender(
      createElement(FocusTrapHarness, { isOpen: true, hasFocusables: false }),
    );
    const dialog = screen.getByTestId("trap-dialog");
    expect(document.activeElement).toBe(dialog);

    const tabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      cancelable: true,
    });
    document.dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);

    rerender(
      createElement(FocusTrapHarness, { isOpen: false, hasFocusables: false }),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("クローズ時に元フォーカス要素が切断・disabled・inertの場合はフォールバック先へ復帰し、不可時は安全にスキップすること", () => {
    // 1. 元要素が disabled になった場合 -> fallbackFocusRef へ復帰
    const { rerender } = render(
      createElement(FocusTrapHarness, { isOpen: false, useFallbackRef: true }),
    );
    const trigger = screen.getByTestId("outside-trigger") as HTMLButtonElement;
    const fallback = screen.getByTestId("fallback-target");
    trigger.focus();

    rerender(
      createElement(FocusTrapHarness, { isOpen: true, useFallbackRef: true }),
    );
    trigger.disabled = true;
    rerender(
      createElement(FocusTrapHarness, { isOpen: false, useFallbackRef: true }),
    );
    expect(document.activeElement).toBe(fallback);

    // 2. 元要素が inert 親配下かつフォールバックも disabled -> 安全にスキップ
    trigger.disabled = false;
    const inertWrapper = document.createElement("div");
    inertWrapper.setAttribute("inert", "");
    const inertBtn = document.createElement("button");
    inertWrapper.appendChild(inertBtn);
    document.body.appendChild(inertWrapper);
    inertBtn.focus();

    rerender(
      createElement(FocusTrapHarness, {
        isOpen: true,
        useFallbackRef: true,
        fallbackDisabled: true,
      }),
    );
    rerender(
      createElement(FocusTrapHarness, {
        isOpen: false,
        useFallbackRef: true,
        fallbackDisabled: true,
      }),
    );
    expect(document.activeElement).not.toBe(inertBtn);
    expect(document.activeElement).not.toBe(fallback);
    inertWrapper.remove();

    // 3. 元要素が DOM から切断された場合（fallback なし） -> 安全にスキップ
    const transientBtn = document.createElement("button");
    document.body.appendChild(transientBtn);
    transientBtn.focus();
    rerender(createElement(FocusTrapHarness, { isOpen: true }));
    transientBtn.remove();
    rerender(createElement(FocusTrapHarness, { isOpen: false }));
    expect(document.activeElement).not.toBe(transientBtn);

    // 4. オープン前に activeElement が非 HTMLElement (null) の場合でも安全に開閉できること
    const activeElementSpy = vi
      .spyOn(document, "activeElement", "get")
      .mockReturnValue(null);
    rerender(createElement(FocusTrapHarness, { isOpen: true }));
    activeElementSpy.mockRestore();
    rerender(createElement(FocusTrapHarness, { isOpen: false }));

    // 5. 背面 inert による自動 blur 等でオープン時に activeElement が document.body の場合は fallbackFocusRef へ復帰すること
    document.body.focus();
    const bodyActiveSpy = vi
      .spyOn(document, "activeElement", "get")
      .mockReturnValue(document.body);
    rerender(
      createElement(FocusTrapHarness, { isOpen: true, useFallbackRef: true }),
    );
    bodyActiveSpy.mockRestore();
    rerender(
      createElement(FocusTrapHarness, { isOpen: false, useFallbackRef: true }),
    );
    expect(document.activeElement).toBe(fallback);

    // 6. オープン時に activeElement が document.documentElement の場合も fallbackFocusRef へ復帰すること
    trigger.focus();
    const htmlActiveSpy = vi
      .spyOn(document, "activeElement", "get")
      .mockReturnValue(document.documentElement);
    rerender(
      createElement(FocusTrapHarness, { isOpen: true, useFallbackRef: true }),
    );
    htmlActiveSpy.mockRestore();
    rerender(
      createElement(FocusTrapHarness, { isOpen: false, useFallbackRef: true }),
    );
    expect(document.activeElement).toBe(fallback);
  });

  it("containerRefがnullのときは何も実行せず安全に終了すること", () => {
    render(
      createElement(FocusTrapHarness, {
        isOpen: true,
        mountContainer: false,
      }),
    );
    const trigger = screen.getByTestId("outside-trigger");
    trigger.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(trigger);
  });
});
