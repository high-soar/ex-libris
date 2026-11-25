import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  RouterContext,
  type RouterContextValue,
  useRouter,
} from "./routerContext";

describe("routerContext", () => {
  it("RouterProvider外でuseRouterを呼び出した場合は明確なエラーを送出すること", () => {
    expect(() => renderHook(() => useRouter())).toThrow(
      "useRouter must be used within a RouterProvider",
    );
  });

  it("RouterContext.Provider配下ではコンテキスト値をそのまま返却すること", () => {
    const value: RouterContextValue = {
      currentPath: "/read/local",
      route: { name: "reader-local", path: "/read/local" },
      navigate: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      isBackBlocked: false,
      setBackBlocked: vi.fn(),
    };

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(RouterContext.Provider, { value }, children);

    const { result } = renderHook(() => useRouter(), { wrapper });
    expect(result.current).toBe(value);
  });
});
