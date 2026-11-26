import type { ReactNode } from "react";
import type { CoverStatus } from "../../storage/types";

export interface CoverThumbnailProps {
  readonly coverBlob: Blob | null;
  readonly coverStatus: CoverStatus;
  readonly title: string;
  readonly badgeText?: string;
}

export function CoverThumbnail(_props: CoverThumbnailProps): ReactNode {
  return null;
}
