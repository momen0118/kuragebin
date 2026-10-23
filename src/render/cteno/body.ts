// カブトクラゲの体の描画。胴・口葉・耳状突起（外の面）、咽頭と平衡器（中）、櫛板（虹）。
// 形は shape.ts で一度だけ求めて頂点に置き、口葉の開閉と耳状突起の波、櫛板の打ち方は頂点シェーダで動かす。
// 光の受け方はミズクラゲの傘（jelly/bell.ts）と同じ考え方：輪郭だけが細く明るく、中は透ける。夜はデスクライトの光が輪郭で散る。
// 櫛板の虹は反射なので、窓の光とライトの光が当たっている所だけに出る（光がなければ見えない）
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
  Vector2,
  Vector3,
  type Side,
} from 'three';
import { CTENO } from '../../config';
import { LAMP_GLSL, lampUniforms } from '../lamp';
import { CLIP_GLSL } from '../shaders/clip';
import common from '../shaders/common.glsl?raw';
import { frag } from '../shaders/glsl';
import type { SharedUniforms } from '../uniforms';
import { auriclePoint, auricleWidth, bodyPoint, lobeAttach, lobeCenter, lobePoint, rowAngles, rowPoints, type CtenoForm } from './shape';

/** 面の部品の番号（シェーダで見分ける） */
const PART = { body: 0, lobe: 1, auricle: 2, gut: 3, statocyst: 4 } as const;

const f3 = (v: number): string => v.toFixed(5);

/** 口葉の開閉：付け根の軸（z と平行）のまわりに回す。side は -1・+1、0 なら回さない */
const SWAY_GLSL = /* glsl */ `
uniform vec2 uSway;
uniform vec2 uPivot;
vec3 swayPoint(vec3 p, float side) {
  if (abs(side) < 0.5) return p;
  float a = side > 0.0 ? uSway.y : -uSway.x;
  vec2 pv = vec2(side * uPivot.x, uPivot.y);
  vec2 d = p.xy - pv;
  float c = cos(a), s = sin(a);
  return vec3(pv + vec2(c * d.x - s * d.y, s * d.x + c * d.y), p.z);
}
vec3 swayDir(vec3 v, float side) {
  if (abs(side) < 0.5) return v;
  float a = side > 0.0 ? uSway.y : -uSway.x;
  float c = cos(a), s = sin(a);
  return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
}
`;

const SHELL_VERT = /* glsl */ `
${common}
${SWAY_GLSL}
uniform float uTime;
uniform float uPhase;
in float aPart;
in float aSide;
in vec2 aUV;
out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec3 vViewNormal;
out vec2 vUV;
out float vPart;
out vec3 vLocal;
void main() {
  vec3 p = swayPoint(position, aSide);
  vec3 n = swayDir(normal, aSide);
  // 耳状突起：繊毛の波が付け根から先へ流れる
  if (abs(aPart - ${PART.auricle.toFixed(1)}) < 0.5) {
    float t = aUV.x;
    p += n * sin(t * 9.0 - (uTime + uPhase) * ${f3(CTENO.auricle.waveSpeed * Math.PI * 2)}) * ${f3(CTENO.auricle.wave)} * t;
  }
  vUV = aUV;
  vLocal = position;
  vPart = aPart;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * n);
  vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ROW_ANGLES = rowAngles();

const SHELL_FRAG = /* glsl */ `
${common}
${LAMP_GLSL}
${CLIP_GLSL}
uniform float uOpacity;
uniform float uDensity;
uniform float uGlowPass;
uniform vec3 uKey, uKeyDir, uAmbient;
uniform vec3 uBody;
uniform sampler2D tRoom;
uniform vec2 uResolution;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vViewNormal;
in vec2 vUV;
in float vPart;
in vec3 vLocal;

const float ROWS[8] = float[8](${ROW_ANGLES.map((a) => f3(a)).join(', ')});

// 櫛板の列の下を走る細い管（胴の上、列の向きに）
float rowCanals(float v, float phi) {
  float c = 0.0;
  for (int i = 0; i < 8; i++) {
    float d = atan(sin(phi - ROWS[i]), cos(phi - ROWS[i]));
    c = max(c, exp(-pow(d * 16.0, 2.0)));
  }
  return c * smoothstep(0.04, 0.12, v);
}

