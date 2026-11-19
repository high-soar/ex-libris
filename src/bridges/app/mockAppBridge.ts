import type { AppBridge, BackButtonEvent, BackButtonListener } from "./types";

export class MockAppBridge implements AppBridge {
  private readonly listeners = new Set<BackButtonListener>();
  minimizeAppCalled = false;
  private minimizeAppCount = 0;

  addBackButtonListener(listener: BackButtonListener): () => void {
    this.listeners.add(listener);
    let isRemoved = false;
    return () => {
      if (isRemoved) {
        return;
      }
      isRemoved = true;
      this.listeners.delete(listener);
    };
  }

  async minimizeApp(): Promise<void> {
    this.minimizeAppCalled = true;
    this.minimizeAppCount += 1;
  }

  getMinimizeAppCallCount(): number {
    return this.minimizeAppCount;
  }

  async triggerBackButton(canGoBack = false): Promise<void> {
    const event: BackButtonEvent = { canGoBack };
    for (const listener of Array.from(this.listeners)) {
      await listener(event);
    }
  }

  reset(): void {
    this.listeners.clear();
    this.minimizeAppCalled = false;
    this.minimizeAppCount = 0;
  }
}
