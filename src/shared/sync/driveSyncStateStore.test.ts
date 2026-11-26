import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleAuthError } from "../../bridges/oauth/googleAuthErrors";
import { createDiagnosticLogger } from "../../diagnostics/diagnosticLogger";
import { DriveApiError } from "../../providers/gdrive/driveApiErrors";
import type {
  DriveSyncEngine,
  DriveSyncResult,
} from "../../providers/gdrive/types";
import type { DriveSyncMetaRepository } from "../../storage/repositories/driveSyncMetaRepository";
import {
  formatDriveSyncErrorMessage,
  resetDriveSyncState,
  useDriveSyncStateStore,
} from "./driveSyncStateStore";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createSyncResult(
  overrides: Partial<DriveSyncResult> = {},
): DriveSyncResult {
  return {
    mode: "incremental",
    scannedRoots: 1,
    upsertedVolumes: 3,
    trashedVolumes: 0,
    invalidatedZipCaches: 1,
    syncedAt: 1_700_000_100_000,
    ...overrides,
  };
}

describe("driveSyncStateStore", () => {
  beforeEach(() => {
    resetDriveSyncState();
  });

  it("初期状態とresetDriveSyncStateで全フィールドが初期化されること", () => {
    expect(useDriveSyncStateStore.getState()).toMatchObject({
      phase: "idle",
      activeMode: null,
      lastSyncedAt: null,
      isLastSyncedAtLoaded: false,
      lastResult: null,
      errorMessage: null,
      completedSyncCount: 0,
    });

    useDriveSyncStateStore.setState({
      phase: "completed",
      activeMode: "full",
      lastSyncedAt: 1_700_000_000_000,
      isLastSyncedAtLoaded: true,
      lastResult: createSyncResult(),
      errorMessage: "err",
      completedSyncCount: 2,
    });

    resetDriveSyncState();
    expect(useDriveSyncStateStore.getState()).toMatchObject({
      phase: "idle",
      activeMode: null,
      lastSyncedAt: null,
      isLastSyncedAtLoaded: false,
      lastResult: null,
      errorMessage: null,
      completedSyncCount: 0,
    });
  });

  it("hydrateLastSyncedAtが未読込時のみ最終同期日時を水和し、読込済み再呼出・先行完了した新同期時刻上書き・読込失敗を安全に扱うこと (AC-ST-08)", async () => {
    const logger = createDiagnosticLogger();
    const metaRepo: Pick<DriveSyncMetaRepository, "getSyncState"> = {
      getSyncState: vi.fn(async () => ({
        startPageToken: "tok-1",
        lastDriveSyncAt: 1_700_000_050_000,
        syncedRootFolderIds: ["root-1"],
      })),
    };

    // 1. 初回水和
    await useDriveSyncStateStore
      .getState()
      .hydrateLastSyncedAt(metaRepo, logger);
    expect(useDriveSyncStateStore.getState().lastSyncedAt).toBe(
      1_700_000_050_000,
    );
    expect(useDriveSyncStateStore.getState().isLastSyncedAtLoaded).toBe(true);
    expect(metaRepo.getSyncState).toHaveBeenCalledTimes(1);

    // 2. 読込済み後の再呼出は no-op
    await useDriveSyncStateStore
      .getState()
      .hydrateLastSyncedAt(metaRepo, logger);
    expect(metaRepo.getSyncState).toHaveBeenCalledTimes(1);

    // 3. 水和待機中に手動同期が先行完了した場合、古い lastDriveSyncAt で上書きしないこと
    resetDriveSyncState();
    const metaDeferred = createDeferred<{
      startPageToken: string | null;
      lastDriveSyncAt: number | null;
      syncedRootFolderIds: readonly string[];
    }>();
    const slowMetaRepo: Pick<DriveSyncMetaRepository, "getSyncState"> = {
      getSyncState: vi.fn(() => metaDeferred.promise),
    };
    const syncEngine: DriveSyncEngine = {
      sync: vi.fn(async () =>
        createSyncResult({ syncedAt: 1_700_000_999_000 }),
      ),
    };

    const hydratePromise = useDriveSyncStateStore
      .getState()
      .hydrateLastSyncedAt(slowMetaRepo, logger);
    await useDriveSyncStateStore
      .getState()
      .runDriveSync({ driveSyncEngine: syncEngine, logger });
    expect(useDriveSyncStateStore.getState().lastSyncedAt).toBe(
      1_700_000_999_000,
    );

    metaDeferred.resolve({
      startPageToken: "old",
      lastDriveSyncAt: 1_700_000_010_000,
      syncedRootFolderIds: [],
    });
    await hydratePromise;
    expect(useDriveSyncStateStore.getState().lastSyncedAt).toBe(
      1_700_000_999_000,
    );
    expect(useDriveSyncStateStore.getState().isLastSyncedAtLoaded).toBe(true);

    // 4. 取得エラー時は warn ログのみ記録してクラッシュしないこと（Error / non-Error 双方）
    resetDriveSyncState();
    const failingMetaRepo: Pick<DriveSyncMetaRepository, "getSyncState"> = {
      getSyncState: vi
        .fn()
        .mockRejectedValueOnce(new Error("idb read error"))
        .mockRejectedValueOnce("string error"),
    };
    await useDriveSyncStateStore
      .getState()
      .hydrateLastSyncedAt(failingMetaRepo, logger);
    await useDriveSyncStateStore
      .getState()
      .hydrateLastSyncedAt(failingMetaRepo, logger);
    expect(useDriveSyncStateStore.getState().isLastSyncedAtLoaded).toBe(false);
    expect(useDriveSyncStateStore.getState().lastSyncedAt).toBeNull();
    expect(
      logger
        .getEntries()
        .filter((e) => e.level === "warn" && e.scope === "drive-sync"),
    ).toHaveLength(2);
  });

  it("runDriveSyncが差分/フルスキャン実行・多重実行抑止・skipped-no-roots時のlastSyncedAt保護を行うこと (AC-BS-08, AC-ST-08)", async () => {
    const logger = createDiagnosticLogger();
    const syncDeferred = createDeferred<DriveSyncResult>();
    const engine: DriveSyncEngine = {
      sync: vi.fn(() => syncDeferred.promise),
    };

    // 1. 実行中は phase="syncing", activeMode="incremental" となり多重呼出を抑止する
    const firstPromise = useDriveSyncStateStore
      .getState()
      .runDriveSync({ driveSyncEngine: engine, logger });
    expect(useDriveSyncStateStore.getState()).toMatchObject({
      phase: "syncing",
      activeMode: "incremental",
      errorMessage: null,
    });

    const duplicateResult = await useDriveSyncStateStore
      .getState()
      .runDriveSync({ driveSyncEngine: engine, forceFullScan: true, logger });
    expect(duplicateResult).toBeNull();
    expect(engine.sync).toHaveBeenCalledTimes(1);
    expect(engine.sync).toHaveBeenCalledWith({ forceFullScan: false });

    const completedResult = createSyncResult({
      mode: "incremental",
      syncedAt: 1_700_000_200_000,
    });
    syncDeferred.resolve(completedResult);
    expect(await firstPromise).toEqual(completedResult);
    expect(useDriveSyncStateStore.getState()).toMatchObject({
      phase: "completed",
      activeMode: null,
      lastSyncedAt: 1_700_000_200_000,
      isLastSyncedAtLoaded: true,
      lastResult: completedResult,
      errorMessage: null,
      completedSyncCount: 1,
    });

    // 2. forceFullScan: true 実行
    const fullResult = createSyncResult({
      mode: "full",
      scannedRoots: 2,
      upsertedVolumes: 10,
      syncedAt: 1_700_000_300_000,
    });
    const fullEngine: DriveSyncEngine = {
      sync: vi.fn(async () => fullResult),
    };
    const fullPromise = useDriveSyncStateStore.getState().runDriveSync({
      driveSyncEngine: fullEngine,
      forceFullScan: true,
      logger,
    });
    expect(useDriveSyncStateStore.getState().activeMode).toBe("full");
    expect(await fullPromise).toEqual(fullResult);
    expect(fullEngine.sync).toHaveBeenCalledWith({ forceFullScan: true });
    expect(useDriveSyncStateStore.getState()).toMatchObject({
      phase: "completed",
      activeMode: null,
      lastSyncedAt: 1_700_000_300_000,
      completedSyncCount: 2,
    });

    // 3. skipped-no-roots 時は直前の lastSyncedAt を保護し phase="idle" へ戻す
    const skippedResult = createSyncResult({
      mode: "skipped-no-roots",
      scannedRoots: 0,
      upsertedVolumes: 0,
      trashedVolumes: 0,
      invalidatedZipCaches: 0,
      syncedAt: 1_700_000_400_000,
    });
    const skippedEngine: DriveSyncEngine = {
      sync: vi.fn(async () => skippedResult),
    };
    expect(
      await useDriveSyncStateStore
        .getState()
        .runDriveSync({ driveSyncEngine: skippedEngine, logger }),
    ).toEqual(skippedResult);
    expect(useDriveSyncStateStore.getState()).toMatchObject({
      phase: "idle",
      activeMode: null,
      lastSyncedAt: 1_700_000_300_000,
      lastResult: skippedResult,
      errorMessage: null,
      completedSyncCount: 3,
    });
  });

  it("runDriveSync失敗時にエラー種別ごとの日本語メッセージ変換と診断ログ記録を行うこと (AC-ST-08)", async () => {
    const logger = createDiagnosticLogger();
    const failEngine: DriveSyncEngine = {
      sync: vi
        .fn()
        .mockRejectedValueOnce(new DriveApiError("UNAUTHORIZED", "401"))
        .mockRejectedValueOnce("non-error failure"),
    };

    expect(
      await useDriveSyncStateStore
        .getState()
        .runDriveSync({ driveSyncEngine: failEngine, logger }),
    ).toBeNull();
    expect(useDriveSyncStateStore.getState()).toMatchObject({
      phase: "error",
      activeMode: null,
      errorMessage:
        "Google アカウントの認証が切れました。設定画面から再ログインしてください",
      completedSyncCount: 0,
    });

    expect(
      await useDriveSyncStateStore
        .getState()
        .runDriveSync({ driveSyncEngine: failEngine, logger }),
    ).toBeNull();
    expect(useDriveSyncStateStore.getState()).toMatchObject({
      phase: "error",
      activeMode: null,
      errorMessage: "Google Drive 同期中に予期しないエラーが発生しました",
    });

    const errorLogs = logger
      .getEntries()
      .filter(
        (entry) => entry.level === "error" && entry.scope === "drive-sync",
      );
    expect(errorLogs).toHaveLength(2);
  });

  it("formatDriveSyncErrorMessageがDriveApiError・GoogleAuthError・未知エラーを全て日本語メッセージへ変換すること", () => {
    expect(
      formatDriveSyncErrorMessage(new DriveApiError("UNAUTHORIZED", "401")),
    ).toContain("認証が切れました");
    expect(
      formatDriveSyncErrorMessage(new DriveApiError("TOKEN_EXPIRED", "401")),
    ).toContain("認証が切れました");
    expect(
      formatDriveSyncErrorMessage(new DriveApiError("FORBIDDEN", "403")),
    ).toContain("アクセス権限");
    expect(
      formatDriveSyncErrorMessage(new DriveApiError("NOT_FOUND", "404")),
    ).toContain("フォルダが見つかりません");
    expect(
      formatDriveSyncErrorMessage(new DriveApiError("NOT_A_FOLDER", "400")),
    ).toContain("フォルダが見つかりません");
    expect(
      formatDriveSyncErrorMessage(new DriveApiError("FOLDER_TRASHED", "404")),
    ).toContain("フォルダが見つかりません");
    expect(
      formatDriveSyncErrorMessage(new DriveApiError("RATE_LIMITED", "429")),
    ).toContain("利用制限");
    expect(
      formatDriveSyncErrorMessage(new DriveApiError("NETWORK_ERROR", "net")),
    ).toContain("ネットワークエラー");

    expect(
      formatDriveSyncErrorMessage(new GoogleAuthError("AUTH_REQUIRED", "req")),
    ).toContain("ログインしていない");
    expect(
      formatDriveSyncErrorMessage(new GoogleAuthError("AUTH_CANCELLED", "can")),
    ).toContain("キャンセル");
    expect(
      formatDriveSyncErrorMessage(
        new GoogleAuthError("AUTH_NETWORK_ERROR", "net"),
      ),
    ).toContain("ネットワークエラー");
    expect(
      formatDriveSyncErrorMessage(new GoogleAuthError("AUTH_FAILED", "fail")),
    ).toContain("認証に失敗");

    expect(formatDriveSyncErrorMessage(new Error("unexpected"))).toContain(
      "予期しないエラー",
    );
  });
});
