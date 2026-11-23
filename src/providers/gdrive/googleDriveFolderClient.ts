import type { GoogleAuthBridge } from "../../bridges/oauth/types";
import type { DiagnosticLogger } from "../../diagnostics/types";
import type {
  DriveFolderClient,
  DriveFolderMetadata,
  DriveFolderPage,
  ListChildFoldersOptions,
  ResolveDriveFolderOptions,
} from "./types";

export interface GoogleDriveFolderClientOptions {
  readonly authBridge: GoogleAuthBridge;
  readonly fetchFn?: typeof fetch;
  readonly logger?: DiagnosticLogger;
}

export class GoogleDriveFolderClient implements DriveFolderClient {
  constructor(_options: GoogleDriveFolderClientOptions) {}

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
