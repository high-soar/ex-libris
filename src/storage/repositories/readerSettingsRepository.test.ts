import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SHADER_CORRECTION_PARAMS } from "../../webgl/shaderParams";
import { db, resetTestDb } from "../db";
import {
  DEFAULT_READER_SETTINGS_META_KEY,
  DexieReaderSettingsRepository,
} from "./readerSettingsRepository";

describe("DexieReaderSettingsRepository", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(async () => {
    await resetTestDb();
  });

  it("未保存時は初期デフォルト値を返し、saveShaderDefaultsで正規化保存・再取得できること (AC-RD-13)", async () => {
    expect(DEFAULT_READER_SETTINGS_META_KEY).toBe("defaultReaderSettingsJson");
    const repo = new DexieReaderSettingsRepository();

    const initial = await repo.getShaderDefaults();
    expect(initial).toEqual(DEFAULT_SHADER_CORRECTION_PARAMS);
    expect(initial).not.toBe(DEFAULT_SHADER_CORRECTION_PARAMS);

    const saved = await repo.saveShaderDefaults({
      sharpness: 0.454,
      whitePoint: 1.2,
      blackPoint: -0.1,
      gamma: 0.85,
    });
    expect(saved).toEqual({
      sharpness: 0.45,
      whitePoint: 1,
      blackPoint: 0,
      gamma: 0.85,
    });

    const rawRecord = await db.syncMeta.get(DEFAULT_READER_SETTINGS_META_KEY);
    expect(rawRecord).toEqual({
      key: DEFAULT_READER_SETTINGS_META_KEY,
      value: JSON.stringify({
        version: 1,
        shader: {
          sharpness: 0.45,
          whitePoint: 1,
          blackPoint: 0,
          gamma: 0.85,
        },
      }),
    });

    expect(await repo.getShaderDefaults()).toEqual({
      sharpness: 0.45,
      whitePoint: 1,
      blackPoint: 0,
      gamma: 0.85,
    });
  });

  it("部分欠落・ルート直下配置・プロトタイプ汚染JSONを安全に正規化して返すこと (AC-RD-13)", async () => {
    const repo = new DexieReaderSettingsRepository(db);

    await db.syncMeta.put({
      key: DEFAULT_READER_SETTINGS_META_KEY,
      value: JSON.stringify({
        version: 1,
        shader: { sharpness: 0.3, gamma: "invalid", whitePoint: 0.7 },
      }),
    });
    expect(await repo.getShaderDefaults()).toEqual({
      sharpness: 0.3,
      whitePoint: 0.8,
      blackPoint: 0,
      gamma: 1,
    });
    expect(
      await db.syncMeta.get(DEFAULT_READER_SETTINGS_META_KEY),
    ).toBeDefined();

    // 自前 shader が無ければルートを正規化すること（__proto__ 上の shader は無視）
    await db.syncMeta.put({
      key: DEFAULT_READER_SETTINGS_META_KEY,
      value:
        '{"__proto__":{"shader":{"sharpness":0.9}},"whitePoint":0.92,"blackPoint":0.08}',
    });
    expect(await repo.getShaderDefaults()).toEqual({
      sharpness: 0,
      whitePoint: 0.92,
      blackPoint: 0.08,
      gamma: 1,
    });
  });

  it("JSON構文エラー・非プレーンルート・非プレーン自前shader検知時はレコードを削除し初期値へフォールバックすること (AC-RD-13)", async () => {
    const repo = new DexieReaderSettingsRepository(db);

    const corruptedPayloads = [
      "{not-valid-json",
      "null",
      "123",
      '"plain-string"',
      "true",
      "[1, 2, 3]",
      JSON.stringify({ version: 1, shader: null }),
      JSON.stringify({ version: 1, shader: [] }),
      JSON.stringify({ version: 1, shader: "bad" }),
      JSON.stringify({ version: 1, shader: 42 }),
    ];

    for (const payload of corruptedPayloads) {
      await db.syncMeta.put({
        key: DEFAULT_READER_SETTINGS_META_KEY,
        value: payload,
      });

      const resolved = await repo.getShaderDefaults();
      expect(resolved).toEqual(DEFAULT_SHADER_CORRECTION_PARAMS);
      expect(
        await db.syncMeta.get(DEFAULT_READER_SETTINGS_META_KEY),
      ).toBeUndefined();
    }
  });
});
