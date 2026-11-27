import * as Comlink from "comlink";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import type { DiagnosticLogger } from "../diagnostics/types";
import type { CoverResizeWorkerApi } from "../engine/cover/types";
import { registerZipArchiveErrorTransferHandler } from "../engine/workers/comlinkErrorHandler";
import { prepareDecodeTransfer } from "../engine/workers/coordinatorTransfer";
import { ZipArchiveError } from "../engine/zip/errors";

export interface CoverWorkerHandle {
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

export type CoverWorkerRemoteProxy = CoverResizeWorkerApi & {
  [Comlink.releaseProxy]?: () => void;
};

export interface CoverWorkerClientHandle {
  readonly api: CoverResizeWorkerApi;
  readonly isBroken: () => boolean;
  readonly dispose: () => void;
}

export interface CreateCoverWorkerClientDeps {
  readonly createWorker?: () => CoverWorkerHandle;
  readonly wrapWorker?: (worker: CoverWorkerHandle) => CoverWorkerRemoteProxy;
  readonly registerErrorHandler?: () => void;
  readonly logger?: DiagnosticLogger;
}

const WORKER_CRASH_MESSAGE = "Cover Workerが異常終了しました";

function defaultCreateWorker(): Worker {
  return new Worker(
    new URL("../engine/cover/cover.worker.ts", import.meta.url),
    { type: "module" },
  );
}

function defaultWrapWorker(worker: CoverWorkerHandle): CoverWorkerRemoteProxy {
  return Comlink.wrap<CoverResizeWorkerApi>(
    worker as unknown as Comlink.Endpoint,
  );
}

function wrapCoverWorker(
  worker: CoverWorkerHandle,
  wrapWorker: (worker: CoverWorkerHandle) => CoverWorkerRemoteProxy,
): CoverWorkerRemoteProxy {
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
  worker: CoverWorkerHandle,
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
  rawApi: CoverWorkerRemoteProxy,
  worker: CoverWorkerHandle,
): void {
  try {
    rawApi[Comlink.releaseProxy]?.();
  } finally {
    worker.terminate();
  }
}

function createGuardedCoverApi(
  rawApi: CoverWorkerRemoteProxy,
  state: {
    readonly isDisposed: () => boolean;
    readonly getFatalError: () => ZipArchiveError | null;
    readonly pendingRejects: Set<(error: ZipArchiveError) => void>;
  },
): CoverResizeWorkerApi {
  return {
    encodeCoverWebp(compressedData, compressionMethod, options) {
      const prepared = prepareDecodeTransfer(compressedData);
      const invoke = () =>
        rawApi.encodeCoverWebp(
          Comlink.transfer(prepared.data, prepared.transferables),
          compressionMethod,
          options,
        );

      if (state.isDisposed()) {
        return invoke();
      }
      const fatalError = state.getFatalError();
      if (fatalError !== null) {
        return Promise.reject(fatalError);
      }

      return new Promise((resolve, reject) => {
        const rejectWithFatal = (error: ZipArchiveError) => {
          state.pendingRejects.delete(rejectWithFatal);
          reject(error);
        };
        state.pendingRejects.add(rejectWithFatal);

        let rpcPromise: ReturnType<CoverResizeWorkerApi["encodeCoverWebp"]>;
        try {
          rpcPromise = invoke();
        } catch (syncError) {
          state.pendingRejects.delete(rejectWithFatal);
          reject(syncError);
          return;
        }

        rpcPromise.then(
          (value) => {
            state.pendingRejects.delete(rejectWithFatal);
            resolve(value);
          },
          (error) => {
            state.pendingRejects.delete(rejectWithFatal);
            reject(error);
          },
        );
      });
    },
  };
}

export function createCoverWorkerClient(
  deps: CreateCoverWorkerClientDeps = {},
): CoverWorkerClientHandle {
  const registerErrorHandler =
    deps.registerErrorHandler ?? registerZipArchiveErrorTransferHandler;
  registerErrorHandler();

  const logger = deps.logger ?? diagnosticLogger;
  const worker = (deps.createWorker ?? defaultCreateWorker)();
  let disposed = false;
  let fatalError: ZipArchiveError | null = null;
  const pendingRejects = new Set<(error: ZipArchiveError) => void>();

  const cleanupListeners = subscribeWorkerFailure(worker, (event) => {
    if (disposed || fatalError !== null) {
      return;
    }
    cleanupListeners();
    const error = new ZipArchiveError("DECODE_FAILED", WORKER_CRASH_MESSAGE);
    fatalError = error;
    logger.error(
      "cover",
      WORKER_CRASH_MESSAGE,
      formatWorkerFailureDetail(event),
    );
    for (const rejectPending of [...pendingRejects]) {
      rejectPending(error);
    }
    pendingRejects.clear();
  });

  let rawApi: CoverWorkerRemoteProxy;
  try {
    rawApi = wrapCoverWorker(worker, deps.wrapWorker ?? defaultWrapWorker);
  } catch (error) {
    cleanupListeners();
    throw error;
  }

  const api = createGuardedCoverApi(rawApi, {
    isDisposed: () => disposed,
    getFatalError: () => fatalError,
    pendingRejects,
  });

  return {
    api,
    isBroken: () => fatalError !== null,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      cleanupListeners();
      pendingRejects.clear();
      releaseAndTerminate(rawApi, worker);
    },
  };
}
