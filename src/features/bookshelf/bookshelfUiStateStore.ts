import { create } from "zustand";
import type { BookshelfSortOrder } from "./bookshelfViewModel";

export interface SeriesDetailScrollState {
  readonly seriesId: string;
  readonly scrollY: number;
}

export interface BookshelfUiState {
  readonly scrollY: number;
  readonly sortOrder: BookshelfSortOrder;
  readonly seriesDetailScroll: SeriesDetailScrollState | null;
  readonly saveScrollY: (scrollY: number) => void;
  readonly clearScrollY: () => void;
  readonly setSortOrder: (sortOrder: BookshelfSortOrder) => void;
  readonly saveSeriesDetailScroll: (seriesId: string, scrollY: number) => void;
  readonly clearSeriesDetailScroll: () => void;
}

function normalizeScrollY(scrollY: number): number {
  return Number.isFinite(scrollY) && scrollY > 0 ? scrollY : 0;
}

export const useBookshelfUiStateStore = create<BookshelfUiState>((set) => ({
  scrollY: 0,
  sortOrder: "lastReadDesc",
  seriesDetailScroll: null,
  saveScrollY: (scrollY: number) => {
    set({ scrollY: normalizeScrollY(scrollY) });
  },
  clearScrollY: () => {
    set({ scrollY: 0 });
  },
  setSortOrder: (sortOrder: BookshelfSortOrder) => {
    void sortOrder;
  },
  saveSeriesDetailScroll: (seriesId: string, scrollY: number) => {
    void seriesId;
    void scrollY;
  },
  clearSeriesDetailScroll: () => {},
}));

export function resetBookshelfUiState(): void {
  useBookshelfUiStateStore.setState({ scrollY: 0 });
}
