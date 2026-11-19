import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackButtonEvent } from "./types";

const mockAppPlugin = vi.hoisted(() => ({
  addListener: vi.fn(),
  minimizeApp: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({
  App: mockAppPlugin,
}));

import { CapacitorAppBridge } from "./capacitorAppBridge";

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("CapacitorAppBridge", () => {
  beforeEach(() => {
    mockAppPlugin.addListener.mockReset();
    mockAppPlugin.minimizeApp.mockReset();
  });

  it("backButtonリスナーを登録し、イベント通知および重複解除耐性付きの解除が動作すること", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    let capturedListener: ((event: BackButtonEvent) => void) | undefined;

    mockAppPlugin.addListener.mockImplementation(
      async (
        _eventName: string,
        listener: (event: BackButtonEvent) => void,
      ) => {
        capturedListener = listener;
        return { remove };
      },
    );

    const bridge = new CapacitorAppBridge();
    const userListener = vi.fn();
    const unsubscribe = bridge.addBackButtonListener(userListener);

    expect(mockAppPlugin.addListener).toHaveBeenCalledTimes(1);
    expect(mockAppPlugin.addListener).toHaveBeenCalledWith(
      "backButton",
      userListener,
    );

    await flushMicrotasks();
    capturedListener?.({ canGoBack: true });
    expect(userListener).toHaveBeenCalledWith({ canGoBack: true });

    // 1回目の解除で remove() が呼ばれ、2回目以降はノーオペであること
    unsubscribe();
    unsubscribe();
    await flushMicrotasks();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("addListenerまたはhandle.removeが拒否されても未処理Promise拒否を発生させないこと", async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      // 1. addListener 自体が拒否された場合
      mockAppPlugin.addListener.mockRejectedValueOnce(
        new Error("plugin unavailable"),
      );
      const bridge = new CapacitorAppBridge();
      const unsubscribeFailedAdd = bridge.addBackButtonListener(vi.fn());
      await flushMicrotasks();
      unsubscribeFailedAdd();
      await flushMicrotasks();

      // 2. handle.remove が拒否された場合
      const failingRemove = vi
        .fn()
        .mockRejectedValue(new Error("remove failed"));
      mockAppPlugin.addListener.mockResolvedValueOnce({
        remove: failingRemove,
      });
      const unsubscribeFailedRemove = bridge.addBackButtonListener(vi.fn());
      unsubscribeFailedRemove();
      await flushMicrotasks();

      expect(failingRemove).toHaveBeenCalledTimes(1);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("minimizeApp()で@capacitor/appのApp.minimizeApp()を呼び出すこと", async () => {
    mockAppPlugin.minimizeApp.mockResolvedValueOnce(undefined);
    const bridge = new CapacitorAppBridge();

    await bridge.minimizeApp();

    expect(mockAppPlugin.minimizeApp).toHaveBeenCalledTimes(1);
  });
});
