import type { AppBridge, BackButtonListener } from "./types";

export class CapacitorAppBridge implements AppBridge {
  addBackButtonListener(_listener: BackButtonListener): () => void {
    return () => {};
  }

  async minimizeApp(): Promise<void> {}
}
