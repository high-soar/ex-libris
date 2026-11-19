import * as Comlink from "comlink";
import type { CoordinatorWorkerApi } from "../engine/types";

export interface CoordinatorWorkerHandle {
  terminate(): void;
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

export function createCoordinatorSession(
  _deps: CreateCoordinatorSessionDeps = {},
): CoordinatorSessionHandle {
  return {
    api: {} as CoordinatorWorkerApi,
    dispose: () => {},
  };
}
