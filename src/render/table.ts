// 天板に重ねるもの：瓶の接地影、窓の光で落ちる淡い影、その中から伸びる、瓶がレンズになって集めた光の弧、
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
import { JAR, LAMP, TABLE } from '../config';
import type { PhotoCamera } from './camera';
import { CAUSTIC_SWAY } from './caustic';
import { GLOW_FALL } from './jarShaders';
import { LAMP_GLSL, lampUniforms } from './lamp';
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
${CAUSTIC_SWAY}
${GLOW_FALL}
${LAMP_GLSL}
#define JAR_R ${JAR.radius.toFixed(5)}
#define JAR_H ${JAR.height.toFixed(5)}
#define WATER_Y ${JAR.waterLevel.toFixed(5)}
#define ARC_FOCUS ${TABLE.arcFocus.toFixed(4)}
#define ARC_WIDTH ${TABLE.arcWidth.toFixed(4)}
#define ARC_GAIN ${TABLE.arcGain.toFixed(4)}
#define ARC_FILL ${TABLE.arcFill.toFixed(4)}
uniform sampler2D tRoom;
uniform vec2 uResolution;
uniform vec3 uKey, uGlowPos, uGlowColor, uLightDir;
uniform float uShadow, uLensLight, uTime;
uniform float uTableBackZ, uTableLeftX;
/** 天板に立っている瓶の横の位置（ワールド x）、数、瓶ごとの水面の揺れ（すれ違う間は2つ） */
uniform float uJarX[2];
uniform int uJarCount;
uniform float uJarAgitation[2];
in vec3 vWorldPos;

// 光へ向かう線が瓶を通るときの影（x）と、水の円筒レンズが集めた光（y）。P は瓶の底の中心から見た位置
vec2 jarShade(vec3 P, vec3 L, float agitation) {
  vec2 lxz = L.xz;
  float l2 = dot(lxz, lxz);
  if (l2 < 1e-5) return vec2(0.0);
  float ll = sqrt(l2);
  float t = -dot(P.xz, lxz) / l2;
  if (t <= 0.0) return vec2(0.0);
  float along = t * ll;
  float h = P.y + L.y * t;
  // 光の筋に対して横にどれだけずれているか（瓶の半径 = 1、符号つき）
  float side = ((P.x + lxz.x * t) * lxz.y - (P.z + lxz.y * t) * lxz.x) / ll / JAR_R;
  float d = abs(side);
  float soft = 0.06 + 0.18 * along;
  float inside = 1.0 - smoothstep(1.0 - soft, 1.0 + soft, d);
  float below = 1.0 - smoothstep(JAR_H * 0.8, JAR_H * 1.02, h);
  // 透明な瓶の影は薄い。縁を通る光は逃げて少し暗い
  float block = inside * below * (0.35 + 0.4 * smoothstep(0.6, 0.97, d)) / (1.0 + 0.8 * along);

  // 水の円筒が光を集める弧。縁を通る光ほど手前で集まる。いつもゆっくり揺らめく
  vec2 sw = causticSway(side, uTime, agitation);
  float f = ARC_FOCUS * (1.0 - 0.35 * d * d) + sw.x;
  float w = ARC_WIDTH * (1.0 + 0.8 * d);
  // 芯と、そのまわりのぼんやりした広がり
  float arc = exp(-pow((along - f) / w, 2.0)) + 0.35 * exp(-pow((along - f) / (w * 3.0), 2.0));
  // 瓶の縁（影の始まり）から弧までを淡くつなぐ。弧を過ぎた光は広がって薄れる
  float rim = JAR_R * sqrt(max(1.0 - d * d, 0.0));
  float fill = smoothstep(rim - 0.01, f, along) * (1.0 - smoothstep(f, f + w * 3.0, along));
  float lat = 1.0 - smoothstep(0.45, 0.95, d);
  float water = 1.0 - smoothstep(WATER_Y - 0.05, WATER_Y + 0.02, h);
  return vec2(block, (arc + fill * ARC_FILL) * lat * water * below * sw.y);
}

