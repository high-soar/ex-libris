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

export class MockDriveSyncClient implements DriveSyncClient {
  constructor(_options: MockDriveSyncClientOptions = {}) {
    void _options;
  }

  setInjectedError(_error: Error | null): void {
    void _error;
  }

  setPageSize(_pageSize: number): void {
    void _pageSize;
  }

  setItems(_items: readonly DriveSyncFileItem[]): void {
    void _items;
  }

  upsertItem(_item: DriveSyncFileItem, _recordChange = true): void {
    void _item;
    void _recordChange;
  }

  removeItem(_fileId: string, _recordChange = true): void {
    void _fileId;
    void _recordChange;
  }

  trashItem(_fileId: string, _recordChange = true): void {
    void _fileId;
    void _recordChange;
  }

  pushChange(_change: DriveChangeItem): void {
    void _change;
  }

  expireAllIssuedTokens(): void {
    // stub
  }

  reset(): void {
    // stub
  }

  async getStartPageToken(_signal?: AbortSignal): Promise<string> {
    void _signal;
    throw new Error("Not implemented");
  }

  async listItemsInParents(
    _parentFolderIds: readonly string[],
    _options?: ListItemsInParentsOptions,
  ): Promise<DriveSyncFilesPage> {
    void _parentFolderIds;
    void _options;
    throw new Error("Not implemented");
  }

  async getFileMetadata(
    _fileId: string,
    _signal?: AbortSignal,
  ): Promise<DriveSyncFileItem | null> {
    void _fileId;
    void _signal;
    throw new Error("Not implemented");
  }

  async listChanges(
    _pageToken: string,
    _options?: ListChangesOptions,
  ): Promise<DriveChangesPage> {
    void _pageToken;
    void _options;
    throw new Error("Not implemented");
  }
}
