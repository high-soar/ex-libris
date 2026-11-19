import type { AppBridge, BackButtonListener } from "./types";

export class MockAppBridge implements AppBridge {
  minimizeAppCalled = false;

  addBackButtonListener(_listener: BackButtonListener): () => void {
    return () => {};
  }

  async minimizeApp(): Promise<void> {}

  getMinimizeAppCallCount(): number {
    return 0;
  }

  async triggerBackButton(_canGoBack = false): Promise<void> {}

  reset(): void {}
}