void main() {
  vec3 Pw = vWorldPos;
  // 天板の外には描かない
  float onTable = smoothstep(uTableBackZ, uTableBackZ + 0.04, Pw.z) * smoothstep(uTableLeftX, uTableLeftX + 0.04, Pw.x);
  vec3 photo = texture(tRoom, gl_FragCoord.xy / uResolution).rgb;
  vec3 tint = uKey / max(max(uKey.r, uKey.g), max(uKey.b, 1e-3));
  vec3 lampTint = uLampColor / max(max(uLampColor.r, uLampColor.g), max(uLampColor.b, 1e-3));
  float mul = 1.0;
  vec3 add = vec3(0.0);

  // 瓶ごとに：接地影、窓の光の影と光の弧、夜のデスクライト（ライトは瓶ごとにあり、瓶と一緒に動く）
  for (int i = 0; i < 2; i++) {
    if (i >= uJarCount) break;
    vec3 P = Pw - vec3(uJarX[i], 0.0, 0.0);
    float ag = uJarAgitation[i];
    float r = length(P.xz);

    // 接地影（まわりの光を瓶がさえぎる）。透明な瓶なので控えめ
    float out_ = max(r - JAR_R, 0.0);
    float ao = 1.0 - 0.36 * exp(-out_ / 0.02) - 0.14 * exp(-out_ / 0.08);
    ao = mix(ao, 0.72, 1.0 - smoothstep(JAR_R - 0.02, JAR_R, r));

    vec2 sh = jarShade(P, normalize(uLightDir), ag);
    mul *= ao * (1.0 - sh.x * uShadow);

    // 瓶が集めた光で、写真の天板の木目がそのまま明るくなる（窓の光の色を帯びる）
    add += photo * tint * sh.y * uLensLight * ARC_GAIN;

    // 夜のデスクライト：光だまりの中に瓶の影が右へ落ち、瓶が集めた光の弧が出る
    if (uLampLevel > 0.001) {
      float spot = saturate(lampSpot(P));
      vec2 shL = jarShade(P, lampDir(P), ag);
      mul *= 1.0 - shL.x * ${LAMP.shadow.toFixed(3)} * uLampLevel * spot;
      add += photo * lampTint * shL.y * uLampLevel * spot * ${LAMP.lensLight.toFixed(3)} * ARC_GAIN;
    }

    // 海月の光の照り返し（光る種だけ）。瓶の底越しに、海月が近いときだけほのかに
    vec3 wood = vec3(0.62, 0.42, 0.3);
    vec3 gd = uGlowPos - P;
    float cosT = max(gd.y, 0.0) / length(gd + vec3(0.0, 1e-4, 0.0));
    add += uGlowColor * wood * cosT * glowFall(P, uGlowPos) * 0.15 * float(i == 0);
  }

  gl_FragColor = vec4(add * onTable, mix(1.0, mul, onTable));
}
`;

/** 天板に立っている瓶の横の位置と数、瓶ごとの水面の揺れ（描く前に入れる） */
export interface TableJars {
  uJarX: { value: number[] };
  uJarCount: { value: number };
  uJarAgitation: { value: number[] };
}

export function createTable(shared: SharedUniforms, cam: PhotoCamera): { mesh: Mesh; jars: TableJars } {
  const width = 4;
  const depth = 3;
  const geo = new PlaneGeometry(width, depth, 1, 1);
  geo.rotateX(-Math.PI / 2);
  // 手前（+z）へ伸ばし、奥は天板の縁まで
  geo.translate(0.8, 0, cam.tableBackZ + depth / 2);
  const jars: TableJars = { uJarX: { value: [0, 0] }, uJarCount: { value: 1 }, uJarAgitation: { value: [0, 0] } };
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
      ...lampUniforms(shared),
      tRoom: shared.tRoom,
      uResolution: shared.uResolution,
      uKey: shared.uKey,
      uGlowPos: shared.uGlowPos,
      uGlowColor: shared.uGlowColor,
      uShadow: shared.uShadow,
      uLensLight: shared.uLensLight,
      uTime: shared.uTime,
      ...jars,
      uLightDir: { value: new Vector3(...TABLE.lightDir).normalize() },
      uTableBackZ: { value: cam.tableBackZ },
      uTableLeftX: { value: cam.tableLeftX },
    },
  });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return { mesh, jars };
}
