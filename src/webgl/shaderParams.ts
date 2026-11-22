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

function normalizeParamValue(
  raw: Record<string, unknown>,
  key: keyof ShaderCorrectionParams,
): number {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) {
    return DEFAULT_SHADER_CORRECTION_PARAMS[key];
  }
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SHADER_CORRECTION_PARAMS[key];
  }
  const { min, max } = SHADER_PARAM_RANGES[key];
  const clamped = Math.min(max, Math.max(min, value));
  const rounded = Math.round(clamped * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

export function normalizeShaderCorrectionParams(
  raw: unknown,
): ShaderCorrectionParams {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_SHADER_CORRECTION_PARAMS };
  }
  const candidate = raw as Record<string, unknown>;
  return {
    sharpness: normalizeParamValue(candidate, "sharpness"),
    whitePoint: normalizeParamValue(candidate, "whitePoint"),
    blackPoint: normalizeParamValue(candidate, "blackPoint"),
    gamma: normalizeParamValue(candidate, "gamma"),
  };
}

export function isDefaultShaderParams(params: ShaderCorrectionParams): boolean {
  const normalized = normalizeShaderCorrectionParams(params);
  return (
    normalized.sharpness === DEFAULT_SHADER_CORRECTION_PARAMS.sharpness &&
    normalized.whitePoint === DEFAULT_SHADER_CORRECTION_PARAMS.whitePoint &&
    normalized.blackPoint === DEFAULT_SHADER_CORRECTION_PARAMS.blackPoint &&
    normalized.gamma === DEFAULT_SHADER_CORRECTION_PARAMS.gamma
  );
}

export function formatShaderParamsAttribute(
  params: ShaderCorrectionParams,
): string {
  const normalized = normalizeShaderCorrectionParams(params);
  return `${normalized.sharpness.toFixed(2)},${normalized.whitePoint.toFixed(2)},${normalized.blackPoint.toFixed(2)},${normalized.gamma.toFixed(2)}`;
}