// 口葉の中をうねって走る管：外形に沿って、少し内側をうねりながら一周する。その内側にもう一本、淡く。
// rho は外形への近さ（1 で外形の上）、t は外形の上の位置（輪郭は見る向きで決まる明るさ rim に任せる）
float lobeCanals(float rho, float t) {
  float wave = 0.82 + 0.03 * sin(t * TAU * 3.0 + 0.4);
  float outer = exp(-pow((rho - wave) / 0.025, 2.0));
  float inner = exp(-pow((rho - (0.55 + 0.05 * sin(t * TAU * 2.0 + 1.1))) / 0.025, 2.0)) * 0.4;
  return max(outer, inner);
}

void main() {
  clipToJar(vWorldPos);
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float facing = dot(N, V);
  vec3 Nf = facing < 0.0 ? -N : N;
  float NdV = abs(facing);
  float fres = pow(1.0 - NdV, 2.0);
  float rim = pow(1.0 - NdV, 3.5);
  int part = int(vPart + 0.5);

  // 光：窓からの光が透けて届く。夜はデスクライトの円錐の中だけ
  float wrap = saturate(dot(Nf, uKeyDir) * 0.5 + 0.5);
  float trans = pow(saturate(dot(-V, uKeyDir) * 0.5 + 0.5), 3.0);
  vec3 light = uAmbient * 0.9 + uKey * (0.18 * wrap + 0.35 * trans);
  vec3 Ll = lampDir(vWorldPos);
  float wrapL = saturate(dot(Nf, Ll) * 0.5 + 0.5);
  float transL = pow(saturate(dot(-V, Ll) * 0.5 + 0.5), 3.0);
  float spot = lampSpot(vWorldPos);
  light += uLampColor * spot * (0.18 * wrapL + 0.35 * transL);

  vec2 aspect = vec2(uResolution.y / uResolution.x, 1.0);
  vec2 suv = gl_FragCoord.xy / uResolution + vViewNormal.xy * aspect * 0.025 * fres;
  vec3 bg = texture(tRoom, suv).rgb;

  float density;
  float scatter;
  float refr = rim * 0.2;
  // 後ろを隠す割合（中の咽頭はほとんど隠さない）
  float cover = 0.5;
  vec3 tint = uBody;
  if (part == ${PART.body}) {
    float canal = rowCanals(vUV.x, vUV.y);
    // 頂のまわりは少し濃い（平衡器を囲む極板）
    float pole = exp(-pow(vUV.x / 0.08, 2.0));
    density = 0.004 + 0.16 * rim + 0.02 * canal + 0.02 * pole;
    scatter = 0.05 * rim + 0.08 * canal + 0.05 * pole;
  } else if (part == ${PART.lobe}) {
    float c = lobeCanals(vUV.x, vUV.y);
    // 付け根（胴の中に埋まっている所）は見せない
    float root = 1.0 - smoothstep(-0.13, 0.05, vLocal.y);
    // 袋の中は透けて、管と輪郭だけが光を散らす
    density = (0.002 + 0.045 * rim + 0.03 * c) * root;
    scatter = (0.05 * rim + 0.18 * c) * root;
    refr = rim * 0.04 * root;
    // 袋なので面が重なる。重なっても暗く濁らないように
    cover = 0.22;
  } else if (part == ${PART.auricle}) {
    density = 0.008 + 0.06 * rim;
    scatter = 0.25 + 0.15 * rim;
    refr = 0.0;
  } else if (part == ${PART.gut}) {
    // 咽頭は少しだけ光を散らす平たい管（暗い穴に見えないように）
    density = 0.006 + 0.05 * rim;
    scatter = 0.02 + 0.05 * rim;
    refr = 0.0;
    cover = 0.1;
    tint = uBody * vec3(1.0, 0.96, 0.9);
  } else {
    density = 0.12;
    scatter = 0.4;
    refr = 0.0;
  }
  density *= uDensity;
  vec3 col = tint * light * density * 1.6 + bg * refr;
  col += uLampColor * spot * tint * scatter * ${f3(CTENO.lampScatter)};
  float alpha = density * cover + refr;
  if (uGlowPass > 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  gl_FragColor = vec4(col, alpha) * uOpacity;
}
`;

const PLATE_VERT = /* glsl */ `
${common}
${SWAY_GLSL}
in vec3 aCenter;
in vec3 aTangent;
in vec3 aNormal;
in float aAcross;
in float aAlong;
in float aSide;
in float aFade;
out vec3 vWorldPos;
out vec3 vT;
out vec3 vN;
out float vAcross;
out float vAlong;
out float vFade;
void main() {
  vec3 c = swayPoint(aCenter, aSide);
  vec3 t = normalize(swayDir(aTangent, aSide));
  vec3 n = normalize(swayDir(aNormal, aSide));
  vec3 s = normalize(cross(n, t));
  // 列は胴の面に沿った細い帯。櫛板の一枚一枚は、帯の上で光の返し方として描く
  vec3 p = c + n * ${f3(CTENO.plateLift)} + s * aAcross * ${f3(CTENO.plateWidth * 0.5)};
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vT = normalize(mat3(modelMatrix) * t);
  vN = normalize(mat3(modelMatrix) * n);
  vAcross = aAcross;
  vAlong = aAlong;
  vFade = aFade;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const PLATE_FRAG = /* glsl */ `
${common}
${LAMP_GLSL}
${CLIP_GLSL}
uniform float uOpacity;
uniform float uGlowPass;
uniform float uTime;
uniform float uPhase;
uniform float uBeatPhase;
uniform vec3 uKey, uKeyDir, uAmbient;
in vec3 vWorldPos;
in vec3 vT;
in vec3 vN;
in float vAcross;
in float vAlong;
in float vFade;

vec3 spectrum(float h) {
  return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}

// 板の向きと光と目の向きで色が決まる（回折のつもり）。光をよく返す向きほど明るい
vec3 iridescence(vec3 N, vec3 V, vec3 L) {
  vec3 H = normalize(L + V);
  float c = dot(N, H);
  float h = c * ${f3(CTENO.rainbowSpread)} + vAlong * ${f3(CTENO.rainbowAlong)};
  float k = 0.2 + 0.8 * pow(saturate(abs(c)), 5.0);
  return mix(spectrum(h), vec3(1.0), ${f3(CTENO.rainbowWhite)}) * k;
}

void main() {
  clipToJar(vWorldPos);
  if (uGlowPass > 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec3 t = normalize(vT);
  vec3 n = normalize(vN);
  vec3 s = normalize(cross(n, t));
  // 波：頂の側から口の側へ流れる。速く打って（有効打）、ゆっくり戻る
  float u = fract(vAlong * ${f3(CTENO.beatWaves)} - uBeatPhase);
  float k = ${f3(CTENO.beatStroke)};
  float beta = u < k
    ? mix(-${f3(CTENO.beatSwing)}, ${f3(CTENO.beatSwing)}, smoothstep(0.0, 1.0, u / k))
    : mix(${f3(CTENO.beatSwing)}, -${f3(CTENO.beatSwing)}, smoothstep(0.0, 1.0, (u - k) / (1.0 - k)));
  // 打っている最中（有効打）ほど板が光をよく返す
  float beat = 0.35 + 0.65 * (u < k ? sin(PI * u / k) : 0.25 * (1.0 - (u - k) / (1.0 - k)));
  vec3 up = n * cos(beta) + t * sin(beta);
  vec3 N = normalize(cross(s, up));
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  vec3 col = iridescence(N, V, uKeyDir) * uKey * ${f3(CTENO.rainbowKey)};
  col += iridescence(N, V, lampDir(vWorldPos)) * uLampColor * lampSpot(vWorldPos) * ${f3(CTENO.rainbowLamp)};
  col *= beat;
  // 板は一枚ずつ離れて並ぶ（粒の鎖）。帯の縁はやわらかく
  float d = abs(fract(vAlong / ${f3(CTENO.plateGap)}) - 0.5);
  float comb = 1.0 - smoothstep(${f3(CTENO.plateFill * 0.5 - 0.07)}, ${f3(CTENO.plateFill * 0.5 + 0.03)}, d);
  float edge = (1.0 - smoothstep(0.35, 1.0, abs(vAcross))) * smoothstep(0.0, 1.0, vFade);
  // 光がなくても、ガラスのような細い筋はかすかに見える
  vec3 base = (uAmbient * 0.6 + uKey * 0.05) * 0.05;
  gl_FragColor = vec4((col * comb + base) * edge * uOpacity, 0.0);
}
`;

/** 面の格子を三角形にする（i は列、j は行の数）。outward で外向きの三角形の表をそろえる */
function gridIndices(start: number, rows: number, cols: number, out: number[]): void {
  const w = cols + 1;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = start + i * w + j;
      const b = a + w;
      out.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
}

interface ShellBuild {
  /** 面の内側にある点（外向きを決める） */
  ref: number[];
  pos: number[];
  nrm: number[];
  uv: number[];
  part: number[];
  side: number[];
  idx: number[];
}

function pushVertex(g: ShellBuild, p: Vector3, uv: [number, number], part: number, side: number, inside: Vector3): void {
  g.ref.push(inside.x, inside.y, inside.z);
  g.pos.push(p.x, p.y, p.z);
  g.nrm.push(0, 0, 0);
  g.uv.push(uv[0], uv[1]);
  g.part.push(part);
  g.side.push(side);
}

/** 三角形の向きから頂点の法線を求め、外向き（面の内側の点から離れる向き）に表をそろえる */
function finishShell(g: ShellBuild): BufferGeometry {
  const P = g.pos;
  const idx = g.idx;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const mid = new Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    a.fromArray(P, idx[t]! * 3);
    b.fromArray(P, idx[t + 1]! * 3);
    c.fromArray(P, idx[t + 2]! * 3);
    n.subVectors(b, a).cross(c.clone().sub(a));
    mid.addVectors(a, b).add(c).multiplyScalar(1 / 3);
    const inside = new Vector3()
      .fromArray(g.ref, idx[t]! * 3)
      .add(new Vector3().fromArray(g.ref, idx[t + 1]! * 3))
      .add(new Vector3().fromArray(g.ref, idx[t + 2]! * 3))
      .multiplyScalar(1 / 3);
    const out = mid.clone().sub(inside);
    if (out.lengthSq() > 1e-8 && n.dot(out) < 0) {
      const i1 = idx[t + 1]!;
      idx[t + 1] = idx[t + 2]!;
      idx[t + 2] = i1;
      n.negate();
    }
    for (const k of [idx[t]!, idx[t + 1]!, idx[t + 2]!]) {
      g.nrm[k * 3] = g.nrm[k * 3]! + n.x;
      g.nrm[k * 3 + 1] = g.nrm[k * 3 + 1]! + n.y;
      g.nrm[k * 3 + 2] = g.nrm[k * 3 + 2]! + n.z;
    }
  }
  // 同じ所にある頂点（一周の継ぎ目と、頂）は法線をそろえる。そろえないと継ぎ目が筋になって見える
  const same = new Map<string, number[]>();
  for (let k = 0; k < P.length / 3; k++) {
    const key = `${g.part[k]}|${g.side[k]}|${P[k * 3]!.toFixed(5)},${P[k * 3 + 1]!.toFixed(5)},${P[k * 3 + 2]!.toFixed(5)}`;
    const list = same.get(key);
    if (list) list.push(k);
    else same.set(key, [k]);
  }
  for (const list of same.values()) {
    if (list.length < 2) continue;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const k of list) {
      x += g.nrm[k * 3]!;
      y += g.nrm[k * 3 + 1]!;
      z += g.nrm[k * 3 + 2]!;
    }
    for (const k of list) {
      g.nrm[k * 3] = x;
      g.nrm[k * 3 + 1] = y;
      g.nrm[k * 3 + 2] = z;
    }
  }
  for (let k = 0; k < g.nrm.length; k += 3) {
    n.set(g.nrm[k]!, g.nrm[k + 1]!, g.nrm[k + 2]!).normalize();
    g.nrm[k] = n.x;
    g.nrm[k + 1] = n.y;
    g.nrm[k + 2] = n.z;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(g.pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(g.nrm, 3));
  geo.setAttribute('aUV', new Float32BufferAttribute(g.uv, 2));
  geo.setAttribute('aPart', new Float32BufferAttribute(g.part, 1));
  geo.setAttribute('aSide', new Float32BufferAttribute(g.side, 1));
  geo.setIndex(idx);
  return geo;
}

/** 外の面：胴・口葉2枚・耳状突起4つ */
function shellGeometry(f: CtenoForm): BufferGeometry {
  const g: ShellBuild = { ref: [], pos: [], nrm: [], uv: [], part: [], side: [], idx: [] };
  const p = new Vector3();
  const inside = new Vector3();
  // 胴（頂から下端まで、まわり一周）
  const V = 40;
  const U = 56;
  let start = 0;
  for (let i = 0; i <= V; i++) {
    const v = Math.max(i / V, 0.002);
    for (let j = 0; j <= U; j++) {
      const phi = (j / U) * Math.PI * 2;
      pushVertex(g, bodyPoint(f, v, phi, p), [v, phi], PART.body, 0, inside.set(0, p.y, 0));
    }
  }
  gridIndices(start, V, U, g.idx);
  // 口葉（前の面の真ん中から外形を通って後ろの面の真ん中まで、外形を一周）。uv は外形への近さ（sin ψ）と外形の上の位置 t
  for (const side of [-1, 1] as const) {
    start = g.pos.length / 3;
    const NP = 24;
    const NT = 96;
    lobeCenter(f, side, inside);
    for (let i = 0; i <= NP; i++) {
      const psi = Math.max((i / NP) * Math.PI, 1e-4);
      for (let j = 0; j <= NT; j++) {
        const t = j / NT;
        pushVertex(g, lobePoint(f, side, t, psi, p), [Math.sin(psi), t], PART.lobe, side, inside);
      }
    }
    gridIndices(start, NP, NT, g.idx);
  }
  // 耳状突起（芯に沿った細い帯。帯の面は x の向き）
  for (let k = 0; k < 4; k++) {
    start = g.pos.length / 3;
    const NT = 12;
    const q = new Vector3();
    for (let i = 0; i <= NT; i++) {
      const t = i / NT;
      auriclePoint(f, k, t, q);
      const w = auricleWidth(t);
      for (const s of [-1, 1]) pushVertex(g, p.copy(q).add(new Vector3(0, s * w * 0.5, s * w * 0.3)), [t, s], PART.auricle, 0, inside.set(0, q.y, 0));
    }
    gridIndices(start, NT, 1, g.idx);
  }
  return finishShell(g);
}

/** 中：咽頭（平たい管）と、頂の平衡器（小さな粒） */
function innerGeometry(): BufferGeometry {
  const g: ShellBuild = { ref: [], pos: [], nrm: [], uv: [], part: [], side: [], idx: [] };
  const p = new Vector3();
  const inside = new Vector3();
  const ellipsoid = (cy: number, ry: number, rx: number, rz: number, part: number, n: number): void => {
    const start = g.pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * Math.PI;
      for (let j = 0; j <= n; j++) {
        const ph = (j / n) * Math.PI * 2;
        p.set(Math.sin(th) * Math.cos(ph) * rx, cy + Math.cos(th) * ry, Math.sin(th) * Math.sin(ph) * rz);
        pushVertex(g, p, [i / n, j / n], part, 0, inside.set(0, cy, 0));
      }
    }
    gridIndices(start, n, n, g.idx);
  };
  const G = CTENO.gut;
  ellipsoid((G.top + G.bottom) / 2, (G.top - G.bottom) / 2, G.width, G.depth, PART.gut, 16);
  const S = CTENO.statocyst;
  ellipsoid(S.y, S.radius, S.radius, S.radius, PART.statocyst, 8);
  return finishShell(g);
}

