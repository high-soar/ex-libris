import { describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import { APP_ID, APP_NAME, APP_VERSION } from "./app";

describe("app constants", () => {
  it("アプリケーション名・Capacitor App ID・package.json同期バージョンを公開すること", () => {
    expect(APP_NAME).toBe("ExLibris");
    expect(APP_ID).toBe("com.highsoar.exlibris");
    expect(APP_VERSION).toBe(packageJson.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
