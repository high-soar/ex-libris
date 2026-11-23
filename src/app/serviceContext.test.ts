import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MockAppBridge } from "../bridges/app/mockAppBridge";
import type { GoogleAuthBridge } from "../bridges/oauth/types";
import type { CoordinatorWorkerApi } from "../engine/types";
import type { DriveFolderClient } from "../providers/gdrive/types";
import type { DriveSyncRootsRepository } from "../storage/repositories/driveSyncRootsRepository";
import { DEFAULT_SHADER_CORRECTION_PARAMS } from "../webgl/shaderParams";
import {
  ServiceContext,
  type ServiceContextValue,
  useServices,
} from "./serviceContext";

describe("serviceContext", () => {
  it("ServiceProvider外でuseServicesを呼び出した場合はエラーを送出すること", () => {
    expect(() => renderHook(() => useServices())).toThrow(
      "useServices must be used within a ServiceProvider",
    );
  });

  it("ServiceContext.Provider配下ではサービスコンテキスト値を返却すること", () => {
    const googleAuthBridge: GoogleAuthBridge = {
      getCachedSession: vi.fn(() => null),
      getSession: vi.fn(async () => null),
      signIn: vi.fn(),
      signOut: vi.fn(async () => {}),
      getValidAccessToken: vi.fn(async () => "ya29.test"),
      subscribeSession: vi.fn(() => () => {}),
    };
    const driveSyncRootsRepo: DriveSyncRootsRepository = {
      listActive: vi.fn(async () => []),
      countEnabled: vi.fn(async () => 0),
      upsertRoot: vi.fn(),
      setEnabled: vi.fn(async () => null),
      removeRoot: vi.fn(async () => {}),
    };
    const driveFolderClient: DriveFolderClient = {
      resolveFolderById: vi.fn(),
      listChildFolders: vi.fn(async () => ({
        folders: [],
        nextPageToken: null,
      })),
    };

    const value: ServiceContextValue = {
      appBridge: new MockAppBridge(),
      createCoordinatorSession: () => ({
        api: {} as CoordinatorWorkerApi,
        dispose: vi.fn(),
      }),
      zipIndexCacheRepo: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
      },
      readingProgressRepo: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => {}),
        listRecentLocal: vi.fn(async () => []),
        delete: vi.fn(async () => {}),
        clearLocal: vi.fn(async () => {}),
      },
      readerSettingsRepo: {
        getShaderDefaults: vi.fn(async () => ({
          ...DEFAULT_SHADER_CORRECTION_PARAMS,
        })),
        saveShaderDefaults: vi.fn(async (params) => ({ ...params })),
      },
      googleAuthBridge,
      driveSyncRootsRepo,
      driveFolderClient,
    };

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ServiceContext.Provider, { value }, children);

    const { result } = renderHook(() => useServices(), { wrapper });
    expect(result.current).toBe(value);
  });
});
