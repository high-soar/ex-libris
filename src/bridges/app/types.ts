export interface BackButtonEvent {
  canGoBack: boolean;
}

export type BackButtonListener = (
  event: BackButtonEvent,
) => void | Promise<void>;

export interface AppBridge {
  addBackButtonListener(listener: BackButtonListener): () => void;
  minimizeApp(): Promise<void>;
}
