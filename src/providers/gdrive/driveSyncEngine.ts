import type { DriveSyncMetaRepository } from "../../storage/repositories/driveSyncMetaRepository";
import type { DriveSyncRootsRepository } from "../../storage/repositories/driveSyncRootsRepository";
import type { SeriesRepository } from "../../storage/repositories/seriesRepository";
import type { VolumesRepository } from "../../storage/repositories/volumesRepository";
import type { ZipIndexCacheRepository } from "../../storage/repositories/zipIndexCacheRepository";
import type { DriveSyncRootRecord } from "../../storage/types";
import { parseMangaFilename } from "../filename/mangaFilenameParser";
import { DriveApiError } from "./driveApiErrors";
import {
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  throwIfAborted,
} from "./driveHttpClient";
import type {
  DriveChangeItem,
  DriveSyncClient,
  DriveSyncEngine,
  DriveSyncFileItem,
  DriveSyncOptions,
  DriveSyncResult,
} from "./types";

const DEFAULT_MAX_PARENT_BATCH_SIZE = 20;
const DEFAULT_MAX_ANCESTOR_DEPTH = 32;
const ARCHIVE_FILE_NAME_PATTERN = /\.(?:zip|cbz)$/i;

export interface DefaultDriveSyncEngineOptions {
  readonly driveSyncClient: DriveSyncClient;
  readonly driveSyncRootsRepo: DriveSyncRootsRepository;
  readonly driveSyncMetaRepo: DriveSyncMetaRepository;
  readonly seriesRepo: SeriesRepository;
  readonly volumesRepo: VolumesRepository;
  readonly zipIndexCacheRepo: ZipIndexCacheRepository;
  readonly now?: () => number;
  readonly maxParentBatchSize?: number;
  readonly maxAncestorDepth?: number;
}

interface FolderAncestryInfo {
  readonly rootFolderId: string;
  readonly folderName: string;
  readonly isSyncRoot: boolean;
}

interface DiscoveredArchive {
  readonly file: DriveSyncFileItem;
  readonly parentFolderId: string;
  readonly rootFolderId: string;
  readonly parentFolderName: string;
  readonly isParentSyncRoot: boolean;
}

interface IncrementalSyncOutcome {
  readonly fallbackToFullScan: boolean;
  readonly result?: DriveSyncResult;
}

