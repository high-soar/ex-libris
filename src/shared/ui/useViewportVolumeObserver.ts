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

function areSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false;
    }
  }
  return true;
}

function notifyIfChanged(
  visibleElements: ReadonlyMap<Element, string>,
  lastReportedIdsRef: { current: Set<string> },
  scheduler: Pick<CoverExtractionScheduler, "setViewportVolumeIds">,
  screenKey: CoverViewportScreenKey,
): void {
  const nextIds = new Set(visibleElements.values());
  if (!areSetsEqual(nextIds, lastReportedIdsRef.current)) {
    lastReportedIdsRef.current = nextIds;
    scheduler.setViewportVolumeIds(screenKey, new Set(nextIds));
  }
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
  const visibleElementsRef = useRef<Map<Element, string>>(new Map());
  const lastReportedIdsRef = useRef<Set<string>>(new Set());
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

    const visibleElements = visibleElementsRef.current;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const volumeId = entry.target.getAttribute(COVER_VOLUME_ID_ATTRIBUTE);
          if (
            entry.isIntersecting &&
            volumeId &&
            pendingSetRef.current.has(volumeId)
          ) {
            visibleElements.set(entry.target, volumeId);
          } else {
            visibleElements.delete(entry.target);
          }
        }
        notifyIfChanged(
          visibleElements,
          lastReportedIdsRef,
          scheduler,
          screenKey,
        );
      },
      { rootMargin: VIEWPORT_OBSERVER_ROOT_MARGIN },
    );

    observerRef.current = observer;

    return () => {
      observer.disconnect();
      observerRef.current = null;
      observedElementsRef.current.clear();
      visibleElements.clear();
      lastReportedIdsRef.current = new Set();
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
    const nextObserved = new Map<Element, string>();

    const candidates = container.querySelectorAll(
      `[${COVER_VOLUME_ID_ATTRIBUTE}]`,
    );
    for (const element of candidates) {
      const volumeId = element.getAttribute(COVER_VOLUME_ID_ATTRIBUTE);
      if (volumeId && currentPending.has(volumeId)) {
        nextObserved.set(element, volumeId);
      }
    }

    const prevObserved = observedElementsRef.current;
    for (const element of prevObserved) {
      if (!nextObserved.has(element)) {
        observer.unobserve(element);
      }
    }
    for (const element of nextObserved.keys()) {
      if (!prevObserved.has(element)) {
        observer.observe(element);
      }
    }
    observedElementsRef.current = new Set(nextObserved.keys());

    const visibleElements = visibleElementsRef.current;
    for (const element of visibleElements.keys()) {
      const nextVolumeId = nextObserved.get(element);
      if (nextVolumeId === undefined) {
        visibleElements.delete(element);
      } else {
        visibleElements.set(element, nextVolumeId);
      }
    }
    notifyIfChanged(visibleElements, lastReportedIdsRef, scheduler, screenKey);
  }, [containerRef, enabled, pendingKey, scheduler, screenKey]);
}
