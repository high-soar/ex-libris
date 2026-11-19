import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { diagnosticLogger } from "../../diagnostics/diagnosticLogger";
import { useRouter } from "../../shared/router/routerContext";
import { useLocalReaderSessionStore } from "../reader/localReaderSessionStore";
import { BookshelfHeader, type CopyStatus } from "./BookshelfHeader";
import { LocalArchiveEmptyState } from "./LocalArchiveEmptyState";

export interface BookshelfPageProps {
  readonly initialCopyStatus?: CopyStatus;
  readonly initialErrorMessage?: string | null;
  readonly initialDragActive?: boolean;
}

const UNSUPPORTED_EXTENSION_MESSAGE =
  "対応形式は .zip または .cbz ファイルのみです";

function isSupportedArchiveFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".zip") || lower.endsWith(".cbz");
}

export function BookshelfPage({
  initialCopyStatus = "idle",
  initialErrorMessage = null,
  initialDragActive = false,
}: BookshelfPageProps) {
  const { navigate } = useRouter();
  const openLocalFile = useLocalReaderSessionStore(
    (state) => state.openLocalFile,
  );

  const [copyStatus, setCopyStatus] = useState<CopyStatus>(initialCopyStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialErrorMessage,
  );
  const [isDragActive, setIsDragActive] = useState<boolean>(initialDragActive);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleOpenLocalZip = () => {
    (fileInputRef.current as HTMLInputElement).click();
  };

  const handleSelectedFile = (file: File | undefined) => {
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
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    handleSelectedFile(file);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragActive(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    handleSelectedFile(event.dataTransfer.files?.[0]);
  };

  const handleCopyDiagnostics = async () => {
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
  };

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
        className="flex-1 flex items-center justify-center p-6"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <LocalArchiveEmptyState
          isDragActive={isDragActive}
          errorMessage={errorMessage}
          onOpenLocalZip={handleOpenLocalZip}
        />
        <input
          ref={fileInputRef}
          type="file"
          data-testid="local-zip-file-input"
          accept=".zip,.cbz,application/zip,application/x-zip-compressed,application/x-cbz,application/octet-stream"
          className="hidden"
          onChange={handleFileChange}
        />
      </main>
    </div>
  );
}
