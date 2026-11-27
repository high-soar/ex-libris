import * as Comlink from "comlink";
import type { DiagnosticLogger } from "../diagnostics/types";
import type { CoverResizeWorkerApi } from "../engine/cover/types";

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

export function createCoverWorkerClient(
  _deps: CreateCoverWorkerClientDeps = {},
): CoverWorkerClientHandle {
  void _deps;
  throw new Error("Not implemented");
}
