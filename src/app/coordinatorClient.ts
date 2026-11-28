import * as Comlink from "comlink";
import type { GoogleAuthBridge } from "../bridges/oauth/types";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import type { DiagnosticLogger } from "../diagnostics/types";
import type {
  CoordinatorHostCallbacks,
  CoordinatorWorkerApi,
} from "../engine/types";
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
  readonly authBridge?: GoogleAuthBridge;
  readonly logger?: DiagnosticLogger;
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

function subscribeWorkerFailure(
  worker: CoordinatorWorkerHandle,
  onFailure: (event: Event) => void,
): () => void {
  worker.addEventListener?.("error", onFailure);
  worker.addEventListener?.("messageerror", onFailure);
  return () => {
    worker.removeEventListener?.("error", onFailure);
    worker.removeEventListener?.("messageerror", onFailure);
  };
}

function releaseAndTerminate(
  rawApi: CoordinatorRemoteProxy,
  worker: CoordinatorWorkerHandle,
): void {
  try {
    rawApi[Comlink.releaseProxy]?.();
  } finally {
    worker.terminate();
  }
}

function bindAuthCallbacks(
  api: CoordinatorWorkerApi,
  authBridge: GoogleAuthBridge,
  logger: DiagnosticLogger,
): () => void {
  const hostCallbacks: CoordinatorHostCallbacks = {
    refreshAccessToken: (options) => authBridge.getValidAccessToken(options),
    reportDiagnostic: (level, scope, message, detail) => {
      logger[level](scope, message, detail);
    },
  };
  api.setHostCallbacks(Comlink.proxy(hostCallbacks));
  const cachedSession = authBridge.getCachedSession();
  if (cachedSession !== null) {
    api.updateAccessToken(cachedSession.accessToken);
  }
  return authBridge.subscribeSession((session) => {
    api.updateAccessToken(session?.accessToken ?? null);
  });
}

function createDisposedError(): DOMException {
  return new DOMException(
    "Coordinator session has been disposed",
    "AbortError",
  );
}

function createGuardedCoordinatorApi(
  rawApi: CoordinatorRemoteProxy,
  state: {
    readonly isDisposed: () => boolean;
    readonly getFatalError: () => ZipArchiveError | null;
    readonly pendingRejects: Set<(error: unknown) => void>;
  },
): CoordinatorWorkerApi {
  const trackAsyncRpc = <T>(invoke: () => Promise<T>): Promise<T> => {
    if (state.isDisposed()) {
      return Promise.reject(createDisposedError());
    }
    const fatalError = state.getFatalError();
    if (fatalError !== null) {
      return Promise.reject(fatalError);
    }
    return new Promise<T>((resolve, reject) => {
      const rejectPending = (error: unknown) => {
        state.pendingRejects.delete(rejectPending);
        reject(error);
      };
      state.pendingRejects.add(rejectPending);

      let rpcPromise: Promise<T>;
      try {
        rpcPromise = invoke();
      } catch (syncError) {
        state.pendingRejects.delete(rejectPending);
        reject(syncError);
        return;
      }

      rpcPromise.then(
        (value) => {
          state.pendingRejects.delete(rejectPending);
          resolve(value);
        },
        (error) => {
          state.pendingRejects.delete(rejectPending);
          reject(error);
        },
      );
    });
  };

  const forwardSyncRpc = (invoke: () => void): void => {
    if (state.isDisposed() || state.getFatalError() !== null) {
      return;
    }
    invoke();
  };

  return {
    openArchive: (source, cachedEntries, epoch) =>
      trackAsyncRpc(() => rawApi.openArchive(source, cachedEntries, epoch)),
    requestVisiblePages: (pageIndices, prefetchIndices, epoch, options) =>
      trackAsyncRpc(() =>
        rawApi.requestVisiblePages(
          pageIndices,
          prefetchIndices,
          epoch,
          options,
        ),
      ),
    updateAccessToken: (accessToken) =>
      forwardSyncRpc(() => rawApi.updateAccessToken(accessToken)),
    setHostCallbacks: (callbacks) =>
      forwardSyncRpc(() => rawApi.setHostCallbacks(callbacks)),
    cancelEpochBelow: (minActiveEpoch) =>
      forwardSyncRpc(() => rawApi.cancelEpochBelow(minActiveEpoch)),
    closeArchive: () => trackAsyncRpc(() => rawApi.closeArchive()),
  };
}

export function createCoordinatorSession(
  deps: CreateCoordinatorSessionDeps = {},
): CoordinatorSessionHandle {
  const registerErrorHandler =
    deps.registerErrorHandler ?? registerZipArchiveErrorTransferHandler;
  registerErrorHandler();

  const logger = deps.logger ?? diagnosticLogger;
  const worker = (deps.createWorker ?? defaultCreateWorker)();
  let disposed = false;
  let fatalError: ZipArchiveError | null = null;
  const pendingRejects = new Set<(error: unknown) => void>();

  const cleanupListeners = subscribeWorkerFailure(worker, (event) => {
    if (disposed || fatalError !== null) {
      return;
    }
    cleanupListeners();
    const error = new ZipArchiveError("READ_ERROR", WORKER_CRASH_MESSAGE);
    fatalError = error;
    logger.error(
      "engine",
      WORKER_CRASH_MESSAGE,
      formatWorkerFailureDetail(event),
    );
    for (const rejectPending of [...pendingRejects]) {
      rejectPending(error);
    }
    pendingRejects.clear();
  });

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

  const api: CoordinatorWorkerApi =
    typeof worker.addEventListener === "function"
      ? createGuardedCoordinatorApi(rawApi, {
          isDisposed: () => disposed,
          getFatalError: () => fatalError,
          pendingRejects,
        })
      : rawApi;

  let unsubscribeAuthSession: (() => void) | undefined;
  if (deps.authBridge !== undefined) {
    try {
      unsubscribeAuthSession = bindAuthCallbacks(api, deps.authBridge, logger);
    } catch (error) {
      cleanupListeners();
      releaseAndTerminate(rawApi, worker);
      throw error;
    }
  }

  return {
    api,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      cleanupListeners();
      unsubscribeAuthSession?.();
      const disposedError = createDisposedError();
      for (const rejectPending of [...pendingRejects]) {
        rejectPending(disposedError);
      }
      pendingRejects.clear();
      releaseAndTerminate(rawApi, worker);
    },
  };
}
