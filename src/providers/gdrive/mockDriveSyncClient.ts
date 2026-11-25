import { DriveApiError } from "./driveApiErrors";
import {
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  throwIfAborted,
} from "./driveHttpClient";
import type {
  DriveChangeItem,
  DriveChangesPage,
  DriveSyncClient,
  DriveSyncFileItem,
  DriveSyncFilesPage,
  ListChangesOptions,
  ListItemsInParentsOptions,
} from "./types";

export interface MockDriveSyncClientOptions {
  readonly items?: readonly DriveSyncFileItem[];
  readonly pageSize?: number;
}

const DEFAULT_MODIFIED_TIME = Date.parse("2026-11-25T09:00:00.000Z");

function createDefaultMockItems(): DriveSyncFileItem[] {
  return [
    // ルートフォルダ（MockDriveFolderClient の mock-folder-comics / mock-folder-manga と統一）
    {
      id: "mock-folder-comics",
      name: "Comics",
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
      parents: ["root"],
      size: null,
      md5Checksum: null,
      modifiedTime: DEFAULT_MODIFIED_TIME,
      trashed: false,
    },
    {
      id: "mock-folder-manga",
      name: "自炊マンガ",
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
      parents: ["root"],
      size: null,
      md5Checksum: null,
      modifiedTime: DEFAULT_MODIFIED_TIME,
      trashed: false,
    },
    // 多段サブフォルダ
    {
      id: "mock-folder-action",
      name: "アクション",
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
      parents: ["mock-folder-comics"],
      size: null,
      md5Checksum: null,
      modifiedTime: DEFAULT_MODIFIED_TIME,
      trashed: false,
    },
    {
      id: "mock-folder-scifi",
      name: "SF",
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
      parents: ["mock-folder-comics"],
      size: null,
      md5Checksum: null,
      modifiedTime: DEFAULT_MODIFIED_TIME,
      trashed: false,
    },
    {
      id: "mock-folder-series-fallback",
      name: "[高橋留美子] めぞん一刻",
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
      parents: ["mock-folder-action"],
      size: null,
      md5Checksum: null,
      modifiedTime: DEFAULT_MODIFIED_TIME,
      trashed: false,
    },
    {
      id: "mock-folder-weekly",
      name: "週刊誌",
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
      parents: ["mock-folder-manga"],
      size: null,
      md5Checksum: null,
      modifiedTime: DEFAULT_MODIFIED_TIME,
      trashed: false,
    },
    // 対象外ルートフォルダ
    {
      id: "mock-folder-other",
      name: "対象外フォルダ",
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
      parents: ["root"],
      size: null,
      md5Checksum: null,
      modifiedTime: DEFAULT_MODIFIED_TIME,
      trashed: false,
    },
    // 単巻＋合本＋親フォルダ補完対象＋非アーカイブ＋対象外ルートZIP
    {
      id: "mock-file-vol1",
      name: "[尾田栄一郎] ONE PIECE 第01巻 (一般コミック).cbz",
      mimeType: "application/octet-stream",
      parents: ["mock-folder-action"],
      size: 12_345_678,
      md5Checksum: "md5-op-01",
      modifiedTime: DEFAULT_MODIFIED_TIME + 1_000,
      trashed: false,
    },
    {
      id: "mock-file-vol2",
      name: "[尾田栄一郎] ONE PIECE 第02巻.zip",
      mimeType: "application/zip",
      parents: ["mock-folder-action"],
      size: 13_456_789,
      md5Checksum: "md5-op-02",
      modifiedTime: DEFAULT_MODIFIED_TIME + 2_000,
      trashed: false,
    },
    {
      id: "mock-file-omnibus",
      name: "[大友克洋] AKIRA 第01-03巻 合本.cbz",
      mimeType: "application/octet-stream",
      parents: ["mock-folder-scifi"],
      size: 45_000_000,
      md5Checksum: "md5-akira-0103",
      modifiedTime: DEFAULT_MODIFIED_TIME + 3_000,
      trashed: false,
    },
    {
      id: "mock-file-parent-fallback",
      name: "01.cbz",
      mimeType: "application/octet-stream",
      parents: ["mock-folder-series-fallback"],
      size: 9_876_543,
      md5Checksum: "md5-maison-01",
      modifiedTime: DEFAULT_MODIFIED_TIME + 4_000,
      trashed: false,
    },
    {
      id: "mock-file-manga-1",
      name: "[荒木飛呂彦] ジョジョの奇妙な冒険 第01巻.cbz",
      mimeType: "application/zip",
      parents: ["mock-folder-weekly"],
      size: 11_111_111,
      md5Checksum: "md5-jojo-01",
      modifiedTime: DEFAULT_MODIFIED_TIME + 5_000,
      trashed: false,
    },
    {
      id: "mock-file-readme",
      name: "README.txt",
      mimeType: "text/plain",
      parents: ["mock-folder-comics"],
      size: 1_024,
      md5Checksum: "md5-readme",
      modifiedTime: DEFAULT_MODIFIED_TIME + 6_000,
      trashed: false,
    },
    {
      id: "mock-file-outside",
      name: "[対象外] ルート外コミック 第01巻.cbz",
      mimeType: "application/zip",
      parents: ["mock-folder-other"],
      size: 8_000_000,
      md5Checksum: "md5-outside-01",
      modifiedTime: DEFAULT_MODIFIED_TIME + 7_000,
      trashed: false,
    },
  ];
}

