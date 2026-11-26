import type { SeriesDetailViewModel } from "../bookshelf/bookshelfViewModel";

export type SeriesDetailPageInitialSnapshot =
  | { readonly kind: "loading" }
  | { readonly kind: "empty" }
  | {
      readonly kind: "ready";
      readonly viewModel: SeriesDetailViewModel;
    };
