import { type RefObject, useLayoutEffect } from "react";

export interface UseModalFocusTrapOptions {
  readonly isOpen: boolean;
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly fallbackFocusRef?: RefObject<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => element.closest("[inert]") === null);
}

function canRestoreFocus(element: HTMLElement | null): element is HTMLElement {
  if (
    element === null ||
    element === document.body ||
    element === document.documentElement ||
    !element.isConnected
  ) {
    return false;
  }
  if (element.hasAttribute("disabled") || element.closest("[inert]") !== null) {
    return false;
  }
  return true;
}

export function useModalFocusTrap({
  isOpen,
  containerRef,
  fallbackFocusRef,
}: UseModalFocusTrapOptions): void {
  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const fallbackElement = fallbackFocusRef?.current ?? null;

    const initialFocusables = getFocusableElements(container);
    if (initialFocusables.length > 0) {
      initialFocusables[0].focus();
    } else {
      container.focus();
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") {
        return;
      }

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const isInside = active instanceof Node && container.contains(active);

      if (event.shiftKey) {
        if (!isInside || active === first || active === container) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!isInside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (canRestoreFocus(previouslyFocused)) {
        previouslyFocused.focus();
        return;
      }
      if (canRestoreFocus(fallbackElement)) {
        fallbackElement.focus();
      }
    };
  }, [isOpen, containerRef, fallbackFocusRef]);
}