function cloneItem(item: DriveSyncFileItem): DriveSyncFileItem {
  return {
    ...item,
    parents: [...item.parents],
  };
}

export class MockDriveSyncClient implements DriveSyncClient {
  private readonly initialPageSize: number;
  private pageSize: number;
  private items: Map<string, DriveSyncFileItem> = new Map();
  private changeLog: DriveChangeItem[] = [];
  private minValidTokenIndex = 0;
  private injectedError: Error | null = null;

  constructor(options: MockDriveSyncClientOptions = {}) {
    this.initialPageSize = options.pageSize ?? 1000;
    this.pageSize = this.initialPageSize;
    this.loadItems(options.items ?? createDefaultMockItems());
  }

  private loadItems(source: readonly DriveSyncFileItem[]): void {
    this.items = new Map();
    for (const item of source) {
      this.items.set(item.id, cloneItem(item));
    }
    this.changeLog = [];
    this.minValidTokenIndex = 0;
  }

  private assertReady(signal?: AbortSignal): void {
    throwIfAborted(signal);
    if (this.injectedError !== null) {
      throw this.injectedError;
    }
  }

  setInjectedError(error: Error | null): void {
    this.injectedError = error;
  }

  setPageSize(pageSize: number): void {
    this.pageSize = pageSize;
  }

  setItems(items: readonly DriveSyncFileItem[]): void {
    this.loadItems(items);
  }

  upsertItem(item: DriveSyncFileItem, recordChange = true): void {
    const cloned = cloneItem(item);
    this.items.set(cloned.id, cloned);
    if (recordChange) {
      this.changeLog.push({
        fileId: cloned.id,
        removed: false,
        file: cloneItem(cloned),
      });
    }
  }

  removeItem(fileId: string, recordChange = true): void {
    this.items.delete(fileId);
    if (recordChange) {
      this.changeLog.push({
        fileId,
        removed: true,
        file: null,
      });
    }
  }

  trashItem(fileId: string, recordChange = true): void {
    const existing = this.items.get(fileId);
    if (!existing) {
      return;
    }
    const trashedItem: DriveSyncFileItem = {
      ...cloneItem(existing),
      trashed: true,
    };
    this.items.set(fileId, trashedItem);
    if (recordChange) {
      this.changeLog.push({
        fileId,
        removed: false,
        file: cloneItem(trashedItem),
      });
    }
  }

  pushChange(change: DriveChangeItem): void {
    this.changeLog.push({
      fileId: change.fileId,
      removed: change.removed,
      file: change.file !== null ? cloneItem(change.file) : null,
    });
  }

  expireAllIssuedTokens(): void {
    this.minValidTokenIndex = this.changeLog.length + 1;
  }

  reset(): void {
    this.pageSize = this.initialPageSize;
    this.injectedError = null;
    this.loadItems(createDefaultMockItems());
  }

  async getStartPageToken(signal?: AbortSignal): Promise<string> {
    this.assertReady(signal);
    const currentIndex = Math.max(
      this.changeLog.length,
      this.minValidTokenIndex,
    );
    return String(currentIndex);
  }

  async listItemsInParents(
    parentFolderIds: readonly string[],
    options?: ListItemsInParentsOptions,
  ): Promise<DriveSyncFilesPage> {
    this.assertReady(options?.signal);
    const parentSet = new Set(parentFolderIds);
    const matched: DriveSyncFileItem[] = [];
    for (const item of this.items.values()) {
      if (
        !item.trashed &&
        item.parents.some((parentId) => parentSet.has(parentId))
      ) {
        matched.push(cloneItem(item));
      }
    }

    const offset = options?.pageToken
      ? Number.parseInt(options.pageToken, 10)
      : 0;
    const slice = matched.slice(offset, offset + this.pageSize);
    const nextOffset = offset + this.pageSize;
    const nextPageToken =
      nextOffset < matched.length ? String(nextOffset) : null;

    return {
      files: slice,
      nextPageToken,
    };
  }

  async getFileMetadata(
    fileId: string,
    signal?: AbortSignal,
  ): Promise<DriveSyncFileItem | null> {
    this.assertReady(signal);
    const found = this.items.get(fileId);
    return found ? cloneItem(found) : null;
  }

  async listChanges(
    pageToken: string,
    options?: ListChangesOptions,
  ): Promise<DriveChangesPage> {
    this.assertReady(options?.signal);
    const parsedIndex = Number.parseInt(pageToken, 10);
    if (
      !Number.isSafeInteger(parsedIndex) ||
      parsedIndex < this.minValidTokenIndex
    ) {
      throw new DriveApiError(
        "TOKEN_EXPIRED",
        `Mock Drive pageToken expired: ${pageToken}`,
        { status: 410 },
      );
    }

    const slice = this.changeLog
      .slice(parsedIndex, parsedIndex + this.pageSize)
      .map((entry): DriveChangeItem => ({
        fileId: entry.fileId,
        removed: entry.removed,
        file: entry.file !== null ? cloneItem(entry.file) : null,
      }));
    const nextIndex = parsedIndex + slice.length;
    const hasMore = nextIndex < this.changeLog.length;

    return {
      changes: slice,
      nextPageToken: hasMore ? String(nextIndex) : null,
      newStartPageToken: hasMore
        ? null
        : String(Math.max(this.changeLog.length, this.minValidTokenIndex)),
    };
  }
}