/** 櫛板の列：8本の細い帯（列に沿って細かく区切り、横は2頂点） */
function plateGeometry(f: CtenoForm): BufferGeometry {
  const center: number[] = [];
  const tangent: number[] = [];
  const normal: number[] = [];
  const across: number[] = [];
  const along: number[] = [];
  const side: number[] = [];
  const fade: number[] = [];
  const idx: number[] = [];
  let n = 0;
  for (let r = 0; r < 8; r++) {
    const pts = rowPoints(f, r, CTENO.plateGap * 0.5);
    // 帯の端（列の始まりと終わり、胴から口葉へ移る所）は少しずつ消す
    const ends: number[] = [];
    pts.forEach((pt, i) => {
      if (i === 0 || pts[i - 1]!.side !== pt.side) ends.push(pt.along);
      if (i === pts.length - 1 || pts[i + 1]!.side !== pt.side) ends.push(pt.along);
    });
    pts.forEach((pt, i) => {
      const d = Math.min(...ends.map((e) => Math.abs(pt.along - e)));
      for (const a of [-1, 1]) {
        fade.push(Math.min(1, d / 0.03));
        center.push(pt.pos.x, pt.pos.y, pt.pos.z);
        tangent.push(pt.tangent.x, pt.tangent.y, pt.tangent.z);
        normal.push(pt.normal.x, pt.normal.y, pt.normal.z);
        across.push(a);
        along.push(pt.along);
        side.push(pt.side);
      }
      // 胴から口葉へ移る所（side が変わる所）はつながない
      if (i > 0 && pts[i - 1]!.side === pt.side) idx.push(n - 2, n - 1, n, n, n - 1, n + 1);
      n += 2;
    });
  }
  const geo = new BufferGeometry();
  // position は使わない（three.js が頂点の数を知るため）
  geo.setAttribute('position', new Float32BufferAttribute(center.slice(), 3));
  geo.setAttribute('aCenter', new Float32BufferAttribute(center, 3));
  geo.setAttribute('aTangent', new Float32BufferAttribute(tangent, 3));
  geo.setAttribute('aNormal', new Float32BufferAttribute(normal, 3));
  geo.setAttribute('aAcross', new Float32BufferAttribute(across, 1));
  geo.setAttribute('aAlong', new Float32BufferAttribute(along, 1));
  geo.setAttribute('aSide', new Float32BufferAttribute(side, 1));
  geo.setAttribute('aFade', new Float32BufferAttribute(fade, 1));
  geo.setIndex(idx);
  return geo;
}

