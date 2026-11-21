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

  it("capacitor.config.ts が Android 15/16 Edge-to-Edge マージン調整と黒背景色を設定していること", () => {
    expect(capacitorConfig.backgroundColor).toBe("#000000");
    expect(capacitorConfig.android?.backgroundColor).toBe("#000000");
    expect(capacitorConfig.android?.adjustMarginsForEdgeToEdge).toBe("auto");
  });

  it("MainActivity.java が黒ウィンドウ背景色と暗色背景向け白システムバーアイコンを設定していること", () => {
    const mainActivityPath = path.resolve(
      repoRoot,
      "android/app/src/main/java/com/highsoar/exlibris/MainActivity.java",
    );
    expect(fs.existsSync(mainActivityPath)).toBe(true);
    const mainActivity = fs.readFileSync(mainActivityPath, "utf8");

    expect(mainActivity).toContain("Color.BLACK");
    expect(mainActivity).toContain("WindowCompat.getInsetsController");
    expect(mainActivity).toContain("WindowInsetsControllerCompat");
    expect(mainActivity).toContain("setAppearanceLightStatusBars(false)");
    expect(mainActivity).toContain("setAppearanceLightNavigationBars(false)");
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

  it("android/app/build.gradle が applicationId を固定し versionName を BUILD_NAME / -PversionName / package.json 順で解決すること (AC-APK-01, AC-APK-02)", () => {
    const gradle = fs.readFileSync(
      path.resolve(repoRoot, "android/app/build.gradle"),
      "utf8",
    );

    expect(gradle).toContain('applicationId "com.highsoar.exlibris"');
    expect(gradle).toContain('System.getenv("BUILD_NAME")');
    expect(gradle).toContain('project.findProperty("versionName")');
    expect(gradle).toContain("packageJson.version");
    expect(gradle).toContain("versionName appVersionName");
  });

  it("android/app/build.gradle が versionCode を整数パースし NumberFormatException および [1, 2100000000] 範囲外時に GradleException で停止すること (AC-APK-02)", () => {
    const gradle = fs.readFileSync(
      path.resolve(repoRoot, "android/app/build.gradle"),
      "utf8",
    );

    expect(gradle).toContain('System.getenv("BUILD_NUMBER")');
    expect(gradle).toContain('project.findProperty("versionCode")');
    expect(gradle).toContain("Integer.parseInt");
    expect(gradle).toContain("NumberFormatException");
    expect(gradle).toMatch(/appVersionCode\s*<\s*1/);
    expect(gradle).toMatch(/appVersionCode\s*>\s*2_?100_?000_?000/);
    expect(gradle).toContain("GradleException");
  });

  it("android/app/build.gradle が 4 署名環境変数の一部欠落時に暗黙フォールバックせず GradleException で停止すること (AC-APK-01)", () => {
    const gradle = fs.readFileSync(
      path.resolve(repoRoot, "android/app/build.gradle"),
      "utf8",
    );

    const requiredEnvVars = [
      "ANDROID_KEYSTORE_BASE64",
      "ANDROID_KEYSTORE_PASSWORD",
      "ANDROID_KEY_ALIAS",
      "ANDROID_KEY_PASSWORD",
    ];
    for (const envVar of requiredEnvVars) {
      expect(gradle).toContain(envVar);
    }

    expect(gradle).toContain(".trim()");
    expect(gradle).toContain("GradleException");
    expect(gradle).not.toMatch(
      /System\.getenv\("ANDROID_KEYSTORE_PASSWORD"\)[^\n]*'android'/,
    );
    expect(gradle).not.toMatch(
      /System\.getenv\("ANDROID_KEY_ALIAS"\)[^\n]*'androiddebugkey'/,
    );
    expect(gradle).not.toMatch(
      /System\.getenv\("ANDROID_KEY_PASSWORD"\)[^\n]*resolvedStorePassword/,
    );
  });

  it("android/app/build.gradle が ANDROID_KEYSTORE_BASE64 の空白・改行除去後に Base64.getDecoder().decode で厳密デコードし不正/0バイト時に GradleException で停止すること (AC-APK-01)", () => {
    const gradle = fs.readFileSync(
      path.resolve(repoRoot, "android/app/build.gradle"),
      "utf8",
    );

    expect(gradle).toContain("import java.util.Base64");
    expect(gradle).toMatch(/replaceAll\([^)]*\\s\+[^)]*\)/);
    expect(gradle).toContain("Base64.getDecoder().decode");
    expect(gradle).not.toContain(".decodeBase64()");
    expect(gradle).toContain("IllegalArgumentException");
    expect(gradle).toMatch(/\.length\s*==\s*0/);
  });

  it("android/app/build.gradle が hasEnvKeystore とローカル ../debug.keystore を厳格分離し release へのデバッグ鍵フォールバックを禁止すること (AC-APK-01)", () => {
    const gradle = fs.readFileSync(
      path.resolve(repoRoot, "android/app/build.gradle"),
      "utf8",
    );

    expect(gradle).toContain("hasEnvKeystore");
    expect(gradle).toContain("hasLocalDebugKeystore");
    expect(gradle).not.toContain("hasCustomKeystore");
    expect(gradle).toContain("file('../debug.keystore')");
    expect(gradle).toMatch(
      /signingConfig\s+hasEnvKeystore\s*\?\s*signingConfigs\.getByName\("release"\)\s*:\s*null/,
    );
    expect(gradle).not.toMatch(
      /release\s*\{[^}]*?signingConfigs\.getByName\("debug"\)/,
    );
    expect(gradle).not.toMatch(/release\s*\{[^}]*?defaultDebugKeystore/);
  });

  it("android/app/build.gradle が gradle.taskGraph.whenReady で REQUIRE_FIXED_SIGNING=true および Release 系タスク（ReleaseBundle 等含む）の無署名ビルドを GradleException で停止すること (AC-APK-01, AC-APK-03)", () => {
    const gradle = fs.readFileSync(
      path.resolve(repoRoot, "android/app/build.gradle"),
      "utf8",
    );

    expect(gradle).toContain("gradle.taskGraph.whenReady");
    expect(gradle).toContain('System.getenv("REQUIRE_FIXED_SIGNING")');
    expect(gradle).toContain(
      "^(assemble|bundle|package|sign).*Release(Bundle|Apks|UniversalApk)?$",
    );
    expect(gradle).toContain("!hasEnvKeystore");
  });

  it("android/app/build.gradle が Configuration Phase で ci-signing.keystore を書き出さず Execution Phase タスク (prepareCiSigningKeystore, mustRunAfter clean) に遅延して clean 併用ビルドを保証すること (AC-APK-01)", () => {
    const gradle = fs.readFileSync(
      path.resolve(repoRoot, "android/app/build.gradle"),
      "utf8",
    );

    const configBlock = gradle.slice(0, gradle.indexOf("android {"));
    expect(configBlock).not.toContain("ciKeystoreFile.bytes");
    expect(gradle).toContain('tasks.register("prepareCiSigningKeystore")');
    expect(gradle).toContain("mustRunAfter");
    expect(gradle).toContain("doLast");
    expect(gradle).toContain("validateSigning");
    expect(gradle).toContain("prepareSigningKeystoreTask");
  });

  it("build-android.yml が concurrency (cancel-in-progress: false) を設定し並列実行による versionCode 逆転を防ぐこと (AC-APK-02)", () => {
    const content = fs.readFileSync(
      path.resolve(repoRoot, ".github/workflows/build-android.yml"),
      "utf8",
    );

    expect(content).toContain("concurrency:");
    expect(content).toContain(
      "group: ${{ github.workflow }}-${{ github.ref }}",
    );
    expect(content).toContain("cancel-in-progress: false");
  });

  it("build-android.yml と release.yml がビルド前に 4 Secrets 非空および ANDROID_KEYSTORE_BASE64 有効 Base64 を検証し不備時 exit 1 で停止すること (AC-APK-03)", () => {
    for (const file of ["build-android.yml", "release.yml"]) {
      const content = fs.readFileSync(
        path.resolve(repoRoot, ".github/workflows", file),
        "utf8",
      );

      expect(content).toContain("secrets.ANDROID_KEYSTORE_BASE64");
      expect(content).toContain("secrets.ANDROID_KEYSTORE_PASSWORD");
      expect(content).toContain("secrets.ANDROID_KEY_ALIAS");
      expect(content).toContain("secrets.ANDROID_KEY_PASSWORD");
      expect(content).toMatch(/Validate.*[Ss]igning.*[Ss]ecrets/);
      expect(content).toMatch(/process\.exit\(1\)|exit 1/);

      const validateIdx = content.search(/Validate.*[Ss]igning.*[Ss]ecrets/);
      const buildIdx = content.search(/Build (Web Assets|Android Debug APK)/);
      expect(validateIdx).toBeGreaterThan(-1);
      expect(buildIdx).toBeGreaterThan(validateIdx);
    }

    const releaseContent = fs.readFileSync(
      path.resolve(repoRoot, ".github/workflows/release.yml"),
      "utf8",
    );
    expect(releaseContent).toMatch(
      /Validate.*[Ss]igning.*[Ss]ecrets[\s\S]*?if:\s*steps\.check_existing\.outputs\.exists\s*==\s*'false'/,
    );
  });

  it("build-android.yml と release.yml が github.run_number を BUILD_NUMBER に使わず共通式 Math.floor(Date.now() / 1000) - 1_700_000_000 と [1, 2_100_000_000] 検証で計算すること (AC-APK-02)", () => {
    for (const file of ["build-android.yml", "release.yml"]) {
      const content = fs.readFileSync(
        path.resolve(repoRoot, ".github/workflows", file),
        "utf8",
      );

      expect(content).not.toContain("github.run_number");
      expect(content).toContain(
        "Math.floor(Date.now() / 1000) - 1_700_000_000",
      );
      expect(content).toContain("2_100_000_000");
      expect(content).toMatch(/version_code=/);
      expect(content).toMatch(
        /BUILD_NUMBER:\s*\$\{\{\s*steps\.[a-zA-Z0-9_-]+\.outputs\.version_code\s*\}\}/,
      );
    }
  });

  it('build-android.yml と release.yml が Gradle 実行ステップへ REQUIRE_FIXED_SIGNING: "true" を注入すること (AC-APK-03)', () => {
    const buildAndroid = fs.readFileSync(
      path.resolve(repoRoot, ".github/workflows/build-android.yml"),
      "utf8",
    );
    const matchesInBuild =
      buildAndroid.match(/REQUIRE_FIXED_SIGNING:\s*"true"/g) ?? [];
    expect(matchesInBuild.length).toBeGreaterThanOrEqual(2);

    const release = fs.readFileSync(
      path.resolve(repoRoot, ".github/workflows/release.yml"),
      "utf8",
    );
    expect(release).toMatch(/REQUIRE_FIXED_SIGNING:\s*"true"/);
  });

  it("build-android.yml と release.yml がビルド後に apksigner 優先・失敗非フォールバック・keytool 不在時フォールバック・大文字コロン区切り SHA-1/SHA-256 正規化・空抽出停止・GITHUB_STEP_SUMMARY 出力を行うこと (AC-APK-04)", () => {
    for (const file of ["build-android.yml", "release.yml"]) {
      const content = fs.readFileSync(
        path.resolve(repoRoot, ".github/workflows", file),
        "utf8",
      );

      expect(content).toContain("build-tools");
      expect(content).toContain("apksigner");
      expect(content).toContain("verify --print-certs");
      expect(content).toContain("keytool -printcert -jarfile");
      expect(content).toContain("GITHUB_STEP_SUMMARY");
      expect(content).toContain("com.highsoar.exlibris");
      expect(content).toContain("Fixed Keystore (GitHub Secrets)");
      expect(content).toContain("SHA-1");
      expect(content).toContain("SHA-256");
      expect(content).toMatch(/toUpperCase\(\)|tr 'a-f' 'A-F'/);

      // Step Summary ステップの env に secrets.* を渡さないこと
      const summaryIdx = content.search(
        /Verify APK Signature.*Step Summary|GITHUB_STEP_SUMMARY/,
      );
      expect(summaryIdx).toBeGreaterThan(-1);
      const afterSummary = content.slice(summaryIdx);
      expect(afterSummary).not.toContain("secrets.ANDROID_KEYSTORE");
    }
  });

  it("release.yml が main ブランチ保護・package.json トリガー・v0.0.0 スキップ・署名済み APK リリース作成契約を維持すること (AC-APK-05)", () => {
    const release = fs.readFileSync(
      path.resolve(repoRoot, ".github/workflows/release.yml"),
      "utf8",
    );

    expect(release).toContain("branches: [main]");
    expect(release).toContain('"package.json"');
    expect(release).toContain("workflow_dispatch:");
    expect(release).toContain("refs/heads/main");
    expect(release).toContain("v0.0.0");
    expect(release).toContain("gh release create");
  });

  it("ci.yml の android-compile ジョブが Secret 非依存で ./gradlew assembleDebug を維持しつつゼロコンフィグ異常系 Gradle ガード検証ステップを含むこと (AC-APK-03)", () => {
    const ci = fs.readFileSync(
      path.resolve(repoRoot, ".github/workflows/ci.yml"),
      "utf8",
    );

    expect(ci).not.toContain("secrets.");
    const androidCompileSection = ci.slice(ci.indexOf("android-compile:"));
    expect(androidCompileSection).toContain("./gradlew assembleDebug");
    expect(androidCompileSection).toContain("./gradlew help");
    expect(androidCompileSection).toContain("./gradlew assembleRelease");
    expect(androidCompileSection).toContain("./gradlew signReleaseBundle");
    expect(androidCompileSection).toContain("ci-signing.keystore");
    expect(androidCompileSection).toContain("ANDROID_KEYSTORE_BASE64");
    expect(androidCompileSection).toContain("BUILD_NUMBER=0");
    expect(androidCompileSection).toContain("BUILD_NUMBER=2100000001");
    expect(androidCompileSection).toContain("BUILD_NUMBER=abc");
    expect(androidCompileSection).toContain("REQUIRE_FIXED_SIGNING=true");
  });
});
