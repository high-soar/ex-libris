import { type RefObject, useEffect, useMemo, useRef } from "react";
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

export function useViewportVolumeObserver({
  containerRef,
  screenKey,
  scheduler,
  pendingVolumeIds,
  enabled = true,
}: UseViewportVolumeObserverParams): void {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const observedElementsRef = useRef<Set<Element>>(new Set());
  const visibleIdsRef = useRef<Set<string>>(new Set());
  const pendingSet = useMemo(
    () => new Set(pendingVolumeIds),
    [pendingVolumeIds],
  );
  const pendingSetRef = useRef<ReadonlySet<string>>(pendingSet);
  pendingSetRef.current = pendingSet;

  const pendingKey = pendingVolumeIds.join("\u0000");

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        const visibleIds = visibleIdsRef.current;
        for (const entry of entries) {
          const volumeId = entry.target.getAttribute(COVER_VOLUME_ID_ATTRIBUTE);
          if (!volumeId) {
            continue;
          }
          if (entry.isIntersecting && pendingSetRef.current.has(volumeId)) {
            if (!visibleIds.has(volumeId)) {
              visibleIds.add(volumeId);
              changed = true;
            }
          } else if (visibleIds.delete(volumeId)) {
            changed = true;
          }
        }
        if (changed) {
          scheduler.setViewportVolumeIds(screenKey, new Set(visibleIds));
        }
      },
      { rootMargin: VIEWPORT_OBSERVER_ROOT_MARGIN },
    );

    observerRef.current = observer;

    return () => {
      observer.disconnect();
      observerRef.current = null;
      observedElementsRef.current.clear();
      visibleIdsRef.current.clear();
      scheduler.setViewportVolumeIds(screenKey, new Set());
    };
  }, [enabled, scheduler, screenKey]);

  useEffect(() => {
    const observer = observerRef.current;
    const container = containerRef.current;
    if (!enabled || observer === null || container === null) {
      return;
    }

    const currentPending = pendingSetRef.current;
    const nextObserved = new Set<Element>();
    const activeDomIds = new Set<string>();

    const candidates = container.querySelectorAll(
      `[${COVER_VOLUME_ID_ATTRIBUTE}]`,
    );
    for (const element of candidates) {
      const volumeId = element.getAttribute(COVER_VOLUME_ID_ATTRIBUTE);
      if (volumeId && currentPending.has(volumeId)) {
        nextObserved.add(element);
        activeDomIds.add(volumeId);
      }
    }

    const prevObserved = observedElementsRef.current;
    for (const element of prevObserved) {
      if (!nextObserved.has(element)) {
        observer.unobserve(element);
      }
    }
    for (const element of nextObserved) {
      if (!prevObserved.has(element)) {
        observer.observe(element);
      }
    }
    observedElementsRef.current = nextObserved;

    let pruned = false;
    const visibleIds = visibleIdsRef.current;
    for (const visibleId of visibleIds) {
      if (!activeDomIds.has(visibleId)) {
        visibleIds.delete(visibleId);
        pruned = true;
      }
    }
    if (pruned) {
      scheduler.setViewportVolumeIds(screenKey, new Set(visibleIds));
    }
  }, [containerRef, enabled, pendingKey, scheduler, screenKey]);
}
