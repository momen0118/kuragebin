// 傘。回転体の格子を頂点シェーダで変形して拍動させる。
// 外側（外傘）と内側（下傘）の2層を重ね、内側に四つ葉の生殖腺を淡く置く。
import {
  BackSide,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  GLSL3,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Vector3,
  type Side,
} from 'three';
import { BELL, WATER } from '../../config';
import type { SharedUniforms } from '../uniforms';
import common from '../shaders/common.glsl?raw';
import { frag } from '../shaders/glsl';

/** 生殖腺を置く範囲（s の上限） */
const GONAD_S = 0.52;

const DEFINES = /* glsl */ `
#define BELL_RR ${BELL.relaxed[0].toFixed(5)}
#define BELL_HR ${BELL.relaxed[1].toFixed(5)}
#define BELL_AR ${BELL.relaxed[2].toFixed(5)}
#define BELL_RC ${BELL.contracted[0].toFixed(5)}
#define BELL_HC ${BELL.contracted[1].toFixed(5)}
#define BELL_AC ${BELL.contracted[2].toFixed(5)}
#define THICK_APEX ${BELL.thicknessApex.toFixed(5)}
#define THICK_MARGIN ${BELL.thicknessMargin.toFixed(5)}
#define NOTCH_DEPTH ${BELL.notchDepth.toFixed(5)}
#define GONAD_S ${GONAD_S.toFixed(3)}
#define CAUSTIC_SCALE ${WATER.causticScale.toFixed(3)}
#define CAUSTIC_SPEED ${WATER.causticSpeed.toFixed(3)}
`;