export class DefaultDriveSyncEngine implements DriveSyncEngine {
  private readonly driveSyncClient: DriveSyncClient;
  private readonly driveSyncRootsRepo: DriveSyncRootsRepository;
  private readonly driveSyncMetaRepo: DriveSyncMetaRepository;
  private readonly seriesRepo: SeriesRepository;
  private readonly volumesRepo: VolumesRepository;
  private readonly zipIndexCacheRepo: ZipIndexCacheRepository;
  private readonly now: () => number;
  private readonly maxParentBatchSize: number;
  private readonly maxAncestorDepth: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: DefaultDriveSyncEngineOptions) {
    this.driveSyncClient = options.driveSyncClient;
    this.driveSyncRootsRepo = options.driveSyncRootsRepo;
    this.driveSyncMetaRepo = options.driveSyncMetaRepo;
    this.seriesRepo = options.seriesRepo;
    this.volumesRepo = options.volumesRepo;
    this.zipIndexCacheRepo = options.zipIndexCacheRepo;
    this.now = options.now ?? Date.now;
    this.maxParentBatchSize =
      options.maxParentBatchSize ?? DEFAULT_MAX_PARENT_BATCH_SIZE;
    this.maxAncestorDepth =
      options.maxAncestorDepth ?? DEFAULT_MAX_ANCESTOR_DEPTH;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  sync(options?: DriveSyncOptions): Promise<DriveSyncResult> {
    return this.enqueue(() => this.executeSync(options));
  }

  private async executeSync(
    options?: DriveSyncOptions,
  ): Promise<DriveSyncResult> {
    const signal = options?.signal;
    throwIfAborted(signal);

    const activeRoots = await this.driveSyncRootsRepo.listActive();
    const enabledRoots = activeRoots.filter((root) => root.enabled === 1);
    if (enabledRoots.length === 0) {
      return {
        mode: "skipped-no-roots",
        scannedRoots: 0,
        upsertedVolumes: 0,
        trashedVolumes: 0,
        invalidatedZipCaches: 0,
        syncedAt: this.now(),
      };
    }

    const enabledRootIds = new Set(enabledRoots.map((root) => root.folderId));
    const syncMeta = await this.driveSyncMetaRepo.getSyncState();
    const syncedRootSet = new Set(syncMeta.syncedRootFolderIds);
    const hasUnsyncedEnabledRoot = enabledRoots.some(
      (root) => !syncedRootSet.has(root.folderId),
    );
    const shouldForceFullScan =
      options?.forceFullScan === true ||
      syncMeta.startPageToken === null ||
      syncMeta.syncedFolderIds === null ||
      hasUnsyncedEnabledRoot;

    if (!shouldForceFullScan) {
      try {
        const incrementalOutcome = await this.executeIncrementalSync(
          syncMeta.startPageToken,
          syncMeta.syncedFolderIds,
          enabledRoots,
          enabledRootIds,
          signal,
        );
        if (!incrementalOutcome.fallbackToFullScan) {
          return incrementalOutcome.result!;
        }
      } catch (error) {
        if (!(
          error instanceof DriveApiError && error.code === "TOKEN_EXPIRED"
        )) {
          throw error;
        }
      }
    }

    return this.executeFullScan(enabledRoots, enabledRootIds, signal);
  }

  private async upsertArchiveFile(
    archive: DiscoveredArchive,
  ): Promise<{ readonly invalidatedCache: boolean }> {
    const {
      file,
      parentFolderId,
      rootFolderId,
      parentFolderName,
      isParentSyncRoot,
    } = archive;
    const existing = await this.volumesRepo.getByDriveFileId(file.id);
    const fileSize = file.size ?? 0;

    if (existing === null) {
      const parsed = parseMangaFilename({
        fileName: file.name,
        parentFolderName,
        isParentSyncRoot,
      });
      const series = await this.seriesRepo.findOrCreateByParsedTitle({
        title: parsed.title,
        titleReading: parsed.titleReading,
        authors: parsed.authors,
      });
      await this.volumesRepo.upsertFromDriveSync({
        seriesId: series.id,
        volumeNumber: parsed.volumeNumber,
        volumeLabel: parsed.volumeLabel,
        rawFileName: file.name,
        driveFileId: file.id,
        parentFolderId,
        rootFolderId,
        fileSize,
        md5Checksum: file.md5Checksum,
        driveModifiedTime: file.modifiedTime,
        isTrashed: 0,
      });
      return { invalidatedCache: false };
    }

    let seriesId = existing.seriesId;
    let volumeNumber = existing.volumeNumber;
    let volumeLabel = existing.volumeLabel;

    const nameOrParentChanged =
      existing.rawFileName !== file.name ||
      existing.parentFolderId !== parentFolderId;
    if (nameOrParentChanged && existing.updatedAt === existing.addedAt) {
      const currentSeries = await this.seriesRepo.getById(existing.seriesId);
      if (currentSeries === null || !currentSeries.metadataLocked) {
        const parsed = parseMangaFilename({
          fileName: file.name,
          parentFolderName,
          isParentSyncRoot,
        });
        const nextSeries = await this.seriesRepo.findOrCreateByParsedTitle({
          title: parsed.title,
          titleReading: parsed.titleReading,
          authors: parsed.authors,
        });
        seriesId = nextSeries.id;
        volumeNumber = parsed.volumeNumber;
        volumeLabel = parsed.volumeLabel;
      }
    }

    const upsertResult = await this.volumesRepo.upsertFromDriveSync({
      seriesId,
      volumeNumber,
      volumeLabel,
      rawFileName: file.name,
      driveFileId: file.id,
      parentFolderId,
      rootFolderId,
      fileSize,
      md5Checksum: file.md5Checksum,
      driveModifiedTime: file.modifiedTime,
      isTrashed: 0,
    });
    if (upsertResult.invalidatedCacheKey !== null) {
      await this.zipIndexCacheRepo.delete(upsertResult.invalidatedCacheKey);
      return { invalidatedCache: true };
    }
    return { invalidatedCache: false };
  }

  private async executeFullScan(
    enabledRoots: readonly DriveSyncRootRecord[],
    enabledRootIds: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<DriveSyncResult> {
    throwIfAborted(signal);
    // BFS 開始前に startPageToken を確保してスキャン中の変更取りこぼしを防ぐ
    const startPageToken = await this.driveSyncClient.getStartPageToken(signal);

    const visitedFolders = new Set<string>();
    const folderAncestryMap = new Map<string, FolderAncestryInfo>();
    const bfsQueue: string[] = [];

    for (const root of enabledRoots) {
      visitedFolders.add(root.folderId);
      folderAncestryMap.set(root.folderId, {
        rootFolderId: root.folderId,
        folderName: root.folderName,
        isSyncRoot: true,
      });
      bfsQueue.push(root.folderId);
    }

    const discoveredArchives = new Map<string, DiscoveredArchive>();
    let queueCursor = 0;

    while (queueCursor < bfsQueue.length) {
      throwIfAborted(signal);
      const batch = bfsQueue.slice(
        queueCursor,
        queueCursor + this.maxParentBatchSize,
      );
      queueCursor += batch.length;

      let pageToken: string | undefined;
      do {
        throwIfAborted(signal);
        const page = await this.driveSyncClient.listItemsInParents(batch, {
          pageToken,
          signal,
        });
        for (const item of page.files) {
          if (item.trashed) {
            continue;
          }
          const matchedParentId = item.parents.find((parentId) =>
            folderAncestryMap.has(parentId),
          );
          if (matchedParentId === undefined) {
            continue;
          }
          const parentInfo = folderAncestryMap.get(matchedParentId)!;
          if (item.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
            if (!visitedFolders.has(item.id)) {
              visitedFolders.add(item.id);
              folderAncestryMap.set(item.id, {
                rootFolderId: parentInfo.rootFolderId,
                folderName: item.name,
                isSyncRoot: false,
              });
              bfsQueue.push(item.id);
            }
          } else if (ARCHIVE_FILE_NAME_PATTERN.test(item.name)) {
            discoveredArchives.set(item.id, {
              file: item,
              parentFolderId: matchedParentId,
              rootFolderId: parentInfo.rootFolderId,
              parentFolderName: parentInfo.folderName,
              isParentSyncRoot: parentInfo.isSyncRoot,
            });
          }
        }
        pageToken = page.nextPageToken ?? undefined;
      } while (pageToken !== undefined);
    }

    let upsertedVolumes = 0;
    let invalidatedZipCaches = 0;
    for (const archive of discoveredArchives.values()) {
      throwIfAborted(signal);
      const { invalidatedCache } = await this.upsertArchiveFile(archive);
      upsertedVolumes += 1;
      if (invalidatedCache) {
        invalidatedZipCaches += 1;
      }
    }

    const existingInEnabledRoots =
      await this.volumesRepo.listByRootFolderIds(enabledRootIds);
    const missingDriveFileIds: string[] = [];
    for (const volume of existingInEnabledRoots) {
      if (
        volume.isTrashed === 0 &&
        !discoveredArchives.has(volume.driveFileId)
      ) {
        missingDriveFileIds.push(volume.driveFileId);
      }
    }
    const trashedVolumes =
      await this.volumesRepo.markTrashedByDriveFileIds(missingDriveFileIds);

    const syncedFolderIds = [...visitedFolders]
      .filter((folderId) => !enabledRootIds.has(folderId))
      .sort();

    const syncedAt = this.now();
    await this.driveSyncMetaRepo.saveSyncState({
      startPageToken,
      lastDriveSyncAt: syncedAt,
      syncedRootFolderIds: [...enabledRootIds].sort(),
      syncedFolderIds,
    });

    return {
      mode: "full",
      scannedRoots: enabledRoots.length,
      upsertedVolumes,
      trashedVolumes,
      invalidatedZipCaches,
      syncedAt,
    };
  }

  private async executeIncrementalSync(
    startPageToken: string,
    syncedFolderIds: readonly string[],
    enabledRoots: readonly DriveSyncRootRecord[],
    enabledRootIds: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<IncrementalSyncOutcome> {
    const collapsedChanges = new Map<string, DriveChangeItem>();
    let currentPageToken = startPageToken;
    let nextStartPageToken: string | null = null;

    while (true) {
      throwIfAborted(signal);
      const page = await this.driveSyncClient.listChanges(currentPageToken, {
        signal,
      });
      for (const change of page.changes) {
        collapsedChanges.set(change.fileId, change);
      }
      if (page.nextPageToken !== null) {
        currentPageToken = page.nextPageToken;
        continue;
      }
      nextStartPageToken = page.newStartPageToken ?? startPageToken;
      break;
    }

    const existingInEnabledRoots =
      await this.volumesRepo.listByRootFolderIds(enabledRootIds);
    const knownSubfolderIds = new Set<string>(syncedFolderIds);
    for (const volume of existingInEnabledRoots) {
      if (
        volume.parentFolderId !== null &&
        !enabledRootIds.has(volume.parentFolderId)
      ) {
        knownSubfolderIds.add(volume.parentFolderId);
      }
    }

    const ancestorCache = new Map<string, FolderAncestryInfo | null>();
    for (const root of enabledRoots) {
      ancestorCache.set(root.folderId, {
        rootFolderId: root.folderId,
        folderName: root.folderName,
        isSyncRoot: true,
      });
    }

    const resolveParentUnderEnabledRoots = async (
      startFolderId: string,
    ): Promise<FolderAncestryInfo | null> => {
      const path: Array<{ readonly id: string; readonly name: string }> = [];
      const visiting = new Set<string>();
      let currentId = startFolderId;
      let depth = 0;

      while (true) {
        if (ancestorCache.has(currentId)) {
          const cached = ancestorCache.get(currentId)!;
          for (const node of path) {
            ancestorCache.set(
              node.id,
              cached !== null
                ? {
                    rootFolderId: cached.rootFolderId,
                    folderName: node.name,
                    isSyncRoot: false,
                  }
                : null,
            );
          }
          return ancestorCache.get(startFolderId)!;
        }

        if (visiting.has(currentId)) {
          for (const node of path) {
            ancestorCache.set(node.id, null);
          }
          ancestorCache.set(currentId, null);
          return null;
        }

        if (depth >= this.maxAncestorDepth) {
          return null;
        }

        visiting.add(currentId);
        throwIfAborted(signal);
        const metadata = await this.driveSyncClient.getFileMetadata(
          currentId,
          signal,
        );
        if (
          metadata === null ||
          metadata.trashed ||
          metadata.parents.length === 0
        ) {
          for (const node of path) {
            ancestorCache.set(node.id, null);
          }
          ancestorCache.set(currentId, null);
          return null;
        }

        path.push({ id: currentId, name: metadata.name });
        currentId = metadata.parents[0]!;
        depth += 1;
      }
    };

    // Pass 1: フォルダ単位の変更イベント検知 -> フルスキャンへ自動フォールバック
    for (const change of collapsedChanges.values()) {
      throwIfAborted(signal);
      if (
        change.removed &&
        (enabledRootIds.has(change.fileId) ||
          knownSubfolderIds.has(change.fileId))
      ) {
        return { fallbackToFullScan: true };
      }
      if (change.file?.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
        if (
          enabledRootIds.has(change.file.id) ||
          knownSubfolderIds.has(change.file.id)
        ) {
          return { fallbackToFullScan: true };
        }
        const parentId = change.file.parents[0];
        if (parentId !== undefined) {
          const resolved = await resolveParentUnderEnabledRoots(parentId);
          if (resolved !== null) {
            return { fallbackToFullScan: true };
          }
        }
      }
    }

    // Pass 2: 個別ファイル変更の反映（無効化中ルートの既存巻は保護）
    let upsertedVolumes = 0;
    let invalidatedZipCaches = 0;
    const toTrashDriveFileIds: string[] = [];

    const markIfOwnedByEnabledRoot = async (fileId: string): Promise<void> => {
      const existing = await this.volumesRepo.getByDriveFileId(fileId);
      if (existing !== null && enabledRootIds.has(existing.rootFolderId)) {
        toTrashDriveFileIds.push(fileId);
      }
    };

    for (const change of collapsedChanges.values()) {
      throwIfAborted(signal);
      if (change.removed || change.file === null || change.file.trashed) {
        await markIfOwnedByEnabledRoot(change.fileId);
        continue;
      }
      if (change.file.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
        continue;
      }
      if (!ARCHIVE_FILE_NAME_PATTERN.test(change.file.name)) {
        await markIfOwnedByEnabledRoot(change.fileId);
        continue;
      }

      const parentId = change.file.parents[0];
      const resolvedParent =
        parentId !== undefined
          ? await resolveParentUnderEnabledRoots(parentId)
          : null;
      if (resolvedParent === null) {
        await markIfOwnedByEnabledRoot(change.fileId);
        continue;
      }

      const { invalidatedCache } = await this.upsertArchiveFile({
        file: change.file,
        parentFolderId: parentId!,
        rootFolderId: resolvedParent.rootFolderId,
        parentFolderName: resolvedParent.folderName,
        isParentSyncRoot: resolvedParent.isSyncRoot,
      });
      upsertedVolumes += 1;
      if (invalidatedCache) {
        invalidatedZipCaches += 1;
      }
    }

    const trashedVolumes =
      await this.volumesRepo.markTrashedByDriveFileIds(toTrashDriveFileIds);

    for (const [folderId, info] of ancestorCache.entries()) {
      if (info !== null && !info.isSyncRoot) {
        knownSubfolderIds.add(folderId);
      }
    }

    const syncedAt = this.now();
    await this.driveSyncMetaRepo.saveSyncState({
      startPageToken: nextStartPageToken,
      lastDriveSyncAt: syncedAt,
      syncedRootFolderIds: [...enabledRootIds].sort(),
      syncedFolderIds: [...knownSubfolderIds].sort(),
    });

    return {
      fallbackToFullScan: false,
      result: {
        mode: "incremental",
        scannedRoots: enabledRoots.length,
        upsertedVolumes,
        trashedVolumes,
        invalidatedZipCaches,
        syncedAt,
      },
    };
  }
}
