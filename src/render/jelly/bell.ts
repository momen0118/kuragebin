// 傘。回転体の格子を頂点シェーダで変形して拍動させる。
// 外側（外傘）と内側（下傘）の2層を重ね、内側に四つ葉の生殖腺を淡く置く。
import {
  BackSide,
  BufferGeometry,
  CustomBlending,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  FloatType,
  FrontSide,
  GLSL3,
  Mesh,
  NearestFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RGFormat,
  ShaderMaterial,
  Vector3,
  type Side,
} from 'three';
import { BELL, EPHYRA, JELLY_LOOK } from '../../config';
import { LOBES, PROFILE_SEGMENTS } from './profile';
import type { SharedUniforms } from '../uniforms';
import { LAMP_GLSL, lampUniforms } from '../lamp';
import { CLIP_GLSL } from '../shaders/clip';
import common from '../shaders/common.glsl?raw';
import { frag } from '../shaders/glsl';

/** 生殖腺を置く範囲（s の上限） */
const GONAD_S = 0.52;

const DEFINES = /* glsl */ `
#define PROFILE_N ${PROFILE_SEGMENTS}
#define LOBES ${LOBES}
#define THICK_APEX ${BELL.thicknessApex.toFixed(5)}
#define THICK_MARGIN ${BELL.thicknessMargin.toFixed(5)}
#define LOBE_ROUND ${BELL.lobeRound.toFixed(5)}
#define NOTCH_DEPTH ${BELL.notchDepth.toFixed(5)}
#define NOTCH_WIDTH ${BELL.notchWidth.toFixed(5)}
#define RIPPLE ${BELL.marginRipple.toFixed(5)}
#define RIPPLE_N ${BELL.marginRippleCount.toFixed(1)}
#define RIPPLE_W ${((Math.PI * 2) / BELL.marginRipplePeriod).toFixed(5)}
#define GONAD_S ${GONAD_S.toFixed(3)}
#define LAMP_SCATTER ${JELLY_LOOK.lampScatter.toFixed(3)}
#define LAPPET_W ${EPHYRA.lappetWidth.toFixed(4)}
`;

