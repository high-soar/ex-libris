import { create } from "zustand";

export interface BookshelfUiState {
  readonly scrollY: number;
  readonly saveScrollY: (scrollY: number) => void;
  readonly clearScrollY: () => void;
}

export const useBookshelfUiStateStore = create<BookshelfUiState>(() => ({
  scrollY: 0,
  saveScrollY: () => {},
  clearScrollY: () => {},
}));

export function resetBookshelfUiState(): void {}
