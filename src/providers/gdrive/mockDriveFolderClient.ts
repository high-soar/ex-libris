import type {
  DriveFolderClient,
  DriveFolderMetadata,
  DriveFolderPage,
  ListChildFoldersOptions,
  ResolveDriveFolderOptions,
} from "./types";

export interface MockDriveFolderNode {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly isFolder?: boolean;
  readonly trashed?: boolean;
}

export interface MockDriveFolderClientOptions {
  readonly nodes?: readonly MockDriveFolderNode[];
  readonly pageSize?: number;
}

export class MockDriveFolderClient implements DriveFolderClient {
  constructor(_options: MockDriveFolderClientOptions = {}) {}

  setInjectedError(_error: Error | null): void {}

  setNodes(_nodes: readonly MockDriveFolderNode[]): void {}

  reset(): void {}

  async resolveFolderById(
    _folderId: string,
    _options?: ResolveDriveFolderOptions,
  ): Promise<DriveFolderMetadata> {
    throw new Error("Not implemented");
  }

  async listChildFolders(
    _parentFolderId: string,
    _options?: ListChildFoldersOptions,
  ): Promise<DriveFolderPage> {
    throw new Error("Not implemented");
  }
}
