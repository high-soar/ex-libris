import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useServices } from "../../app/serviceContext";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import { buildReaderVolumePath } from "../../shared/router/routeMatcher";
import { useRouter } from "../../shared/router/routerContext";
import { useDriveSyncStateStore } from "../../shared/sync/driveSyncStateStore";
import type { ReadingProgressRecord } from "../../storage/types";
import { useBookshelfUiStateStore } from "../bookshelf/bookshelfUiStateStore";
import {
  type SeriesDetailViewModel,
  buildSeriesDetailViewModel,
} from "../bookshelf/bookshelfViewModel";
import { SeriesDetailEmptyState } from "./SeriesDetailEmptyState";
import { SeriesDetailHeader } from "./SeriesDetailHeader";
import { SeriesSummaryCard } from "./SeriesSummaryCard";
import { SeriesVolumeListSection } from "./SeriesVolumeListSection";
import type { SeriesDetailPageInitialSnapshot } from "./types";

export interface SeriesDetailPageProps {
  readonly seriesId: string;
  readonly initialSnapshot?: SeriesDetailPageInitialSnapshot;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SeriesDetailPage({
  seriesId,
  initialSnapshot,
}: SeriesDetailPageProps): ReactNode {
  const { seriesRepo, volumesRepo, driveSyncRootsRepo, readingProgressRepo } =
    useServices();
  const { navigate, back } = useRouter();
  const saveSeriesDetailScroll = useBookshelfUiStateStore(
    (state) => state.saveSeriesDetailScroll,
  );
  const clearSeriesDetailScroll = useBookshelfUiStateStore(
    (state) => state.clearSeriesDetailScroll,
  );
  const completedSyncCount = useDriveSyncStateStore(
    (state) => state.completedSyncCount,
  );

  const hasSnapshot = initialSnapshot !== undefined;
  const [isSettled, setIsSettled] = useState<boolean>(
    hasSnapshot ? initialSnapshot.kind !== "loading" : false,
  );
  const [viewModel, setViewModel] = useState<SeriesDetailViewModel | null>(
    initialSnapshot?.kind === "ready" ? initialSnapshot.viewModel : null,
  );

  useEffect(() => {
    if (hasSnapshot) {
      return;
    }

    let isCancelled = false;

    void (async () => {
      try {
        const [rawSeries, roots, rawVolumes] = await Promise.all([
          seriesRepo.getById(seriesId),
          driveSyncRootsRepo.listActive(),
          volumesRepo.listBySeriesId(seriesId),
        ]);
        if (isCancelled) {
          return;
        }

        const activeSeries =
          rawSeries !== null && rawSeries.deletedAt === null ? rawSeries : null;
        const enabledRootIds = new Set(
          roots
            .filter((root) => root.enabled === 1)
            .map((root) => root.folderId),
        );
        const visibleVolumeIds = new Set(
          rawVolumes
            .filter(
              (volume) =>
                volume.seriesId === seriesId &&
                volume.isTrashed === 0 &&
                enabledRootIds.has(volume.rootFolderId),
            )
            .map((volume) => volume.id),
        );

        let progressByVolumeId: ReadonlyMap<string, ReadingProgressRecord> =
          new Map();
        if (activeSeries !== null && visibleVolumeIds.size > 0) {
          progressByVolumeId =
            await readingProgressRepo.listByVolumeIds(visibleVolumeIds);
          if (isCancelled) {
            return;
          }
        }

        const nextViewModel = buildSeriesDetailViewModel({
          series: activeSeries,
          volumes: rawVolumes,
          enabledRootIds,
          progressByVolumeId,
        });
        setViewModel(nextViewModel);
        setIsSettled(true);
      } catch (error) {
        if (isCancelled) {
          return;
        }
        diagnosticLogger.warn(
          "series-detail",
          "シリーズ詳細の読み込みに失敗しました",
          `${seriesId}: ${formatErrorMessage(error)}`,
        );
        setViewModel(null);
        setIsSettled(true);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [
    hasSnapshot,
    seriesId,
    completedSyncCount,
    seriesRepo,
    volumesRepo,
    driveSyncRootsRepo,
    readingProgressRepo,
  ]);

  useEffect(() => {
    if (!isSettled) {
      return;
    }
    const saved = useBookshelfUiStateStore.getState().seriesDetailScroll;
    if (saved === null) {
      return;
    }
    if (saved.seriesId === seriesId && saved.scrollY > 0) {
      window.scrollTo(0, saved.scrollY);
    }
    clearSeriesDetailScroll();
  }, [isSettled, seriesId, clearSeriesDetailScroll]);

  const handleBack = useCallback(() => {
    back();
  }, [back]);

  const handleSelectVolume = useCallback(
    (volumeId: string) => {
      saveSeriesDetailScroll(seriesId, window.scrollY);
      navigate(buildReaderVolumePath(volumeId), {
        readerOrigin: "series-detail",
        seriesId,
      });
    },
    [navigate, saveSeriesDetailScroll, seriesId],
  );

  return (
    <div
      data-testid="series-detail-page"
      className="min-h-screen bg-slate-950 text-slate-100"
    >
      <SeriesDetailHeader
        title={viewModel?.series.title ?? null}
        onBack={handleBack}
      />

      <main
        style={{
          paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))",
        }}
        className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6"
      >
        {!isSettled ? (
          <div
            data-testid="series-detail-loading"
            role="status"
            aria-live="polite"
            className="rounded-2xl border border-slate-800 bg-slate-900/80 px-6 py-10 text-center text-sm text-slate-300"
          >
            シリーズ情報を読み込み中...
          </div>
        ) : viewModel === null ? (
          <SeriesDetailEmptyState onBack={handleBack} />
        ) : (
          <>
            <SeriesSummaryCard
              title={viewModel.series.title}
              authors={viewModel.series.authors}
              representativeVolume={viewModel.representativeVolume}
              volumeCount={viewModel.volumeCount}
              completedCount={viewModel.completedCount}
              quickLaunch={viewModel.quickLaunch}
              onQuickRead={handleSelectVolume}
            />
            <SeriesVolumeListSection
              volumes={viewModel.volumes}
              onSelectVolume={handleSelectVolume}
            />
          </>
        )}
      </main>
    </div>
  );
}
