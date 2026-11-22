import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHADER_CORRECTION_PARAMS,
  SHADER_PARAM_RANGES,
  areShaderParamsEqual,
  formatShaderParamsAttribute,
  isDefaultShaderParams,
  normalizeShaderCorrectionParams,
} from "./shaderParams";

describe("shaderParams", () => {
  it("初期ニュートラル値とパラメータ許容範囲が仕様と一致すること (AC-GL-09)", () => {
    expect(DEFAULT_SHADER_CORRECTION_PARAMS).toEqual({
      sharpness: 0,
      whitePoint: 1,
      blackPoint: 0,
      gamma: 1,
    });

    expect(SHADER_PARAM_RANGES).toEqual({
      sharpness: { min: 0.0, max: 1.0, step: 0.05 },
      whitePoint: { min: 0.8, max: 1.0, step: 0.01 },
      blackPoint: { min: 0.0, max: 0.25, step: 0.01 },
      gamma: { min: 0.6, max: 1.6, step: 0.05 },
    });
  });

  it("normalizeShaderCorrectionParamsが非プレーンオブジェクト入力時に初期値コピーを返すこと (AC-GL-09)", () => {
    const inputs: unknown[] = [
      null,
      undefined,
      "invalid",
      42,
      true,
      [0.5, 0.9, 0.1, 1.2],
    ];

    for (const input of inputs) {
      const normalized = normalizeShaderCorrectionParams(input);
      expect(normalized).toEqual(DEFAULT_SHADER_CORRECTION_PARAMS);
      expect(normalized).not.toBe(DEFAULT_SHADER_CORRECTION_PARAMS);
    }
  });

  it("normalizeShaderCorrectionParamsが範囲クランプ・小数第2位丸め・-0回避・項目別フォールバックを行うこと (AC-GL-09)", () => {
    expect(
      normalizeShaderCorrectionParams({
        sharpness: 0.336,
        whitePoint: 0.874,
        blackPoint: 0.125,
        gamma: 1.234,
      }),
    ).toEqual({
      sharpness: 0.34,
      whitePoint: 0.87,
      blackPoint: 0.13,
      gamma: 1.23,
    });

    // 下限・上限クランプ
    expect(
      normalizeShaderCorrectionParams({
        sharpness: -0.5,
        whitePoint: 0.5,
        blackPoint: -0.1,
        gamma: 0.1,
      }),
    ).toEqual({
      sharpness: 0,
      whitePoint: 0.8,
      blackPoint: 0,
      gamma: 0.6,
    });

    expect(
      normalizeShaderCorrectionParams({
        sharpness: 1.5,
        whitePoint: 1.2,
        blackPoint: 0.9,
        gamma: 2.5,
      }),
    ).toEqual({
      sharpness: 1,
      whitePoint: 1,
      blackPoint: 0.25,
      gamma: 1.6,
    });

    // -0 を +0 へ正規化すること
    const negativeZeroResult = normalizeShaderCorrectionParams({
      sharpness: -0,
      whitePoint: 1,
      blackPoint: -0.001,
      gamma: 1,
    });
    expect(Object.is(negativeZeroResult.sharpness, 0)).toBe(true);
    expect(Object.is(negativeZeroResult.blackPoint, 0)).toBe(true);

    // 欠落・非数値・非有限値のみ個別に初期値へフォールバックすること
    expect(
      normalizeShaderCorrectionParams({
        sharpness: Number.NaN,
        whitePoint: Number.POSITIVE_INFINITY,
        blackPoint: "0.1",
        gamma: 0.85,
      }),
    ).toEqual({
      sharpness: 0,
      whitePoint: 1,
      blackPoint: 0,
      gamma: 0.85,
    });

    expect(
      normalizeShaderCorrectionParams({
        sharpness: 0.4,
      }),
    ).toEqual({
      sharpness: 0.4,
      whitePoint: 1,
      blackPoint: 0,
      gamma: 1,
    });
  });

  it("normalizeShaderCorrectionParamsがプロトタイプ継承プロパティを参照しないこと (AC-GL-09)", () => {
    const inherited = Object.create({
      sharpness: 0.7,
      whitePoint: 0.85,
      blackPoint: 0.15,
      gamma: 0.8,
    }) as Record<string, unknown>;
    expect(normalizeShaderCorrectionParams(inherited)).toEqual(
      DEFAULT_SHADER_CORRECTION_PARAMS,
    );

    const parsedProto = JSON.parse(
      '{"__proto__":{"sharpness":0.8},"gamma":1.15}',
    ) as unknown;
    expect(normalizeShaderCorrectionParams(parsedProto)).toEqual({
      sharpness: 0,
      whitePoint: 1,
      blackPoint: 0,
      gamma: 1.15,
    });
  });

  it("isDefaultShaderParamsが正規化基準で各パラメータの初期値一致を判定すること (AC-GL-09)", () => {
    expect(isDefaultShaderParams(DEFAULT_SHADER_CORRECTION_PARAMS)).toBe(true);
    expect(
      isDefaultShaderParams({
        sharpness: -0.001,
        whitePoint: 1.2,
        blackPoint: -0,
        gamma: 1.001,
      }),
    ).toBe(true);

    expect(
      isDefaultShaderParams({
        ...DEFAULT_SHADER_CORRECTION_PARAMS,
        sharpness: 0.05,
      }),
    ).toBe(false);
    expect(
      isDefaultShaderParams({
        ...DEFAULT_SHADER_CORRECTION_PARAMS,
        whitePoint: 0.99,
      }),
    ).toBe(false);
    expect(
      isDefaultShaderParams({
        ...DEFAULT_SHADER_CORRECTION_PARAMS,
        blackPoint: 0.01,
      }),
    ).toBe(false);
    expect(
      isDefaultShaderParams({
        ...DEFAULT_SHADER_CORRECTION_PARAMS,
        gamma: 1.05,
      }),
    ).toBe(false);
  });

  it("formatShaderParamsAttributeが正規化済みの小数第2位カンマ区切り文字列を返すこと (AC-GL-09)", () => {
    expect(formatShaderParamsAttribute(DEFAULT_SHADER_CORRECTION_PARAMS)).toBe(
      "0.00,1.00,0.00,1.00",
    );
    expect(
      formatShaderParamsAttribute({
        sharpness: 0.3,
        whitePoint: 1.5,
        blackPoint: 0.055,
        gamma: 0.8,
      }),
    ).toBe("0.30,1.00,0.06,0.80");
  });

  it("areShaderParamsEqualが4パラメータの等価性を厳密判定すること (AC-GL-09)", () => {
    const base = {
      sharpness: 0.2,
      whitePoint: 0.95,
      blackPoint: 0.05,
      gamma: 1.1,
    };
    expect(areShaderParamsEqual(base, { ...base })).toBe(true);
    expect(areShaderParamsEqual(base, { ...base, sharpness: 0.3 })).toBe(false);
    expect(areShaderParamsEqual(base, { ...base, whitePoint: 0.9 })).toBe(
      false,
    );
    expect(areShaderParamsEqual(base, { ...base, blackPoint: 0.1 })).toBe(
      false,
    );
    expect(areShaderParamsEqual(base, { ...base, gamma: 1.2 })).toBe(false);
  });
});