const VERT = /* glsl */ `
${common}
${DEFINES}
// 縁弁ごとの断面の点列（profile.ts の BellShape が毎ステップ作る）。横が断面の点、縦が縁弁
uniform sampler2D tProfile;
uniform float uTime;
uniform float uLayer;
uniform float uSMax;
uniform float uInset;
// エフィラの腕の形（form.ts の armReach と同じ）。成体では uArmDepth = uLappet = 0
uniform float uArmDepth, uArmBase, uArmTip, uLappet;
out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec3 vViewNormal;
out vec2 vST;

vec2 lobeProfile(int lobe, float s) {
  float f = clamp(s, 0.0, 1.0) * float(PROFILE_N);
  int i = int(min(floor(f), float(PROFILE_N - 1)));
  vec2 a = texelFetch(tProfile, ivec2(i, lobe), 0).rg;
  vec2 b = texelFetch(tProfile, ivec2(i + 1, lobe), 0).rg;
  return mix(a, b, f - float(i));
}

// 隣り合う2枚の縁弁を角度で混ぜる。縁弁の真ん中あたりはその縁弁だけ（profile.ts の lobeBlend と同じ式）
vec2 profileAt(float s, float th) {
  float u = th / (TAU / float(LOBES));
  float k = floor(u);
  float w = smoothstep(0.32, 0.68, u - k);
  int l0 = int(mod(k, float(LOBES)));
  int l1 = int(mod(k + 1.0, float(LOBES)));
  return mix(lobeProfile(l0, s), lobeProfile(l1, s), w);
}

// 縁弁の形：花びらの丸みと、切れ込み（profile.ts の scallop と同じ式）
float scallop(float th, float s) {
  float u = th / (TAU / float(LOBES));
  float d = abs(u - floor(u + 0.5));
  float w = smoothstep(0.8, 1.0, s);
  float round_ = LOBE_ROUND * pow(2.0 * d, 3.0);
  float cut = NOTCH_DEPTH * exp(-pow((0.5 - d) / NOTCH_WIDTH, 2.0));
  return 1.0 - (round_ + cut) * w;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// 角度 θ での、傘の縁までの断面の長さの割合。腕の先で 1、腕の間の切れ込みの底で 1 - uArmDepth
float armR(float th) {
  float u = th / (TAU / float(LOBES));
  float d = abs(u - floor(u + 0.5));
  float notch = uLappet * exp(-pow(d / LAPPET_W, 2.0));
  if (uArmDepth <= 1e-4) return 1.0 - notch;
  float fl = 1.0 - uArmDepth;
  float taper = (uArmBase - uArmTip) / uArmDepth;
  float side = (uArmBase + taper * fl) / (sin(d * TAU / float(LOBES)) + taper);
  return min(1.0, -smin(-smin(1.0, side, 0.05), -fl, 0.06)) - notch;
}

vec3 surf(float s, float th) {
  // エフィラの腕の間では、断面の途中で縁になる（s = 1 が星形の輪郭）
  float se = s * armR(th);
  vec2 pr = profileAt(se, th);
  float r = pr.x * scallop(th, se);
  // 縁のさざ波。縁弁の中でも縁は一本のきれいな線にならない
  float wave = sin(th * RIPPLE_N + uTime * RIPPLE_W + 1.7 * sin(th * 3.0 - uTime * 0.31));
  pr.y += RIPPLE * wave * smoothstep(0.85, 1.0, s);
  return vec3(cos(th) * r, pr.y, sin(th) * r);
}

void main() {
  float s = max(uv.x * uSMax, 0.0008);
  float th = uv.y * TAU;
  vec3 pos = surf(s, th);
  // 法線は断面方向と円周方向の差分から（縁弁ごとに形が違うので）
  float h = 0.5 / float(PROFILE_N);
  float e = 0.004;
  vec3 ds = surf(min(s + h, 1.0), th) - surf(max(s - h, 0.0), th);
  vec3 dt = surf(s, th + e) - surf(s, th - e);
  vec3 nrm = cross(dt, ds);
  // 頂点の近くでは円周方向の差分が小さくなるので、断面だけから求めた向きと合わせる
  float reach = armR(th);
  vec2 tg = normalize(profileAt(min((s + h) * reach, 1.0), th) - profileAt(max((s - h) * reach, 0.0), th));
  vec3 dirR = vec3(cos(th), 0.0, sin(th));
  vec3 nMer = normalize(vec3(dirR.x * -tg.y, tg.x, dirR.z * -tg.y));
  float nl = length(nrm);
  nrm = nl > 1e-7 ? nrm / nl : nMer;
  if (dot(nrm, nMer) < 0.0) nrm = -nrm;
  nrm = normalize(mix(nMer, nrm, smoothstep(0.02, 0.1, s)));
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
${LAMP_GLSL}
${CLIP_GLSL}
uniform float uGlowPass, uLayer, uContract;
// 放射管の枝分かれと環状管、四つ葉の濃さ（エフィラが育つにつれて 0 → 1）。
// uYoung はエフィラの若さ（1 で放されたばかり）：小さな体は少し濃く、胃から腕へ伸びる管が見える
uniform float uCanals, uGonads, uYoung;
uniform vec3 uKey, uKeyDir, uAmbient;
uniform vec3 uBody, uGlow, uGonad;
// 生殖腺そのものの色（uGonad は発光の強さを掛けた色なので、昼はほぼ黒になる）
uniform vec3 uGonadTint;
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
  return max(max(c, b1 * 0.8 * uCanals), max(b2 * 0.6 * uCanals, ring * uCanals));
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
    float ring = exp(-pow((r - 0.24) / 0.075, 2.0));
    float facing = dot(d / max(r, 1e-4), -normalize(c));
    ring *= 1.0 - 0.85 * smoothstep(0.55, 0.9, facing);
    float fill = exp(-pow(r / 0.24, 3.0)) * 0.3;
    g += ring + fill;
  }
  return g * (1.0 - smoothstep(0.85, 1.0, s / GONAD_S));
}

void main() {
  clipToJar(vWorldPos);
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
  float gon = gonad ? gonads(s, th) * uGonads : 0.0;
  // 縁の近くの細い輪（筋肉）
  float rings = inner ? (0.5 + 0.5 * cos(s * 150.0)) * smoothstep(0.62, 0.9, s) * 0.5 * uCanals : 0.0;

  // 光：窓からの光が透けて届く
  float wrap = saturate(dot(Nf, uKeyDir) * 0.5 + 0.5);
  float trans = pow(saturate(dot(-V, uKeyDir) * 0.5 + 0.5), 3.0);
  vec3 light = uAmbient * 0.9 + uKey * (0.18 * wrap + 0.35 * trans);
  // 夜のデスクライト。円錐の中にいるときだけ、左上からの光が透けて届く
  vec3 Ll = lampDir(vWorldPos);
  float wrapL = saturate(dot(Nf, Ll) * 0.5 + 0.5);
  float transL = pow(saturate(dot(-V, Ll) * 0.5 + 0.5), 3.0);
  light += uLampColor * lampSpot(vWorldPos) * (0.18 * wrapL + 0.35 * transL);

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
    density = 0.18 * gon;
    tint = uGonadTint;
  } else if (inner) {
    density = 0.004 + 0.08 * rim + 0.03 * canal * (1.0 + 1.5 * uYoung) + 0.012 * rings + 0.02 * margin + 0.012 * uYoung;
  } else {
    density = 0.006 + 0.17 * rim + 0.025 * margin * (1.0 + uYoung) + 0.014 * uYoung;
  }
  vec3 col = tint * light * density * 1.6;
  float refr = gonad ? 0.0 : rim * (inner ? 0.12 : 0.22);
  col += bg * refr;
  float alpha = density * 0.5 + refr;

  // 光を散らしやすい所：輪郭、縁の帯、放射管、生殖腺。
  // 夜はデスクライトの光がここで散って、闇の中に海月の形が浮かぶ（円錐の外では暗い）
  float scatter;
  vec3 scatterTint = uBody;
  if (gonad) {
    scatter = gon * 0.32;
    scatterTint = uGonadTint;
  } else if (inner) {
    scatter = 0.03 * rim + 0.06 * canal + 0.1 * margin;
  } else {
    scatter = 0.06 * rim + 0.2 * margin * (0.4 + 0.6 * rim);
  }
  col += uLampColor * lampSpot(vWorldPos) * scatterTint * scatter * LAMP_SCATTER;

  // 発光（光る種だけ。ミズクラゲは光らないので uGlow は 0）。縮むとわずかに強まる
  float pulseGlow = 0.85 + 0.3 * uContract;
  vec3 glow = (gonad ? uGonad : uGlow) * scatter * pulseGlow;

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
  /** 生殖腺（四つ葉）の層。育つまでは描かない */
  gonadMesh: Mesh;
  /** 縁弁ごとの断面の点列（BellShape.points を毎フレーム書き込み、needsUpdate を立てる） */
  profile: DataTexture;
  contract: { value: number };
  /** 腕の形、放射管、四つ葉（エフィラの育ち具合） */
  form: {
    uArmDepth: { value: number };
    uArmBase: { value: number };
    uArmTip: { value: number };
    uLappet: { value: number };
    uCanals: { value: number };
    uGonads: { value: number };
    uYoung: { value: number };
  };
}

export function createBell(shared: SharedUniforms, look: BellLook): Bell {
  const profile = new DataTexture(new Float32Array(LOBES * (PROFILE_SEGMENTS + 1) * 2), PROFILE_SEGMENTS + 1, LOBES, RGFormat, FloatType);
  profile.minFilter = NearestFilter;
  profile.magFilter = NearestFilter;
  profile.generateMipmaps = false;
  profile.needsUpdate = true;
  const tProfile = { value: profile };
  const contract = { value: 0 };
  const form = {
    uArmDepth: { value: 0 },
    uArmBase: { value: EPHYRA.armBase },
    uArmTip: { value: EPHYRA.armTip },
    uLappet: { value: 0 },
    uCanals: { value: 1 },
    uGonads: { value: 1 },
    uYoung: { value: 0 },
  };
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
        ...lampUniforms(shared),
        ...form,
        tProfile,
        uTime: shared.uTime,
        uContract: contract,
        uLayer: { value: layer },
        uSMax: { value: sMax },
        uInset: { value: inset },
        uGlowPass: shared.uGlowPass,
        uClipMode: shared.uClipMode,
        uKey: shared.uKey,
        uKeyDir: shared.uKeyDir,
        uAmbient: shared.uAmbient,
        tRoom: shared.tRoom,
        uResolution: shared.uResolution,
        uBody: look.uBody,
        uGlow: look.uGlow,
        uGonad: look.uGonad,
        uGonadTint: { value: new Vector3(...JELLY_LOOK.gonad) },
      },
    });
    const m = new Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = order;
    m.matrixAutoUpdate = false;
    return m;
  };

  const gonadMesh = make(gonadGeo, 2, DoubleSide, 34, GONAD_S, 0.07);
  const meshes = [make(bellGeo, 0, BackSide, 32), make(bellGeo, 1, BackSide, 33), gonadMesh, make(bellGeo, 1, FrontSide, 35), make(bellGeo, 0, FrontSide, 36)];
  return { meshes, gonadMesh, profile, contract, form };
}
