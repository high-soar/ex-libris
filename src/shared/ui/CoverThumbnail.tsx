import { type ReactNode, useEffect, useState } from "react";
import type { CoverStatus } from "../../storage/types";

export interface CoverThumbnailProps {
  readonly coverBlob: Blob | null;
  readonly coverStatus: CoverStatus;
  readonly title: string;
  readonly badgeText?: string;
}

export function CoverThumbnail({
  coverBlob,
  coverStatus,
  title,
  badgeText,
}: CoverThumbnailProps): ReactNode {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (coverStatus !== "ready" || coverBlob === null) {
      setObjectUrl(null);
      return;
    }

    const createdUrl = URL.createObjectURL(coverBlob);
    setObjectUrl(createdUrl);

    return () => {
      URL.revokeObjectURL(createdUrl);
    };
  }, [coverBlob, coverStatus]);

  const trimmedTitle = title.trim();
  const initialChar =
    trimmedTitle.length > 0 ? Array.from(trimmedTitle)[0] : "?";

  return (
    <div
      data-testid="cover-thumbnail"
      className="relative aspect-[5/7] w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950"
    >
      {objectUrl !== null ? (
        <img
          data-testid="cover-thumbnail-image"
          src={objectUrl}
          alt={`${title} の表紙`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          data-testid="cover-thumbnail-placeholder"
          className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 p-3 text-center"
        >
          <span
            data-testid="cover-thumbnail-initial"
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-indigo-400/30 bg-indigo-500/15 text-xl font-bold text-indigo-200"
          >
            {initialChar}
          </span>
          {trimmedTitle.length > 0 && (
            <p className="mt-3 line-clamp-3 break-words text-xs font-medium leading-snug text-slate-300">
              {trimmedTitle}
            </p>
          )}
        </div>
      )}
      {objectUrl === null && coverStatus === "error" && (
        <span
          data-testid="cover-thumbnail-error-badge"
          className="absolute left-1 top-1 max-w-[calc(100%-0.5rem)] truncate whitespace-nowrap rounded-md border border-amber-500/50 bg-slate-950/90 px-1 py-0.5 text-[9px] font-semibold leading-none text-amber-200"
        >
          取得失敗
        </span>
      )}
      {badgeText !== undefined && badgeText.length > 0 && (
        <span
          data-testid="cover-thumbnail-badge"
          className="absolute bottom-1.5 right-1.5 rounded-md border border-slate-700/80 bg-slate-950/85 px-1.5 py-0.5 text-[11px] font-semibold text-slate-100 backdrop-blur-sm"
        >
          {badgeText}
        </span>
      )}
    </div>
  );
}
