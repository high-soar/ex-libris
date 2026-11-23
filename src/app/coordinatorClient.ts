import * as Comlink from "comlink";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import type { CoordinatorWorkerApi } from "../engine/types";
import { registerZipArchiveErrorTransferHandler } from "../engine/workers/comlinkErrorHandler";
import { ZipArchiveError } from "../engine/zip/errors";

export interface CoordinatorWorkerHandle {
  terminate(): void;
  addEventListener?: (
    type: "error" | "messageerror",
    listener: (event: Event) => void,
  ) => void;
  removeEventListener?: (
    type: "error" | "messageerror",
    listener: (event: Event) => void,
  ) => void;
}

export type CoordinatorRemoteProxy = CoordinatorWorkerApi & {
  [Comlink.releaseProxy]?: () => void;
};

export interface CoordinatorSessionHandle {
  readonly api: CoordinatorWorkerApi;
  readonly dispose: () => void;
}

export interface CreateCoordinatorSessionDeps {
  readonly createWorker?: () => CoordinatorWorkerHandle;
  readonly wrapWorker?: (
    worker: CoordinatorWorkerHandle,
  ) => CoordinatorRemoteProxy;
  readonly registerErrorHandler?: () => void;
}

const WORKER_CRASH_MESSAGE = "Coordinator Workerが異常終了しました";

function defaultCreateWorker(): Worker {
  return new Worker(
    new URL("../engine/workers/coordinator.worker.ts", import.meta.url),
    { type: "module" },
  );
}

function defaultWrapWorker(
  worker: CoordinatorWorkerHandle,
): CoordinatorRemoteProxy {
  return Comlink.wrap<CoordinatorWorkerApi>(
    worker as unknown as Comlink.Endpoint,
  );
}

function wrapCoordinatorWorker(
  worker: CoordinatorWorkerHandle,
  wrapWorker: (worker: CoordinatorWorkerHandle) => CoordinatorRemoteProxy,
): CoordinatorRemoteProxy {
  try {
    return wrapWorker(worker);
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

function formatWorkerFailureDetail(event: Event): string {
  const candidate = event as unknown as {
    readonly message?: unknown;
    readonly filename?: unknown;
    readonly lineno?: unknown;
    readonly colno?: unknown;
  };
  const eventType = event.type.length > 0 ? event.type : "error";
  const parts = [`type=${eventType}`];

  if (typeof candidate.message === "string" && candidate.message.length > 0) {
    parts.push(`message=${candidate.message}`);
  }
  if (typeof candidate.filename === "string" && candidate.filename.length > 0) {
    const lineno = typeof candidate.lineno === "number" ? candidate.lineno : 0;
    const colno = typeof candidate.colno === "number" ? candidate.colno : 0;
    parts.push(`location=${candidate.filename}:${lineno}:${colno}`);
  }

  return parts.join(", ");
}

export function createCoordinatorSession(
  deps: CreateCoordinatorSessionDeps = {},
): CoordinatorSessionHandle {
  const registerErrorHandler =
    deps.registerErrorHandler ?? registerZipArchiveErrorTransferHandler;
  registerErrorHandler();

  const worker = (deps.createWorker ?? defaultCreateWorker)();
  let disposed = false;
  let fatalError: ZipArchiveError | null = null;
  const pendingRejects = new Set<(error: ZipArchiveError) => void>();

  const cleanupListeners = () => {
    worker.removeEventListener?.("error", handleWorkerFailure);
    worker.removeEventListener?.("messageerror", handleWorkerFailure);
  };

  const handleWorkerFailure = (event: Event) => {
    if (disposed || fatalError !== null) {
      return;
    }
    cleanupListeners();
    const error = new ZipArchiveError("READ_ERROR", WORKER_CRASH_MESSAGE);
    fatalError = error;
    diagnosticLogger.error(
      "engine",
      WORKER_CRASH_MESSAGE,
      formatWorkerFailureDetail(event),
    );
    for (const rejectPending of [...pendingRejects]) {
      rejectPending(error);
    }
    pendingRejects.clear();
  };

  worker.addEventListener?.("error", handleWorkerFailure);
  worker.addEventListener?.("messageerror", handleWorkerFailure);

  let rawApi: CoordinatorRemoteProxy;
  try {
    rawApi = wrapCoordinatorWorker(
      worker,
      deps.wrapWorker ?? defaultWrapWorker,
    );
  } catch (error) {
    cleanupListeners();
    throw error;
  }

  const trackAsyncRpc = <T>(invoke: () => Promise<T>): Promise<T> => {
    if (disposed) {
      return invoke();
    }
    if (fatalError !== null) {
      return Promise.reject(fatalError);
    }
    return new Promise<T>((resolve, reject) => {
      const rejectWithFatal = (error: ZipArchiveError) => {
        pendingRejects.delete(rejectWithFatal);
        reject(error);
      };
      pendingRejects.add(rejectWithFatal);

      let rpcPromise: Promise<T>;
      try {
        rpcPromise = invoke();
      } catch (syncError) {
        pendingRejects.delete(rejectWithFatal);
        reject(syncError);
        return;
      }

      rpcPromise.then(
        (value) => {
          pendingRejects.delete(rejectWithFatal);
          resolve(value);
        },
        (error) => {
          pendingRejects.delete(rejectWithFatal);
          reject(error);
        },
      );
    });
  };

  const api: CoordinatorWorkerApi =
    typeof worker.addEventListener === "function"
      ? {
          openArchive: (source, cachedEntries, epoch) =>
            trackAsyncRpc(() =>
              rawApi.openArchive(source, cachedEntries, epoch),
            ),
          requestVisiblePages: (pageIndices, prefetchIndices, epoch, options) =>
            trackAsyncRpc(() =>
              rawApi.requestVisiblePages(
                pageIndices,
                prefetchIndices,
                epoch,
                options,
              ),
            ),
          updateAccessToken: (accessToken) => {
            if (fatalError !== null && !disposed) {
              return;
            }
            rawApi.updateAccessToken(accessToken);
          },
          cancelEpochBelow: (minActiveEpoch) => {
            if (fatalError !== null && !disposed) {
              return;
            }
            rawApi.cancelEpochBelow(minActiveEpoch);
          },
          closeArchive: () => trackAsyncRpc(() => rawApi.closeArchive()),
        }
      : rawApi;

  return {
    api,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      cleanupListeners();
      pendingRejects.clear();
      try {
        rawApi[Comlink.releaseProxy]?.();
      } finally {
        worker.terminate();
      }
    },
  };
}
