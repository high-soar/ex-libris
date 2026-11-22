export const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
uniform vec2 u_scale;
uniform vec2 u_offset;
out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position * u_scale + u_offset, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

export const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform float u_sharpness;
uniform float u_whitePoint;
uniform float u_blackPoint;
uniform float u_gamma;
in vec2 v_texCoord;
out vec4 outColor;

void main() {
  vec4 baseSample = texture(u_texture, v_texCoord);
  vec3 rgb = baseSample.rgb;
  vec2 derivStep = max(vec2(abs(dFdx(v_texCoord.x)), abs(dFdy(v_texCoord.y))), 1.0 / vec2(textureSize(u_texture, 0)));
  if (u_sharpness > 0.0) {
    vec3 n = texture(u_texture, v_texCoord + vec2(0.0, -derivStep.y)).rgb;
    vec3 s = texture(u_texture, v_texCoord + vec2(0.0, derivStep.y)).rgb;
    vec3 w = texture(u_texture, v_texCoord + vec2(-derivStep.x, 0.0)).rgb;
    vec3 e = texture(u_texture, v_texCoord + vec2(derivStep.x, 0.0)).rgb;
    rgb = clamp(rgb + u_sharpness * (4.0 * rgb - (n + s + w + e)), 0.0, 1.0);
  }
  float levelRange = max(u_whitePoint - u_blackPoint, 0.0001);
  rgb = clamp((rgb - vec3(u_blackPoint)) / levelRange, 0.0, 1.0);
  rgb = pow(rgb, vec3(1.0 / max(u_gamma, 0.0001)));
  outColor = vec4(rgb, baseSample.a);
}
`;
