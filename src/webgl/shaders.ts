export const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
uniform vec2 u_scale;
out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position * u_scale, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

export const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
in vec2 v_texCoord;
out vec4 outColor;

void main() {
  outColor = texture(u_texture, v_texCoord);
}
`;
