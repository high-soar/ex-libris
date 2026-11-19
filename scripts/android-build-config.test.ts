import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import capacitorConfig from "../capacitor.config";

const repoRoot = process.cwd();

describe("Android build, Capacitor & Remote Agent governance invariants", () => {
  it("capacitor.config.ts が正しい appId と CapacitorHttp.enabled: false を保持していること", () => {
    expect(capacitorConfig.appId).toBe("com.highsoar.exlibris");
    expect(capacitorConfig.appName).toBe("ExLibris");
    expect(capacitorConfig.webDir).toBe("dist");
    expect(capacitorConfig.plugins?.CapacitorHttp?.enabled).toBe(false);
  });

  it(".agents/environment.json が sudo を使わず冪等な install コマンドを定義していること", () => {
    const envJsonPath = path.resolve(repoRoot, ".agents/environment.json");
    expect(fs.existsSync(envJsonPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(envJsonPath, "utf8")) as {
      install?: string;
    };
    expect(typeof parsed.install).toBe("string");
    expect(parsed.install).not.toMatch(/\bsudo\b/);
    expect(parsed.install).not.toMatch(/--with-deps/);
    expect(parsed.install).toContain("core.hooksPath .githooks");
    expect(parsed.install).toContain("npm ci");
    expect(parsed.install).toContain("npx playwright install chromium");
  });

  it("android/app/build.gradle が package.json バージョン連動と安全な署名フォールバックを備えていること", () => {
    const gradlePath = path.resolve(repoRoot, "android/app/build.gradle");
    expect(fs.existsSync(gradlePath)).toBe(true);
    const gradle = fs.readFileSync(gradlePath, "utf8");

    expect(gradle).toContain('applicationId "com.highsoar.exlibris"');
    expect(gradle).toContain("package.json");
    expect(gradle).toContain("ANDROID_KEYSTORE_BASE64");
    expect(gradle).toContain(
      "com.google.android.gms:play-services-auth:21.4.0",
    );
  });

  it("GitHub Actions ワークフローが run ブロック内への直接式展開を行わず node:24-bookworm パリティを維持していること", () => {
    const workflowFiles = ["ci.yml", "build-android.yml", "release.yml"];
    for (const file of workflowFiles) {
      const fullPath = path.resolve(repoRoot, ".github/workflows", file);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, "utf8");

      const lines = content.split("\n");
      let inRunBlock = false;
      let runIndent = 0;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const indent = line.search(/\S/);
        if (inRunBlock && indent <= runIndent) {
          inRunBlock = false;
        }

        if (/^\s*(?:-\s*)?run:\s*\|?\s*$/.test(line)) {
          inRunBlock = true;
          runIndent = indent;
          continue;
        }

        const inlineRunMatch = line.match(/^\s*(?:-\s*)?run:\s*(.+)$/);
        if (inlineRunMatch) {
          expect(
            inlineRunMatch[1],
            `${file} has inline expression inside run: ${line}`,
          ).not.toContain("${{");
          continue;
        }

        if (inRunBlock) {
          expect(
            line,
            `${file} has direct expression interpolation inside run block: ${line}`,
          ).not.toContain("${{");
        }
      }
    }

    const ciContent = fs.readFileSync(
      path.resolve(repoRoot, ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(ciContent).toContain("image: node:24-bookworm");
    expect(ciContent).toContain("quality-gate:");
  });
});
