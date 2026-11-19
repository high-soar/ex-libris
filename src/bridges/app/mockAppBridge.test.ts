import { describe, expect, it, vi } from "vitest";
import { MockAppBridge } from "./mockAppBridge";

describe("MockAppBridge", () => {
  it("バックキーリスナー登録・triggerBackButton(既定false/明示true)・重複解除耐性が動作すること", async () => {
    const bridge = new MockAppBridge();
    const firstEvents: boolean[] = [];
    const secondEvents: boolean[] = [];

    const unsubscribeFirst = bridge.addBackButtonListener((event) => {
      firstEvents.push(event.canGoBack);
    });
    const unsubscribeSecond = bridge.addBackButtonListener(async (event) => {
      secondEvents.push(event.canGoBack);
      await Promise.resolve();
    });

    await bridge.triggerBackButton();
    await bridge.triggerBackButton(true);

    expect(firstEvents).toEqual([false, true]);
    expect(secondEvents).toEqual([false, true]);

    // 1つ目のリスナーを二重に解除しても安全で、2つ目のみ引き続き発火すること
    unsubscribeFirst();
    unsubscribeFirst();
    await bridge.triggerBackButton(false);

    expect(firstEvents).toEqual([false, true]);
    expect(secondEvents).toEqual([false, true, false]);

    unsubscribeSecond();
    await bridge.triggerBackButton(true);
    expect(secondEvents).toEqual([false, true, false]);
  });

  it("minimizeApp呼び出し回数とフラグを記録しresetで全状態を初期化すること", async () => {
    const bridge = new MockAppBridge();
    const listener = vi.fn();
    bridge.addBackButtonListener(listener);

    expect(bridge.minimizeAppCalled).toBe(false);
    expect(bridge.getMinimizeAppCallCount()).toBe(0);

    await bridge.minimizeApp();
    expect(bridge.minimizeAppCalled).toBe(true);
    expect(bridge.getMinimizeAppCallCount()).toBe(1);

    await bridge.minimizeApp();
    expect(bridge.getMinimizeAppCallCount()).toBe(2);

    bridge.reset();
    expect(bridge.minimizeAppCalled).toBe(false);
    expect(bridge.getMinimizeAppCallCount()).toBe(0);

    await bridge.triggerBackButton();
    expect(listener).not.toHaveBeenCalled();
  });
});
