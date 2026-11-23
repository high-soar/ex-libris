import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useServices } from "../../app/serviceContext";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import { useRouter } from "../../shared/router/routerContext";
import {
  type LocalReadingHistoryItem,
  RECENT_LOCAL_HISTORY_DEFAULT_LIMIT,
} from "../../storage/repositories/readingProgressRepository";
import { useLocalReaderSessionStore } from "../reader/localReaderSessionStore";
import { BookshelfHeader, type CopyStatus } from "./BookshelfHeader";
import type { DriveSetupBannerState } from "./DriveSetupBanner";
import { LocalArchiveEmptyState } from "./LocalArchiveEmptyState";
import { RecentLocalHistorySection } from "./RecentLocalHistorySection";

export interface BookshelfPageProps {
  readonly initialCopyStatus?: CopyStatus;
  readonly initialErrorMessage?: string | null;
  readonly initialDragActive?: boolean;
  readonly initialRecentHistory?: readonly LocalReadingHistoryItem[];
  readonly initialDriveSetupState?: DriveSetupBannerState;
}

const LOCAL_ARCHIVE_INPUT_ACCEPT =
  ".zip,.cbz,application/zip,application/x-zip-compressed,application/x-cbz,application/octet-stream";

const UNSUPPORTED_EXTENSION_MESSAGE =
  "対応形式は .zip または .cbz ファイルのみです";

function isSupportedArchiveFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".zip") || lower.endsWith(".cbz");
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BookshelfPage({
  initialCopyStatus = "idle",
  initialErrorMessage = null,
  initialDragActive = false,
  initialRecentHistory,
  initialDriveSetupState,
}: BookshelfPageProps) {
  void initialDriveSetupState;
  const { readingProgressRepo } = useServices();
  const { navigate } = useRouter();
  const openLocalFile = useLocalReaderSessionStore(
    (state) => state.openLocalFile,
  );

  const [copyStatus, setCopyStatus] = useState<CopyStatus>(initialCopyStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialErrorMessage,
  );
  const [isDragActive, setIsDragActive] = useState<boolean>(initialDragActive);
  const [recentHistory, setRecentHistory] = useState<
    readonly LocalReadingHistoryItem[]
  >(initialRecentHistory ?? []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (initialRecentHistory !== undefined) {
      return;
    }

    let cancelled = false;
    void readingProgressRepo
      .listRecentLocal(RECENT_LOCAL_HISTORY_DEFAULT_LIMIT)
      .then((items) => {
        if (!cancelled) {
          setRecentHistory(items);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          diagnosticLogger.warn(
            "bookshelf",
            "最近の閲覧履歴の取得に失敗しました",
            formatErrorMessage(error),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialRecentHistory, readingProgressRepo]);

  const handleOpenLocalZip = useCallback(() => {
    (fileInputRef.current as HTMLInputElement).click();
  }, []);

  const handleSelectedFile = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }

      if (!isSupportedArchiveFile(file.name)) {
        setErrorMessage(UNSUPPORTED_EXTENSION_MESSAGE);
        diagnosticLogger.warn(
          "bookshelf",
          "Unsupported archive extension",
          file.name,
        );
        return;
      }

      setErrorMessage(null);
      openLocalFile(file);
      navigate("/read/local");
    },
    [navigate, openLocalFile],
  );

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      handleSelectedFile(file);
    },
    [handleSelectedFile],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setIsDragActive(false);
      handleSelectedFile(event.dataTransfer.files?.[0]);
    },
    [handleSelectedFile],
  );

  const handleCopyDiagnostics = useCallback(async () => {
    const report = diagnosticLogger.formatReport();
    if (!navigator.clipboard) {
      setCopyStatus("failed");
      return;
    }

    try {
      await navigator.clipboard.writeText(report);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }, []);

  const runMountedHistoryMutation = useCallback(
    async (
      operation: () => Promise<void>,
      onSuccess: () => void,
      warnMessage: string,
      warnDetailPrefix?: string,
    ) => {
      try {
        await operation();
        if (!isMountedRef.current) {
          return;
        }
        onSuccess();
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }
        const message = formatErrorMessage(error);
        diagnosticLogger.warn(
          "bookshelf",
          warnMessage,
          warnDetailPrefix === undefined
            ? message
            : `${warnDetailPrefix}: ${message}`,
        );
      }
    },
    [],
  );

  const handleDeleteHistoryItem = useCallback(
    (targetKey: string) =>
      runMountedHistoryMutation(
        () => readingProgressRepo.delete(targetKey),
        () =>
          setRecentHistory((prev) =>
            prev.filter((item) => item.targetKey !== targetKey),
          ),
        "閲覧履歴の削除に失敗しました",
        targetKey,
      ),
    [readingProgressRepo, runMountedHistoryMutation],
  );

  const handleClearHistory = useCallback(
    () =>
      runMountedHistoryMutation(
        () => readingProgressRepo.clearLocal(),
        () => setRecentHistory([]),
        "閲覧履歴のクリアに失敗しました",
      ),
    [readingProgressRepo, runMountedHistoryMutation],
  );

  return (
    <div
      data-testid="bookshelf-page"
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col"
    >
      <BookshelfHeader
        copyStatus={copyStatus}
        onCopyDiagnostics={handleCopyDiagnostics}
        onOpenLocalZip={handleOpenLocalZip}
      />
      <main
        className="flex-1 flex flex-col items-center justify-center gap-6 p-6"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <LocalArchiveEmptyState
          isDragActive={isDragActive}
          errorMessage={errorMessage}
          onOpenLocalZip={handleOpenLocalZip}
        />
        <RecentLocalHistorySection
          items={recentHistory}
          onReopenLocalFile={handleOpenLocalZip}
          onDeleteItem={handleDeleteHistoryItem}
          onClearAll={handleClearHistory}
        />
        <input
          ref={fileInputRef}
          type="file"
          data-testid="local-zip-file-input"
          accept={LOCAL_ARCHIVE_INPUT_ACCEPT}
          className="hidden"
          onChange={handleFileChange}
        />
      </main>
    </div>
  );
}
