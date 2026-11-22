import { describe, expect, it } from "vitest";
import { FRAGMENT_SHADER_SOURCE, VERTEX_SHADER_SOURCE } from "./shaders";

describe("shaders", () => {
  it("WebGL2用の#version 300 es頂点シェーダーが必須シンボルを含むこと", () => {
    expect(VERTEX_SHADER_SOURCE.trimStart().startsWith("#version 300 es")).toBe(
      true,
    );
    expect(VERTEX_SHADER_SOURCE).toContain("in vec2 a_position;");
    expect(VERTEX_SHADER_SOURCE).toContain("in vec2 a_texCoord;");
    expect(VERTEX_SHADER_SOURCE).toContain("uniform vec2 u_scale;");
    expect(VERTEX_SHADER_SOURCE).toContain("uniform vec2 u_offset;");
    expect(VERTEX_SHADER_SOURCE).toContain("out vec2 v_texCoord;");
    expect(VERTEX_SHADER_SOURCE).toContain(
      "gl_Position = vec4(a_position * u_scale + u_offset, 0.0, 1.0);",
    );
  });

  it("WebGL2用の#version 300 esフラグメントシェーダーが1パス画面微分5タップUSM・白黒レベル・標準ガンマ補正式を含むこと (AC-GL-09)", () => {
    expect(
      FRAGMENT_SHADER_SOURCE.trimStart().startsWith("#version 300 es"),
    ).toBe(true);
    expect(FRAGMENT_SHADER_SOURCE).toContain("precision highp float;");
    expect(FRAGMENT_SHADER_SOURCE).toContain("uniform sampler2D u_texture;");
    expect(FRAGMENT_SHADER_SOURCE).toContain("uniform float u_sharpness;");
    expect(FRAGMENT_SHADER_SOURCE).toContain("uniform float u_whitePoint;");
    expect(FRAGMENT_SHADER_SOURCE).toContain("uniform float u_blackPoint;");
    expect(FRAGMENT_SHADER_SOURCE).toContain("uniform float u_gamma;");
    expect(FRAGMENT_SHADER_SOURCE).toContain("in vec2 v_texCoord;");
    expect(FRAGMENT_SHADER_SOURCE).toContain("out vec4 outColor;");
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      "vec4 baseSample = texture(u_texture, v_texCoord);",
    );
    expect(FRAGMENT_SHADER_SOURCE).toContain("vec3 rgb = baseSample.rgb;");
    expect(FRAGMENT_SHADER_SOURCE).toContain("dFdx(v_texCoord.x)");
    expect(FRAGMENT_SHADER_SOURCE).toContain("dFdy(v_texCoord.y)");
    expect(FRAGMENT_SHADER_SOURCE).toContain("textureSize(u_texture, 0)");
    expect(FRAGMENT_SHADER_SOURCE).toContain("if (u_sharpness > 0.0)");
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      "rgb = clamp(rgb + u_sharpness * (4.0 * rgb - (n + s + w + e)), 0.0, 1.0);",
    );
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      "float levelRange = max(u_whitePoint - u_blackPoint, 0.0001);",
    );
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      "rgb = clamp((rgb - vec3(u_blackPoint)) / levelRange, 0.0, 1.0);",
    );
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      "rgb = pow(rgb, vec3(1.0 / max(u_gamma, 0.0001)));",
    );
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      "outColor = vec4(rgb, baseSample.a);",
    );
  });
});