const VERT = /* glsl */ `
${common}
${DEFINES}
uniform vec3 uPulse;
uniform float uLayer;
uniform float uSMax;
uniform float uInset;
out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec3 vViewNormal;
out vec2 vST;

// profile.ts の bellProfile と同じ式
vec2 bellProfile(float s, float p) {
  float a0 = s * BELL_AR;
  float a1 = s * BELL_AC;
  float r = BELL_RR * sin(a0) + (BELL_RC * sin(a1) - BELL_RR * sin(a0)) * p;
  float y0 = BELL_HR * cos(a0);
  float y1 = BELL_HC * cos(a1) + (BELL_HR - BELL_HC);
  return vec2(r, y0 + (y1 - y0) * p);
}

// 頂点・中ほど・縁の3点の p をなめらかにつなぐ。縁ほど遅れて動く
float pulseAt(float s) {
  float a = uPulse.x;
  float b = uPulse.y;
  float c = uPulse.z;
  return a + s * (-3.0 * a + 4.0 * b - c) + s * s * (2.0 * a - 4.0 * b + 2.0 * c);
}

float notchK(float th, float s) {
  float k = th / (PI / 4.0) - 0.5;
  float d = (k - floor(k + 0.5)) * (PI / 4.0);
  float w = saturate((s - 0.86) / 0.14);
  return 1.0 - NOTCH_DEPTH * exp(-d * d / 0.0035) * w * w;
}

void main() {
  float s = max(uv.x * uSMax, 0.0008);
  float th = uv.y * TAU;
  float p = pulseAt(s);
  vec2 pr = bellProfile(s, p);
  float s2 = s + 0.004;
  vec2 pr2 = bellProfile(s2, pulseAt(s2));
  vec2 tg = normalize(pr2 - pr);
  // 外向きの法線（頂点では真上）
  vec2 n2 = vec2(-tg.y, tg.x);
  vec3 dirR = vec3(cos(th), 0.0, sin(th));
  float nk = notchK(th, s);
  vec3 pos = vec3(dirR.x * pr.x * nk, pr.y, dirR.z * pr.x * nk);
  vec3 nrm = normalize(vec3(dirR.x * n2.x, n2.y, dirR.z * n2.x));
  if (uLayer > 1.5) {
    // 生殖腺：傘の中に、ひとまわり小さなドームとして浮かべる（横からでも弧に見える）
    pos = vec3(pos.x * 0.7, pos.y * 0.78 - uInset, pos.z * 0.7);
  } else if (uLayer > 0.5) {
    float thick = mix(THICK_APEX, THICK_MARGIN, pow(s, 0.7));
    pos -= nrm * thick;
  }
  vST = vec2(s, th);
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * nrm);
  vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${common}
${DEFINES}
uniform float uTime, uCaustics, uGlowPass, uLayer;
uniform vec3 uKey, uKeyDir, uAmbient;
uniform vec3 uBody, uGlow, uGonad;
uniform vec3 uPulse;
uniform sampler2D tRoom;
uniform vec2 uResolution;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vViewNormal;
in vec2 vST;

// 放射管：16本が縁へ向かって枝分かれし、縁で環状管につながる
float canals(float s, float th) {
  float r = max(s, 0.05);
  float w = 0.012;
  float seg = TAU / 16.0;
  float a = mod(th + seg * 0.5, seg) - seg * 0.5;
  float c = exp(-pow(a * r / w, 2.0)) * smoothstep(0.22, 0.4, s);
  float d1 = seg * 0.5 * smoothstep(0.5, 1.0, s) * 0.62;
  float b1 = exp(-pow((abs(a) - d1) * r / w, 2.0)) * smoothstep(0.52, 0.62, s);
  float d2 = seg * 0.25 * smoothstep(0.74, 1.0, s) * 0.7;
  float b2 = exp(-pow((abs(abs(a) - d1) - d2) * r / (w * 0.8), 2.0)) * smoothstep(0.76, 0.84, s);
  float ring = exp(-pow((s - 0.975) / 0.009, 2.0));
  return max(max(c, b1 * 0.8), max(b2 * 0.6, ring));
}

// 四つ葉の生殖腺。中心に口を開いた蹄鉄形が4つ
float gonads(float s, float th) {
  vec2 q = vec2(cos(th), sin(th)) * (s / GONAD_S);
  float g = 0.0;
  for (int k = 0; k < 4; k++) {
    float ang = PI * 0.25 + float(k) * PI * 0.5;
    vec2 c = 0.43 * vec2(cos(ang), sin(ang));
    vec2 d = q - c;
    float r = length(d);
    float ring = exp(-pow((r - 0.25) / 0.055, 2.0));
    float facing = dot(d / max(r, 1e-4), -normalize(c));
    ring *= 1.0 - 0.85 * smoothstep(0.55, 0.9, facing);
    float fill = exp(-pow(r / 0.24, 3.0)) * 0.22;
    g += ring + fill;
  }
  return g * (1.0 - smoothstep(0.85, 1.0, s / GONAD_S));
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float facing = dot(N, V);
  vec3 Nf = facing < 0.0 ? -N : N;
  float NdV = abs(facing);
  float fres = pow(1.0 - NdV, 2.0);
  float s = vST.x;
  float th = vST.y;
  bool inner = uLayer > 0.5 && uLayer < 1.5;
  bool gonad = uLayer > 1.5;

  float canal = inner ? canals(s, th) : 0.0;
  float gon = gonad ? gonads(s, th) : 0.0;
  // 縁の近くの細い輪（筋肉）
  float rings = inner ? (0.5 + 0.5 * cos(s * 150.0)) * smoothstep(0.62, 0.9, s) * 0.5 : 0.0;

  // 光：窓からの光は透けて届き、コースティクスが揺れる
  float wrap = saturate(dot(Nf, uKeyDir) * 0.5 + 0.5);
  float trans = pow(saturate(dot(-V, uKeyDir) * 0.5 + 0.5), 3.0);
  float ca = caustics(vWorldPos.xz * CAUSTIC_SCALE * 1.3 + vWorldPos.y * 5.0, uTime * CAUSTIC_SPEED);
  ca = ca / (1.0 + 0.5 * ca) * uCaustics;
  vec3 light = uAmbient * 0.9 + uKey * (0.18 * wrap + 0.35 * trans + 0.5 * ca * wrap);

  // 縁では背景の光がずれて見える（屈折のかわり）
  vec2 aspect = vec2(uResolution.y / uResolution.x, 1.0);
  vec2 suv = gl_FragCoord.xy / uResolution + vViewNormal.xy * aspect * 0.02 * fres;
  vec3 bg = texture(tRoom, suv).rgb;

  // 輪郭だけが細く明るく、中は透ける
  float rim = pow(1.0 - NdV, 3.5);
  // 縁の帯（環状管と触手の付け根）
  float margin = smoothstep(0.88, 0.975, s);
  float density;
  vec3 tint = uBody;
  if (gonad) {
    density = 0.09 * gon;
    tint = uGonad;
  } else if (inner) {
    density = 0.004 + 0.08 * rim + 0.03 * canal + 0.012 * rings + 0.02 * margin;
  } else {
    density = 0.006 + 0.17 * rim + 0.025 * margin;
  }
  vec3 col = tint * light * density * 1.6;
  float refr = gonad ? 0.0 : rim * (inner ? 0.12 : 0.22);
  col += bg * refr;
  float alpha = density * 0.5 + refr;

  // 発光：縁と生殖腺。縮むとわずかに強まる
  float pulseGlow = 0.85 + 0.3 * uPulse.z;
  vec3 glow;
  if (gonad) {
    glow = uGonad * gon * 0.4;
  } else if (inner) {
    glow = uGlow * (0.03 * rim + 0.06 * canal + 0.1 * margin);
  } else {
    glow = uGlow * (0.06 * rim + 0.2 * margin * (0.4 + 0.6 * rim));
  }
  glow *= pulseGlow;

  if (uGlowPass > 0.5) {
    gl_FragColor = vec4(glow, 0.0);
    return;
  }
  gl_FragColor = vec4(col + glow, alpha);
}
`;

