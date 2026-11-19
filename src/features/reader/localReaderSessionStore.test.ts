import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useLocalReaderSessionStore } from "./localReaderSessionStore";

describe("localReaderSessionStore", () => {
  beforeEach(() => {
    useLocalReaderSessionStore.setState({ session: null });
  });

  it("初期状態ではsessionがnullであること", () => {
    expect(useLocalReaderSessionStore.getState().session).toBeNull();
  });

  it("openLocalFileでFile・fileName・fileSizeがオンメモリセッションに保存され、再呼出で上書きされること (AC-BS-04)", () => {
    const firstFile = new File(["first-content"], "comic-01.zip", {
      type: "application/zip",
    });
    const secondFile = new File(["second-longer-content"], "comic-02.cbz", {
      type: "application/x-cbz",
    });

    const { result } = renderHook(() => useLocalReaderSessionStore());
    expect(result.current.session).toBeNull();

    act(() => {
      result.current.openLocalFile(firstFile);
    });

    expect(result.current.session).toEqual({
      file: firstFile,
      fileName: "comic-01.zip",
      fileSize: firstFile.size,
    });

    act(() => {
      result.current.openLocalFile(secondFile);
    });

    expect(result.current.session).toEqual({
      file: secondFile,
      fileName: "comic-02.cbz",
      fileSize: secondFile.size,
    });
  });

  it("clearSessionでsessionがnullへリセットされること (TR-08)", () => {
    const file = new File(["zip"], "sample.zip", { type: "application/zip" });
    useLocalReaderSessionStore.getState().openLocalFile(file);
    expect(useLocalReaderSessionStore.getState().session).not.toBeNull();

    useLocalReaderSessionStore.getState().clearSession();
    expect(useLocalReaderSessionStore.getState().session).toBeNull();

    useLocalReaderSessionStore.getState().clearSession();
    expect(useLocalReaderSessionStore.getState().session).toBeNull();
  });
});
