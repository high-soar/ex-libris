import { App } from "@capacitor/app";
import type { AppBridge, BackButtonListener } from "./types";

export class CapacitorAppBridge implements AppBridge {
  addBackButtonListener(listener: BackButtonListener): () => void {
    let isRemoved = false;
    const handlePromise = App.addListener("backButton", listener);
    void handlePromise.catch(() => {});

    return () => {
      if (isRemoved) {
        return;
      }
      isRemoved = true;
      void handlePromise
        .then((handle) => {
          void handle.remove().catch(() => {});
        })
        .catch(() => {});
    };
  }

  async minimizeApp(): Promise<void> {
    await App.minimizeApp();
  }
}
