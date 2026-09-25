// 共通の関数

#define PI 3.14159265359
#define TAU 6.28318530718

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 揺れる光の網。水面の波の曲がり具合（ヘッセ行列）から、光が集まって明るくなる線を求める
float caustics(vec2 p, float t) {
  const vec4 W[7] = vec4[7](
    vec4(1.0, 0.35, 0.9, 0.0), vec4(-0.55, 0.95, 0.8, 1.3), vec4(0.3, -1.1, 0.7, 2.1),
    vec4(1.6, 0.9, 0.35, 0.7), vec4(-1.2, -1.4, 0.3, 4.0), vec4(2.1, -0.6, 0.22, 2.7),
    vec4(-0.4, 2.3, 0.2, 5.1));
  float hxx = 0.0;
  float hyy = 0.0;
  float hxy = 0.0;
  for (int i = 0; i < 7; i++) {
    vec2 k = W[i].xy;
    float kk = dot(k, k);
    float s = sin(dot(k, p) + t * (0.8 + 0.4 * sqrt(kk)) + W[i].w);
    float a = W[i].z / kk * s;
    hxx -= a * k.x * k.x;
    hyy -= a * k.y * k.y;
    hxy -= a * k.x * k.y;
  }
  const float D = 1.6;
  float det = (1.0 + D * hxx) * (1.0 + D * hyy) - D * D * hxy * hxy;
  float v = 1.0 / (abs(det) + 0.1) / 1.7;
  return pow(max(v - 0.8, 0.0), 1.6) * 0.45;
}

// sRGB への変換
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// 明るすぎる所だけを柔らかく丸める（写真の明るさはそのまま）
vec3 softClip(vec3 c) {
  const float k = 0.8;
  vec3 over = max(c - k, 0.0);
  return min(c, k) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
}
