// 天板に重ねるもの：瓶の接地影、窓の光で落ちる淡い影、その中に瓶がレンズになって集めた明るい弧、
// 夜は海月の光の照り返し。写真の上に「掛け算」と「足し算」を一度に乗せる（出力 = src.rgb + dst * src.a）。
import {
  CustomBlending,
  GLSL3,
  Mesh,
  OneFactor,
  PlaneGeometry,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector3,
} from 'three';
import { JAR, TABLE } from '../config';
import type { PhotoCamera } from './camera';
import type { SharedUniforms } from './uniforms';
import common from './shaders/common.glsl?raw';
import { frag } from './shaders/glsl';

const VERT = /* glsl */ `
out vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${common}
#define JAR_R ${JAR.radius.toFixed(5)}
#define JAR_H ${JAR.height.toFixed(5)}
#define WATER_Y ${JAR.waterLevel.toFixed(5)}
#define FOCUS ${TABLE.focusDistance.toFixed(4)}
uniform vec3 uKey, uGlowPos, uGlowColor, uLightDir;
uniform float uShadow, uLensLight, uAgitation, uTime;
uniform float uTableBackZ, uTableLeftX;
in vec3 vWorldPos;

// 光へ向かう線が瓶を通るときの影（x）と、水の円筒レンズが集めた光（y）
vec2 jarShade(vec3 P, vec3 L) {
  vec2 lxz = L.xz;
  float l2 = dot(lxz, lxz);
  if (l2 < 1e-5) return vec2(0.0);
  float t = -dot(P.xz, lxz) / l2;
  if (t <= 0.0) return vec2(0.0);
  float along = t * sqrt(l2);
  float h = P.y + L.y * t;
  float side = (P.x + lxz.x * t) * lxz.y - (P.z + lxz.y * t) * lxz.x;
  float d = abs(side) / sqrt(l2) / JAR_R;
  float soft = 0.06 + 0.18 * along;
  float inside = 1.0 - smoothstep(1.0 - soft, 1.0 + soft, d);
  float below = 1.0 - smoothstep(JAR_H * 0.8, JAR_H * 1.02, h);
  // 透明な瓶の影は薄い。縁を通る光は逃げて少し暗い
  float block = inside * below * (0.35 + 0.4 * smoothstep(0.6, 0.97, d)) / (1.0 + 0.8 * along);
  // 水の円筒が光を集める線。軸から焦点の距離あたりで、縁の光ほど手前で集まるので弧になる
  float wob = uAgitation * 0.012 * sin(uTime * 3.1 + d * 9.0);
  float f = FOCUS * (1.0 - 0.42 * d * d) + wob;
  float arc = exp(-pow((along - f) / (0.022 + 0.03 * d), 2.0)) * (1.0 - smoothstep(0.55, 0.9, d));
  float water = 1.0 - smoothstep(WATER_Y - 0.05, WATER_Y + 0.02, h);
  // 焦点より先に抜けた光も、影の中に淡く広がる
  float spread = smoothstep(f * 0.6, f, along) * exp(-max(along - f, 0.0) * 3.0) * (1.0 - smoothstep(0.2, 0.8, d)) * 0.25;
  return vec2(block, (arc + spread) * water * below);
}

void main() {
  vec3 P = vWorldPos;
  float r = length(P.xz);
  // 天板の外には描かない
  float onTable = smoothstep(uTableBackZ, uTableBackZ + 0.04, P.z) * smoothstep(uTableLeftX, uTableLeftX + 0.04, P.x);

  // 接地影（まわりの光を瓶がさえぎる）。透明な瓶なので控えめ
  float out_ = max(r - JAR_R, 0.0);
  float ao = 1.0 - 0.36 * exp(-out_ / 0.02) - 0.14 * exp(-out_ / 0.08);
  ao = mix(ao, 0.72, 1.0 - smoothstep(JAR_R - 0.02, JAR_R, r));

  vec2 sh = jarShade(P, normalize(uLightDir));
  float mul = ao * (1.0 - sh.x * uShadow);

  // 瓶が集めた明るい光（ウォルナットの色を帯びる）
  vec3 wood = vec3(0.62, 0.42, 0.3);
  vec3 add = uKey * wood * sh.y * uLensLight * 0.4;

  // 海月の光の照り返し
  vec3 gd = uGlowPos - P;
  float d2 = dot(gd, gd);
  float cosT = max(gd.y, 0.0) / sqrt(d2 + 1e-5);
  add += uGlowColor * wood * cosT / (d2 * 9.0 + 0.35) * 0.3;

  gl_FragColor = vec4(add * onTable, mix(1.0, mul, onTable));
}
`;

export function createTable(shared: SharedUniforms, cam: PhotoCamera): Mesh {
  const width = 4;
  const depth = 3;
  const geo = new PlaneGeometry(width, depth, 1, 1);
  geo.rotateX(-Math.PI / 2);
  // 手前（+z）へ伸ばし、奥は天板の縁まで
  geo.translate(0.8, 0, cam.tableBackZ + depth / 2);
  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT,
    fragmentShader: frag(FRAG),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: SrcAlphaFactor,
    uniforms: {
      uKey: shared.uKey,
      uGlowPos: shared.uGlowPos,
      uGlowColor: shared.uGlowColor,
      uShadow: shared.uShadow,
      uLensLight: shared.uLensLight,
      uAgitation: shared.uAgitation,
      uTime: shared.uTime,
      uLightDir: { value: new Vector3(...TABLE.lightDir).normalize() },
      uTableBackZ: { value: cam.tableBackZ },
      uTableLeftX: { value: cam.tableLeftX },
    },
  });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return mesh;
}
