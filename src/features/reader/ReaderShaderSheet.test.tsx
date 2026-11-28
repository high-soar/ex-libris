import { composeStories } from "@storybook/react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SHADER_CORRECTION_PARAMS,
  SHADER_PARAM_RANGES,
} from "../../webgl/shaderParams";
import { ReaderShaderSheet } from "./ReaderShaderSheet";
import * as stories from "./ReaderShaderSheet.stories";

const { Default, CustomAdjusted, SavedFeedback, SaveErrorFeedback, Closed } =
  composeStories(stories);

describe("ReaderShaderSheet", () => {
  it("Closedストーリーではバックドロップ・シート本体とも描画しないこと (AC-RD-13)", () => {
    render(<Closed />);

    expect(
      screen.queryByTestId("reader-shader-backdrop"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("reader-shader-sheet")).not.toBeInTheDocument();
  });

  it("Defaultストーリーで透明バックドロップ・アクセシブルなダイアログ・4スライダー・操作ボタンを描画すること (AC-RD-13)", () => {
    render(<Default />);

    const backdrop = screen.getByTestId("reader-shader-backdrop");
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(backdrop).toHaveClass("bg-transparent");

    const sheet = screen.getByTestId("reader-shader-sheet");
    expect(sheet).toHaveAttribute("role", "dialog");
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveAttribute("aria-label", "画質補正");
    expect(sheet).toHaveStyle({
      paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
    });
    expect(sheet.style.paddingBottom).toContain("safe-area-inset-bottom");

    const sliderSpecs = [
      {
        testId: "shader-sharpness-slider",
        key: "sharpness",
        expectedValue: "0",
        expectedLabel: "0.00",
      },
      {
        testId: "shader-white-point-slider",
        key: "whitePoint",
        expectedValue: "1",
        expectedLabel: "1.00",
      },
      {
        testId: "shader-black-point-slider",
        key: "blackPoint",
        expectedValue: "0",
        expectedLabel: "0.00",
      },
      {
        testId: "shader-gamma-slider",
        key: "gamma",
        expectedValue: "1",
        expectedLabel: "1.00",
      },
    ] as const;

    for (const spec of sliderSpecs) {
      const slider = screen.getByTestId(spec.testId);
      const range = SHADER_PARAM_RANGES[spec.key];
      expect(slider).toHaveAttribute("type", "range");
      expect(slider).toHaveAttribute("dir", "ltr");
      expect(slider).toHaveAttribute("min", String(range.min));
      expect(slider).toHaveAttribute("max", String(range.max));
      expect(slider).toHaveAttribute("step", String(range.step));
      expect(slider).toHaveValue(spec.expectedValue);
      expect(slider).toHaveClass("touch-manipulation");
      expect(screen.getByTestId(`${spec.testId}-value`)).toHaveTextContent(
        spec.expectedLabel,
      );
    }

    const resetButton = screen.getByTestId("shader-reset-button");
    const saveButton = screen.getByTestId("shader-save-default-button");
    const closeButton = screen.getByTestId("shader-sheet-close-button");
    expect(resetButton).toHaveTextContent("リセット");
    expect(resetButton).toHaveClass("touch-manipulation");
    expect(saveButton).toHaveTextContent("デフォルト保存");
    expect(saveButton).toHaveClass("touch-manipulation");
    expect(closeButton).toHaveTextContent("閉じる");
    expect(closeButton).toHaveClass("touch-manipulation");

    expect(screen.queryByTestId("shader-save-status")).not.toBeInTheDocument();
  });

  it("CustomAdjusted・SavedFeedback・SaveErrorFeedbackストーリーとsaveStatus省略時を正しく描画すること (AC-RD-13)", () => {
    const { unmount: unmountAdjusted } = render(<CustomAdjusted />);
    expect(screen.getByTestId("shader-sharpness-slider")).toHaveValue("0.45");
    expect(
      screen.getByTestId("shader-sharpness-slider-value"),
    ).toHaveTextContent("0.45");
    expect(screen.getByTestId("shader-white-point-slider")).toHaveValue("0.92");
    expect(
      screen.getByTestId("shader-white-point-slider-value"),
    ).toHaveTextContent("0.92");
    expect(screen.getByTestId("shader-black-point-slider")).toHaveValue("0.08");
    expect(
      screen.getByTestId("shader-black-point-slider-value"),
    ).toHaveTextContent("0.08");
    expect(screen.getByTestId("shader-gamma-slider")).toHaveValue("0.85");
    expect(screen.getByTestId("shader-gamma-slider-value")).toHaveTextContent(
      "0.85",
    );
    unmountAdjusted();

    const { unmount: unmountSaved } = render(<SavedFeedback />);
    const savedStatus = screen.getByTestId("shader-save-status");
    expect(savedStatus).toHaveAttribute("role", "status");
    expect(savedStatus).toHaveTextContent("デフォルト設定を保存しました");
    unmountSaved();

    const { unmount: unmountError } = render(<SaveErrorFeedback />);
    const errorStatus = screen.getByTestId("shader-save-status");
    expect(errorStatus).toHaveAttribute("role", "alert");
    expect(errorStatus).toHaveTextContent("デフォルト設定の保存に失敗しました");
    unmountError();

    // saveStatus 省略時はデフォルト "idle" として非表示
    render(
      <ReaderShaderSheet
        isOpen={true}
        shaderParams={DEFAULT_SHADER_CORRECTION_PARAMS}
        onChangeShaderParams={vi.fn()}
        onReset={vi.fn()}
        onSaveDefault={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("shader-save-status")).not.toBeInTheDocument();
  });

  it("4本のスライダー操作で正規化済みパラメータを渡してonChangeShaderParamsが呼ばれること (AC-RD-13)", () => {
    const onChangeShaderParams = vi.fn();
    render(
      <CustomAdjusted
        shaderParams={{
          sharpness: 0.2,
          whitePoint: 0.95,
          blackPoint: 0.05,
          gamma: 1.0,
        }}
        onChangeShaderParams={onChangeShaderParams}
      />,
    );

    fireEvent.change(screen.getByTestId("shader-sharpness-slider"), {
      target: { value: "0.65" },
    });
    expect(onChangeShaderParams).toHaveBeenLastCalledWith({
      sharpness: 0.65,
      whitePoint: 0.95,
      blackPoint: 0.05,
      gamma: 1.0,
    });

    fireEvent.change(screen.getByTestId("shader-white-point-slider"), {
      target: { value: "0.88" },
    });
    expect(onChangeShaderParams).toHaveBeenLastCalledWith({
      sharpness: 0.2,
      whitePoint: 0.88,
      blackPoint: 0.05,
      gamma: 1.0,
    });

    fireEvent.change(screen.getByTestId("shader-black-point-slider"), {
      target: { value: "0.12" },
    });
    expect(onChangeShaderParams).toHaveBeenLastCalledWith({
      sharpness: 0.2,
      whitePoint: 0.95,
      blackPoint: 0.12,
      gamma: 1.0,
    });

    fireEvent.change(screen.getByTestId("shader-gamma-slider"), {
      target: { value: "1.25" },
    });
    expect(onChangeShaderParams).toHaveBeenLastCalledWith({
      sharpness: 0.2,
      whitePoint: 0.95,
      blackPoint: 0.05,
      gamma: 1.25,
    });
  });

  it("リセット・デフォルト保存・閉じるボタンおよびバックドロップクリックで対応コールバックが呼ばれ、ポインター/クリックイベントが親タップ領域へ伝播しないこと (AC-RD-13)", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const onSaveDefault = vi.fn();
    const onClose = vi.fn();
    const parentClick = vi.fn();
    const parentPointerDown = vi.fn();
    const parentPointerUp = vi.fn();
    const parentPointerCancel = vi.fn();

    render(
      <div
        onClick={parentClick}
        onPointerDown={parentPointerDown}
        onPointerUp={parentPointerUp}
        onPointerCancel={parentPointerCancel}
      >
        <Default
          onReset={onReset}
          onSaveDefault={onSaveDefault}
          onClose={onClose}
        />
      </div>,
    );

    const backdrop = screen.getByTestId("reader-shader-backdrop");
    const sheet = screen.getByTestId("reader-shader-sheet");

    // シート上のポインター・クリックイベントはバックドロップや親へ伝播しない
    fireEvent.pointerDown(sheet);
    fireEvent.pointerUp(sheet);
    fireEvent.pointerCancel(sheet);
    fireEvent.click(sheet);
    expect(onClose).not.toHaveBeenCalled();

    // 各ボタン操作
    await user.click(screen.getByTestId("shader-reset-button"));
    expect(onReset).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("shader-save-default-button"));
    expect(onSaveDefault).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("shader-sheet-close-button"));
    expect(onClose).toHaveBeenCalledTimes(1);

    // バックドロップ上のポインターイベントは伝播せず、クリックで onClose のみ呼ばれる
    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
    fireEvent.pointerCancel(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);

    expect(parentClick).not.toHaveBeenCalled();
    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentPointerUp).not.toHaveBeenCalled();
    expect(parentPointerCancel).not.toHaveBeenCalled();
  });

  it("ボトムシート開閉時に先頭要素への初期フォーカス・Tab循環トラップ・クローズ時フォーカス復帰を行うこと (AC-RD-13)", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(<Default isOpen={true} />);
    const sheet = screen.getByTestId("reader-shader-sheet");
    const closeBtn = screen.getByTestId("shader-sheet-close-button");
    const saveBtn = screen.getByTestId("shader-save-default-button");

    expect(sheet).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(closeBtn);

    const shiftTab = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      cancelable: true,
    });
    document.dispatchEvent(shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(saveBtn);

    const forwardTab = new KeyboardEvent("keydown", {
      key: "Tab",
      cancelable: true,
    });
    document.dispatchEvent(forwardTab);
    expect(forwardTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeBtn);

    rerender(<Default isOpen={false} />);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
