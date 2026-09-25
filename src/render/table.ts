// 天板に重ねるもの：瓶の接地影、窓の光で落ちる淡い影、夜は海月の光の照り返し。
// 写真の上に「掛け算」と「足し算」を一度に乗せる（出力 = src.rgb + dst * src.a）。
import {
  CustomBlending,
  GLSL3,
  Mesh,
  OneFactor,
  PlaneGeometry,
  ShaderMaterial,
  SrcAlphaFactor,
} from 'three';
import { JAR } from '../config';
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
uniform vec3 uKey, uKeyDir, uGlowPos, uGlowColor;
uniform float uShadow;
uniform float uTableBackZ, uTableLeftX;
in vec3 vWorldPos;

// 光へ向かう線が瓶（ガラスと水）を通るときの影。x = さえぎる量、y = 芯に集まる光
vec2 glassShadow(vec3 P, vec3 L) {
  vec2 lxz = L.xz;
  float l2 = dot(lxz, lxz);
  if (l2 < 1e-5) return vec2(0.0);
  float t = -dot(P.xz, lxz) / l2;
  if (t <= 0.0) return vec2(0.0);
  float h = P.y + L.y * t;
  float d = length(P.xz + lxz * t) / JAR_R;
  float soft = 0.05 + 0.25 * t;
  float inside = 1.0 - smoothstep(1.0 - soft, 1.0 + soft, d);
  float heightFade = 1.0 - smoothstep(JAR_H * 0.75, JAR_H * 1.05, h);
  // 水の円筒がレンズになって、影の芯に光が集まる
  float focus = exp(-pow(d / 0.22, 2.0));
  float edge = smoothstep(0.55, 0.95, d);
  float k = inside * heightFade / (1.0 + 0.6 * t);
  return vec2((0.55 + 0.45 * edge) * (1.0 - focus) * k, focus * k);
}

void main() {
  vec3 P = vWorldPos;
  float r = length(P.xz);
  // 天板の外には描かない
  float onTable = smoothstep(uTableBackZ, uTableBackZ + 0.04, P.z) * smoothstep(uTableLeftX, uTableLeftX + 0.04, P.x);

  // 接地影（まわりの光を瓶がさえぎる）
  float out_ = max(r - JAR_R, 0.0);
  float ao = 1.0 - 0.5 * exp(-out_ / 0.022) - 0.22 * exp(-out_ / 0.09);
  ao = mix(ao, 0.62, 1.0 - smoothstep(JAR_R - 0.02, JAR_R, r));

  // 窓の光が落とす淡い影
  vec2 sh = glassShadow(P, normalize(uKeyDir)) * uShadow;
  float mul = ao * (1.0 - sh.x);

  // 海月の光の照り返し（ウォルナットの色を帯びる）
  vec3 gd = uGlowPos - P;
  float d2 = dot(gd, gd);
  float cosT = max(gd.y, 0.0) / sqrt(d2 + 1e-5);
  vec3 spill = uGlowColor * vec3(0.55, 0.42, 0.34) * cosT / (d2 * 9.0 + 0.35) * 0.35;

  spill += uKey * vec3(0.5, 0.38, 0.3) * sh.y * 0.25;

  gl_FragColor = vec4(spill * onTable, mix(1.0, mul, onTable));
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
      uKeyDir: shared.uKeyDir,
      uGlowPos: shared.uGlowPos,
      uGlowColor: shared.uGlowColor,
      uShadow: shared.uShadow,
      uTableBackZ: { value: cam.tableBackZ },
      uTableLeftX: { value: cam.tableLeftX },
    },
  });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return mesh;
}
