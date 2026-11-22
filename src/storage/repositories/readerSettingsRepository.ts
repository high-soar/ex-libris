import {
  DEFAULT_SHADER_CORRECTION_PARAMS,
  normalizeShaderCorrectionParams,
} from "../../webgl/shaderParams";
import type { ShaderCorrectionParams } from "../../webgl/types";
import { ExLibrisDatabase, db } from "../db";

export const DEFAULT_READER_SETTINGS_META_KEY = "defaultReaderSettingsJson";

export interface ReaderSettingsRepository {
  getShaderDefaults(): Promise<ShaderCorrectionParams>;
  saveShaderDefaults(
    params: ShaderCorrectionParams,
  ): Promise<ShaderCorrectionParams>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class DexieReaderSettingsRepository implements ReaderSettingsRepository {
  private readonly database: ExLibrisDatabase;

  constructor(database: ExLibrisDatabase = db) {
    this.database = database;
  }

  async getShaderDefaults(): Promise<ShaderCorrectionParams> {
    const record = await this.database.syncMeta.get(
      DEFAULT_READER_SETTINGS_META_KEY,
    );
    if (!record) {
      return { ...DEFAULT_SHADER_CORRECTION_PARAMS };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(record.value);
    } catch {
      await this.database.syncMeta.delete(DEFAULT_READER_SETTINGS_META_KEY);
      return { ...DEFAULT_SHADER_CORRECTION_PARAMS };
    }

    if (!isPlainObject(parsed)) {
      await this.database.syncMeta.delete(DEFAULT_READER_SETTINGS_META_KEY);
      return { ...DEFAULT_SHADER_CORRECTION_PARAMS };
    }

    if (Object.prototype.hasOwnProperty.call(parsed, "shader")) {
      if (!isPlainObject(parsed.shader)) {
        await this.database.syncMeta.delete(DEFAULT_READER_SETTINGS_META_KEY);
        return { ...DEFAULT_SHADER_CORRECTION_PARAMS };
      }
      return normalizeShaderCorrectionParams(parsed.shader);
    }

    return normalizeShaderCorrectionParams(parsed);
  }

  async saveShaderDefaults(
    params: ShaderCorrectionParams,
  ): Promise<ShaderCorrectionParams> {
    const normalized = normalizeShaderCorrectionParams(params);
    await this.database.syncMeta.put({
      key: DEFAULT_READER_SETTINGS_META_KEY,
      value: JSON.stringify({
        version: 1,
        shader: normalized,
      }),
    });
    return normalized;
  }
}
