import * as Comlink from "comlink";
import type { CoordinatorWorkerApi } from "../engine/types";
import { registerZipArchiveErrorTransferHandler } from "../engine/workers/comlinkErrorHandler";

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

export function createCoordinatorSession(
  deps: CreateCoordinatorSessionDeps = {},
): CoordinatorSessionHandle {
  const registerErrorHandler =
    deps.registerErrorHandler ?? registerZipArchiveErrorTransferHandler;
  registerErrorHandler();

  const worker = (deps.createWorker ?? defaultCreateWorker)();
  const api = wrapCoordinatorWorker(
    worker,
    deps.wrapWorker ?? defaultWrapWorker,
  );
  let disposed = false;

  return {
    api,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      try {
        api[Comlink.releaseProxy]?.();
      } finally {
        worker.terminate();
      }
    },
  };
}
