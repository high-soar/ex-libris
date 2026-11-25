import { create } from "zustand";

export interface BookshelfUiState {
  readonly scrollY: number;
  readonly saveScrollY: (scrollY: number) => void;
  readonly clearScrollY: () => void;
}

function normalizeScrollY(scrollY: number): number {
  return Number.isFinite(scrollY) && scrollY > 0 ? scrollY : 0;
}

export const useBookshelfUiStateStore = create<BookshelfUiState>((set) => ({
  scrollY: 0,
  saveScrollY: (scrollY: number) => {
    set({ scrollY: normalizeScrollY(scrollY) });
  },
  clearScrollY: () => {
    set({ scrollY: 0 });
  },
}));

export function resetBookshelfUiState(): void {
  useBookshelfUiStateStore.setState({ scrollY: 0 });
}
