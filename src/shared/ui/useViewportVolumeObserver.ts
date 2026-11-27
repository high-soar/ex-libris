import type { RefObject } from "react";
import type {
  CoverExtractionScheduler,
  CoverViewportScreenKey,
} from "../../engine/cover/types";

export const VIEWPORT_OBSERVER_ROOT_MARGIN = "200px 0px";
export const COVER_VOLUME_ID_ATTRIBUTE = "data-cover-volume-id";

export interface UseViewportVolumeObserverParams {
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly screenKey: CoverViewportScreenKey;
  readonly scheduler: Pick<CoverExtractionScheduler, "setViewportVolumeIds">;
  readonly pendingVolumeIds: readonly string[];
  readonly enabled?: boolean;
}

export function useViewportVolumeObserver(
  params: UseViewportVolumeObserverParams,
): void {
  void params;
}
