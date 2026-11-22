import type { ShaderCorrectionParams } from "./types";

export interface ShaderParamRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const DEFAULT_SHADER_CORRECTION_PARAMS: ShaderCorrectionParams = {
  sharpness: 0,
  whitePoint: 1,
  blackPoint: 0,
  gamma: 1,
};

export const SHADER_PARAM_RANGES: Readonly<
  Record<keyof ShaderCorrectionParams, ShaderParamRange>
> = {
  sharpness: { min: 0.0, max: 1.0, step: 0.05 },
  whitePoint: { min: 0.8, max: 1.0, step: 0.01 },
  blackPoint: { min: 0.0, max: 0.25, step: 0.01 },
  gamma: { min: 0.6, max: 1.6, step: 0.05 },
};

export function normalizeShaderCorrectionParams(
  _raw: unknown,
): ShaderCorrectionParams {
  return { ...DEFAULT_SHADER_CORRECTION_PARAMS };
}

export function isDefaultShaderParams(
  _params: ShaderCorrectionParams,
): boolean {
  return false;
}

export function formatShaderParamsAttribute(
  _params: ShaderCorrectionParams,
): string {
  return "";
}