function grid(rings: number, segments: number, bias: number): BufferGeometry {
  const uv: number[] = [];
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    // 縁の近くを細かく
    const s = 1 - Math.pow(1 - i / rings, bias);
    for (let j = 0; j <= segments; j++) {
      uv.push(s, j / segments);
      pos.push(0, 0, 0);
    }
  }
  const row = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      const b = a + row;
      // 外（上）から見て反時計回りが表
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export interface BellLook {
  uBody: { value: Vector3 };
  uGlow: { value: Vector3 };
  uGonad: { value: Vector3 };
}

export interface Bell {
  meshes: Mesh[];
  pulse: { value: Vector3 };
}

export function createBell(shared: SharedUniforms, look: BellLook): Bell {
  const pulse = { value: new Vector3() };
  const bellGeo = grid(BELL.ringSegments, BELL.radialSegments, 1.35);
  const gonadGeo = grid(14, 64, 1);

  const make = (geo: BufferGeometry, layer: number, side: Side, order: number, sMax = 1, inset = 0): Mesh => {
    const mat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERT,
      fragmentShader: frag(FRAG),
      side,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      uniforms: {
        uPulse: pulse,
        uLayer: { value: layer },
        uSMax: { value: sMax },
        uInset: { value: inset },
        uTime: shared.uTime,
        uCaustics: shared.uCaustics,
        uGlowPass: shared.uGlowPass,
        uKey: shared.uKey,
        uKeyDir: shared.uKeyDir,
        uAmbient: shared.uAmbient,
        tRoom: shared.tRoom,
        uResolution: shared.uResolution,
        uBody: look.uBody,
        uGlow: look.uGlow,
        uGonad: look.uGonad,
      },
    });
    const m = new Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = order;
    m.matrixAutoUpdate = false;
    return m;
  };

  const meshes = [
    make(bellGeo, 0, BackSide, 32),
    make(bellGeo, 1, BackSide, 33),
    make(gonadGeo, 2, DoubleSide, 34, GONAD_S, 0.07),
    make(bellGeo, 1, FrontSide, 35),
    make(bellGeo, 0, FrontSide, 36),
  ];
  return { meshes, pulse };
}
