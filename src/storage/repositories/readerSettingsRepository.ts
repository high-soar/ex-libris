import { DEFAULT_SHADER_CORRECTION_PARAMS } from "../../webgl/shaderParams";
import type { ShaderCorrectionParams } from "../../webgl/types";
import { ExLibrisDatabase, db } from "../db";

export const DEFAULT_READER_SETTINGS_META_KEY = "defaultReaderSettingsJson";

export interface ReaderSettingsRepository {
  getShaderDefaults(): Promise<ShaderCorrectionParams>;
  saveShaderDefaults(
    params: ShaderCorrectionParams,
  ): Promise<ShaderCorrectionParams>;
}

export class DexieReaderSettingsRepository implements ReaderSettingsRepository {
  constructor(_database: ExLibrisDatabase = db) {}

  async getShaderDefaults(): Promise<ShaderCorrectionParams> {
    return { ...DEFAULT_SHADER_CORRECTION_PARAMS };
  }

  async saveShaderDefaults(
    params: ShaderCorrectionParams,
  ): Promise<ShaderCorrectionParams> {
    return { ...params };
  }
}
