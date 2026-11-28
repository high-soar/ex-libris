import type { RefObject } from "react";

export interface UseModalFocusTrapOptions {
  readonly isOpen: boolean;
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly fallbackFocusRef?: RefObject<HTMLElement | null>;
}

export function useModalFocusTrap(options: UseModalFocusTrapOptions): void {
  void options;
}