export interface CtenoLook {
  uOpacity: { value: number };
  uDensity: { value: number };
  uBody: { value: Vector3 };
  /** 口葉の開き（[-x の側, +x の側]、ラジアン）と、開閉の軸（付け根の x と y） */
  uSway: { value: Vector2 };
  uPivot: { value: Vector2 };
  /** 個体ごとの時間のずれ（耳状突起の波）と、櫛板の波の位相（泳ぎが押し出す強さに合わせて進める） */
  uPhase: { value: number };
  uBeatPhase: { value: number };
}

export interface CtenoBody {
  meshes: Mesh[];
  look: CtenoLook;
  geometries: BufferGeometry[];
}

/** 体を作る。form は形（個体差を含む）、phase は個体ごとの時間のずれ */
export function createCtenoBody(shared: SharedUniforms, form: CtenoForm, phase: number): CtenoBody {
  const attach = lobeAttach(form);
  const look: CtenoLook = {
    uOpacity: { value: 1 },
    uDensity: { value: CTENO.density * form.density },
    uBody: { value: new Vector3(...CTENO.color) },
    uSway: { value: new Vector2() },
    uPivot: { value: new Vector2(attach.x, CTENO.lobe.attach) },
    uPhase: { value: phase },
    uBeatPhase: { value: 0 },
  };
  const shell = shellGeometry(form);
  const inner = innerGeometry();
  const plates = plateGeometry(form);
  const common = {
    ...lampUniforms(shared),
    uTime: shared.uTime,
    uGlowPass: shared.uGlowPass,
    uClipMode: shared.uClipMode,
    uKey: shared.uKey,
    uKeyDir: shared.uKeyDir,
    uAmbient: shared.uAmbient,
    uOpacity: look.uOpacity,
    uSway: look.uSway,
    uPivot: look.uPivot,
    uPhase: look.uPhase,
  };
  const shellMat = (side: Side): ShaderMaterial =>
    new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: SHELL_VERT,
      fragmentShader: frag(SHELL_FRAG),
      side,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      uniforms: { ...common, uDensity: look.uDensity, uBody: look.uBody, tRoom: shared.tRoom, uResolution: shared.uResolution },
    });
  const plateMat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: PLATE_VERT,
    fragmentShader: frag(PLATE_FRAG),
    side: DoubleSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // 足すだけ（光を返すだけで、後ろを隠さない）
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    uniforms: { ...common, uBeatPhase: look.uBeatPhase },
  });
  const mesh = (geo: BufferGeometry, mat: ShaderMaterial, order: number): Mesh => {
    const m = new Mesh(geo, mat);
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    m.renderOrder = order;
    return m;
  };
  // 奥の面 → 中 → 櫛板 → 手前の面
  const meshes = [mesh(shell, shellMat(BackSide), 0), mesh(inner, shellMat(DoubleSide), 0.1), mesh(plates, plateMat, 0.2), mesh(shell, shellMat(FrontSide), 0.3)];
  return { meshes, look, geometries: [shell, inner, plates] };
}
