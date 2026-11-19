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
    expect(VERTEX_SHADER_SOURCE).toContain("out vec2 v_texCoord;");
    expect(VERTEX_SHADER_SOURCE).toContain("gl_Position");
  });

  it("WebGL2用の#version 300 esフラグメントシェーダーが高精度浮動小数とtextureサンプリングを含むこと", () => {
    expect(
      FRAGMENT_SHADER_SOURCE.trimStart().startsWith("#version 300 es"),
    ).toBe(true);
    expect(FRAGMENT_SHADER_SOURCE).toContain("precision highp float;");
    expect(FRAGMENT_SHADER_SOURCE).toContain("uniform sampler2D u_texture;");
    expect(FRAGMENT_SHADER_SOURCE).toContain("in vec2 v_texCoord;");
    expect(FRAGMENT_SHADER_SOURCE).toContain("out vec4 outColor;");
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      "outColor = texture(u_texture, v_texCoord);",
    );
  });
});
