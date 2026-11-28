export type ArchiveSourceDescriptor =
  | {
      readonly kind: "gdrive";
      readonly volumeId: string;
      readonly driveFileId: string;
      readonly fileSize: number;
      readonly md5Checksum: string | null;
      /** `${"gdrive"}:${driveFileId}:${md5Checksum ?? fileSize}` */
      readonly indexCacheKey: string;
      /** `vol:${volumeId}` */
      readonly progressTargetKey: string;
    }
  | {
      readonly kind: "local-session";
      readonly file: File;
      readonly rawFileName: string;
      readonly fileSize: number;
      /** `local:${rawFileName}:${fileSize}` */
      readonly indexCacheKey: string;
      /** `local:${rawFileName}:${fileSize}` */
      readonly progressTargetKey: string;
    };

export interface RandomAccessReader {
  readonly sourceId: string;
  readonly totalSize: number;
  /**
   * 指定バイト範囲 [offset, offset + length - 1] を取得する。
   * 終端超過時は実ファイル末尾までにクランプした Uint8Array を返す。
   */
  readRange(
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
}

export type ZipCompressionMethod = 0 | 8; // 0: Store (無圧縮), 8: Deflate

export type ZipErrorCode =
  | "CORRUPT_ZIP"
  | "EMPTY_ARCHIVE"
  | "ENCRYPTED_ZIP"
  | "UNSUPPORTED_COMPRESSION"
  | "DECODE_FAILED"
  | "READ_ERROR";

export interface ZipPageEntry {
  /** ゴミ除外・自然順ソート後の 0 始まり論理ページ番号 */
  readonly pageIndex: number;
  /** UTF-8 または Shift_JIS デコード後のエントリパス */
  readonly entryName: string;
  /** CDH 記載の元ファイル名バイト長（LFH 1 RTT スライス長計算用） */
  readonly entryNameByteLength: number;
  readonly compressionMethod: ZipCompressionMethod;
  /** Central Directory 記載の正確な圧縮サイズ（Bit 3 有効時も信頼できる正値） */
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  /** Local File Header 先頭の物理バイトオフセット（64bit 安全整数） */
  readonly localHeaderOffset: number;
  /** 次の物理エントリ先頭または Central Directory 開始オフセット（1 RTT 取得上限） */
  readonly physicalEnd: number;
  readonly crc32: number;
}

export type DecodedPageFrame =
  | {
      readonly status: "ready";
      readonly pageIndex: number;
      readonly epoch: number;
      readonly width: number;
      readonly height: number;
      /** Transferable Object として所有権ごと UI スレッドへ Zero-Copy 転送される */
      readonly bitmap: ImageBitmap;
    }
  | {
      readonly status: "error";
      readonly pageIndex: number;
      readonly epoch: number;
      readonly errorCode: ZipErrorCode;
      readonly message: string;
    };

export interface OpenArchiveResult {
  readonly pageCount: number;
  readonly entries: readonly ZipPageEntry[];
  readonly fromIndexCache: boolean;
}

export interface RequestVisiblePagesOptions {
  /**
   * L1 近傍プリデコードまたは L2 補充呼び出し（`pageIndices` が空配列の場合を含む）において、
   * 現在画面に表示中の論理ページ番号群を明示指定する（省略時は `pageIndices` を表示中とみなす）。
   * L2ByteCache の 80MB 超例外ページの一時保持ピン管理および `allowOversized` 判定に使用する。
   */
  readonly visiblePageIndices?: readonly number[];
}

export interface CoordinatorHostCallbacks {
  refreshAccessToken(options?: {
    readonly forceRefresh?: boolean;
    readonly failedToken?: string;
  }): Promise<string>;

  reportDiagnostic(
    level: "warn" | "error",
    scope: string,
    message: string,
    detail?: string,
  ): void;
}

export interface CoordinatorWorkerApi {
  openArchive(
    source: ArchiveSourceDescriptor,
    cachedEntries: readonly ZipPageEntry[] | null,
    epoch: number,
  ): Promise<OpenArchiveResult>;

  requestVisiblePages(
    pageIndices: readonly number[],
    prefetchIndices: readonly number[],
    epoch: number,
    options?: RequestVisiblePagesOptions,
  ): Promise<DecodedPageFrame[]>;

  updateAccessToken(accessToken: string | null): void;
  setHostCallbacks(callbacks: CoordinatorHostCallbacks | null): void;
  cancelEpochBelow(minActiveEpoch: number): void;
  closeArchive(): Promise<void>;
}

export interface DecodeWorkerApi {
  decodePageSlice(
    compressedData: Uint8Array,
    compressionMethod: ZipCompressionMethod,
    expectedUncompressedSize?: number,
  ): Promise<{
    bitmap: ImageBitmap;
    width: number;
    height: number;
  }>;
}
