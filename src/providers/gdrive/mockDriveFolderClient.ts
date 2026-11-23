import { DriveApiError } from "./driveApiErrors";
import type {
  DriveFolderClient,
  DriveFolderMetadata,
  DriveFolderPage,
  ListChildFoldersOptions,
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

const DEFAULT_MOCK_NODES: readonly MockDriveFolderNode[] = [
  { id: "mock-folder-comics", name: "Comics", parentId: "root" },
  { id: "mock-folder-manga", name: "自炊マンガ", parentId: "root" },
  {
    id: "mock-folder-action",
    name: "アクション",
    parentId: "mock-folder-comics",
  },
  { id: "mock-folder-scifi", name: "SF", parentId: "mock-folder-comics" },
  { id: "mock-folder-weekly", name: "週刊誌", parentId: "mock-folder-manga" },
];

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

export class MockDriveFolderClient implements DriveFolderClient {
  private readonly initialNodes: readonly MockDriveFolderNode[];
  private readonly pageSize: number;
  private nodes: MockDriveFolderNode[];
  private injectedError: Error | null = null;

  constructor(options: MockDriveFolderClientOptions = {}) {
    this.initialNodes = options.nodes ?? DEFAULT_MOCK_NODES;
    this.pageSize = options.pageSize ?? 100;
    this.nodes = [...this.initialNodes];
  }

  setInjectedError(error: Error | null): void {
    this.injectedError = error;
  }

  setNodes(nodes: readonly MockDriveFolderNode[]): void {
    this.nodes = [...nodes];
  }

  reset(): void {
    this.nodes = [...DEFAULT_MOCK_NODES];
    this.injectedError = null;
  }

  private assertReady(signal?: AbortSignal): void {
    throwIfAborted(signal);
    if (this.injectedError !== null) {
      throw this.injectedError;
    }
  }

  private resolveActiveNode(id: string): MockDriveFolderNode {
    const node = this.nodes.find((entry) => entry.id === id);
    if (!node) {
      throw new DriveApiError("NOT_FOUND", `Folder not found: ${id}`, {
        status: 404,
      });
    }
    if (node.isFolder === false) {
      throw new DriveApiError("NOT_A_FOLDER", `Target is not a folder: ${id}`);
    }
    if (node.trashed === true) {
      throw new DriveApiError(
        "FOLDER_TRASHED",
        `Target folder is in trash: ${id}`,
      );
    }
    return node;
  }

  async resolveFolderById(
    folderId: string,
    signal?: AbortSignal,
  ): Promise<DriveFolderMetadata> {
    this.assertReady(signal);
    const normalizedId = folderId.trim();
    if (normalizedId.length === 0 || normalizedId.toLowerCase() === "root") {
      throw new DriveApiError(
        "FORBIDDEN",
        "マイドライブ全体（root）や空のフォルダIDは指定できません",
        { status: 403 },
      );
    }
    const node = this.resolveActiveNode(normalizedId);
    return { id: node.id, name: node.name };
  }

  async listChildFolders(
    parentFolderId: string,
    options?: ListChildFoldersOptions,
  ): Promise<DriveFolderPage> {
    this.assertReady(options?.signal);
    const normalizedParentId = parentFolderId.trim();
    if (normalizedParentId.length === 0) {
      throw new DriveApiError("FORBIDDEN", "親フォルダIDが指定されていません", {
        status: 403,
      });
    }
    if (normalizedParentId !== "root") {
      this.resolveActiveNode(normalizedParentId);
    }

    const children = this.nodes
      .filter(
        (entry) =>
          entry.parentId === normalizedParentId &&
          entry.isFolder !== false &&
          entry.trashed !== true,
      )
      .map((entry): DriveFolderMetadata => ({
        id: entry.id,
        name: entry.name,
      }));

    const offset = options?.pageToken
      ? Number.parseInt(options.pageToken, 10)
      : 0;
    const slice = children.slice(offset, offset + this.pageSize);
    const nextOffset = offset + this.pageSize;
    const nextPageToken =
      nextOffset < children.length ? String(nextOffset) : null;

    return {
      folders: slice,
      nextPageToken,
    };
  }
}
