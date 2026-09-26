// カップ。薄い透明なプラスチックの計量カップ（飾りのない形）で、海月を水ごとすくって隣の瓶へ注ぐ。
// 形はカップの底の真ん中が原点、上が +y、注ぎ口は +x の側。姿勢（位置と向き）は描画側が毎フレーム決める。
// 描くもの：奥の壁（内側。水の入った所は、背景が水で曲がって見える）、水面、手前の壁、注ぐ水の筋。
// 瓶の口より下の部分は瓶の中身として、上の部分は背景に重ねて描く（shaders/clip.ts）。
import {
  BackSide,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  GLSL3,
  Group,
  Matrix4,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { CUP, JAR } from '../config';
import { LAMP_GLSL, lampUniforms } from './lamp';
import { CLIP_GLSL } from './shaders/clip';
import common from './shaders/common.glsl?raw';
import { frag } from './shaders/glsl';
import type { SharedUniforms } from './uniforms';

const RB = CUP.radiusBottom;
const RT = CUP.radiusTop;
const H = CUP.height;

/** 高さ y（カップの中）での内側の半径 */
export function cupRadiusAt(y: number): number {
  return RB + (RT - RB) * Math.min(Math.max(y / H, 0), 1);
}

/** 注ぎ口の出っ張り（角度 th、+x が 0）。0〜1 */
function spoutAt(th: number): number {
  let a = th;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return Math.exp(-((a / CUP.spoutWidth) ** 2));
}

/** 注ぎ口の先（カップの中、縁のいちばん外） */
export const SPOUT_LIP = new Vector3(RT + CUP.spout + 0.004, H - CUP.spoutDip, 0);

/** カップの面（1枚の薄い面）。断面を底の真ん中から口の縁まで回し、注ぎ口の所だけ外へ引き出す */
function cupGeometry(): BufferGeometry {
  type P = [number, number];
  const prof: P[] = [];
  const c = CUP.corner;
  for (let i = 0; i <= 3; i++) prof.push([((RB - c) * i) / 3, 0]);
  for (let i = 1; i <= 6; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / 6);
    prof.push([RB - c + c * Math.cos(a), c + c * Math.sin(a)]);
  }
  const wall = 14;
  for (let i = 1; i <= wall; i++) {
    const y = c + ((H - c) * i) / wall;
    prof.push([cupRadiusAt(y), y]);
  }
  // 口の縁は少し外へ丸める
  prof.push([RT + 0.002, H + 0.0015], [RT + 0.0036, H + 0.0004], [RT + 0.0042, H - 0.002]);
  const n = prof.length;
  const seg = 72;
  const pos: number[] = [];
  const along: number[] = [];
  for (let i = 0; i < n; i++) {
    const [r0, y0] = prof[i]!;
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const sp = spoutAt(th);
      const lift = Math.min(Math.max((y0 - (H - CUP.spoutDepth)) / CUP.spoutDepth, 0), 1);
      const k = lift * lift * (3 - 2 * lift);
      const r = r0 + CUP.spout * sp * k;
      const y = y0 - CUP.spoutDip * sp * (i >= n - 3 ? 1 : k);
      pos.push(r * Math.cos(th), y, r * Math.sin(th));
      along.push(i / (n - 1));
    }
  }
  const row = seg + 1;
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // 法線は格子の隣どうしから（外向き）
  const nrm = new Float32Array(pos.length);
  const P = (i: number, j: number): Vector3 => {
    const k = (Math.min(Math.max(i, 0), n - 1) * row + ((j + seg) % seg)) * 3;
    return new Vector3(pos[k]!, pos[k + 1]!, pos[k + 2]!);
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= seg; j++) {
      const du = P(i + 1, j).sub(P(i - 1, j));
      const dv = P(i, j + 1).sub(P(i, j - 1));
      const nn = new Vector3().crossVectors(dv, du);
      if (i === 0 || nn.lengthSq() < 1e-12) nn.set(0, -1, 0);
      nn.normalize();
      const k = (i * row + j) * 3;
      nrm[k] = nn.x;
      nrm[k + 1] = nn.y;
      nrm[k + 2] = nn.z;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setAttribute('along', new Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  return g;
}

/** 円盤（半径 1、y = 0）。水面に使う */
function unitDisk(rings: number, seg: number): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const r = i / rings;
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      pos.push(r * Math.cos(th), 0, r * Math.sin(th));
    }
  }
  const row = seg + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const DEFS = /* glsl */ `
#define CUP_RB ${RB.toFixed(5)}
#define CUP_RT ${RT.toFixed(5)}
#define CUP_H ${H.toFixed(5)}
#define WATER_Y ${JAR.waterLevel.toFixed(5)}
#define FRESNEL_GAIN ${CUP.fresnel.toFixed(4)}
#define BODY ${CUP.body.toFixed(4)}
#define IN_WATER ${CUP.inWater.toFixed(4)}
#define LENS_FLIP ${CUP.lensFlip.toFixed(4)}
#define WATER_TINT vec3(${CUP.waterTint.map((v) => v.toFixed(3)).join(', ')})
`;

const LIGHT = /* glsl */ `
uniform vec3 uKey, uKeyDir, uAmbient;
// 部屋の映り込みの代わり：部屋は暗く、窓（左）の方向だけが明るい
vec3 envColor(vec3 R) {
  float up = R.y * 0.5 + 0.5;
  vec3 base = uAmbient * (0.12 + 0.3 * up);
  float win = pow(max(dot(R, uKeyDir), 0.0), 12.0);
  return base + uKey * win * 0.7;
}
// 瓶の水の中か（瓶の中で、水面より下）
bool inJarWater(vec3 p) {
  return insideJar(p) && p.y < WATER_Y;
}
`;

const WALL_VERT = /* glsl */ `
in float along;
out vec3 vWorldPos;
out vec3 vWorldNormal;
out float vAlong;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vAlong = along;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * カップの壁。uSide が 0 で奥の壁（内側から見る）、1 で手前の壁。
 * 縁で反射が強まり（フレネル）、窓やデスクライトのハイライトが細く乗る。口の縁と、水面が壁に触れる線は少し明るい。
 * 奥の壁の水の入った所は、背景に重ねるパスでは背景が水で曲がって見える（左右が反転して詰まる）
 */
const WALL_FRAG = /* glsl */ `
${common}
${LAMP_GLSL}
${CLIP_GLSL}
${DEFS}
${LIGHT}
uniform sampler2D tRoom;
uniform vec2 uResolution;
uniform float uAlpha, uWaterY, uSide;
uniform vec2 uAxisA, uAxisB;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in float vAlong;
void main() {
  clipToJar(vWorldPos);
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float facing = dot(N, V);
  vec3 Nf = facing < 0.0 ? -N : N;
  float NdV = abs(facing);
  float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  bool wet = inJarWater(vWorldPos);
  float k = wet ? IN_WATER : 1.0;
  vec3 R = reflect(-V, Nf);
  vec3 lampC = uLampColor * lampSpot(vWorldPos);
  vec3 L = lampDir(vWorldPos);
  float spec = pow(max(dot(R, normalize(uKeyDir)), 0.0), 70.0);
  float lspec = pow(max(dot(R, L), 0.0), 60.0);
  vec3 col = (envColor(R) * F * FRESNEL_GAIN + uKey * spec * 0.7 + lampC * lspec * 1.2) * k;
  float a = (F * 0.85 + BODY) * k;
  // 口の縁は細く明るい
  float rim = smoothstep(0.9, 1.0, vAlong);
  col += (uAmbient * 0.5 + uKey * 0.3 + lampC * 0.6) * rim * 0.7 * k;
  a += rim * 0.3 * k;
  // 水面が壁に触れる線（瓶の水に沈んでいるときは見えない）
  if (!wet) {
    float men = exp(-pow((vWorldPos.y - uWaterY) / 0.0028, 2.0));
    col += (uAmbient * 0.7 + uKey * 0.35 + lampC * 0.8) * men * 0.55;
    a += men * 0.3;
  }
  // 奥の壁の水の入った所：背景が水で曲がって見える（背景に重ねるパスだけ）
  if (uSide < 0.5 && uClipMode > 1.5 && vWorldPos.y < uWaterY) {
    vec2 p = gl_FragCoord.xy;
    vec2 d = uAxisB - uAxisA;
    float t = clamp(dot(p - uAxisA, d) / max(dot(d, d), 1.0), 0.0, 1.0);
    vec2 c = uAxisA + d * t;
    vec2 s = (c + (p - c) * LENS_FLIP) / uResolution;
    vec3 bg = texture(tRoom, clamp(s, vec2(0.001), vec2(0.999))).rgb * WATER_TINT;
    col += bg * (1.0 - min(a, 1.0));
    a = 1.0;
  }
  a = min(a, 1.0);
  gl_FragColor = vec4(col * uAlpha, a * uAlpha);
}
`;

const WATER_VERT = /* glsl */ `
out vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * カップの中の水面（いつも水平）。カップの内側だけに描く。
 * 下から見上げると、水面は鏡のように明るく見える（全反射）
 */
const WATER_FRAG = /* glsl */ `
${common}
${LAMP_GLSL}
${CLIP_GLSL}
${DEFS}
${LIGHT}
uniform mat4 uCupInv;
uniform float uAlpha;
in vec3 vWorldPos;
void main() {
  clipToJar(vWorldPos);
  vec3 q = (uCupInv * vec4(vWorldPos, 1.0)).xyz;
  float r = mix(CUP_RB, CUP_RT, clamp(q.y / CUP_H, 0.0, 1.0)) - 0.0025;
  if (q.y < 0.0 || q.y > CUP_H || length(q.xz) > r) discard;
  if (inJarWater(vWorldPos)) discard;
  vec3 lampC = uLampColor * lampSpot(vWorldPos);
  bool below = cameraPosition.y < vWorldPos.y;
  float edge = smoothstep(r * 0.75, r, length(q.xz));
  vec3 col = below ? uAmbient * 0.8 + uKey * 0.3 + lampC * 0.7 : uAmbient * 0.3 + uKey * 0.08 + lampC * 0.3;
  float a = (below ? 0.34 : 0.12) + edge * 0.15;
  gl_FragColor = vec4(col * a * uAlpha, a * uAlpha);
}
`;

const STREAM_VERT = /* glsl */ `
in float across;
in float alongS;
in float strength;
out vec3 vWorldPos;
out float vAcross;
out float vAlongS;
out float vStrength;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vAcross = across;
  vAlongS = alongS;
  vStrength = strength;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** 注ぐ水の筋。縁ほど明るい細い帯で、中は透ける */
const STREAM_FRAG = /* glsl */ `
${common}
${LAMP_GLSL}
${CLIP_GLSL}
${DEFS}
${LIGHT}
uniform float uAlpha;
uniform float uTime;
in vec3 vWorldPos;
in float vAcross;
in float vAlongS;
in float vStrength;
void main() {
  clipToJar(vWorldPos);
  if (inJarWater(vWorldPos)) discard;
  float x = abs(vAcross);
  float edge = smoothstep(0.35, 0.9, x) * (1.0 - smoothstep(0.9, 1.0, x));
  float core = 1.0 - smoothstep(0.0, 1.0, x);
  // 流れに沿って、細かい揺らぎがゆっくり下へ流れる
  float flow = 0.75 + 0.25 * sin(vAlongS * 90.0 - uTime * 14.0 + vAcross * 2.0);
  vec3 lampC = uLampColor * lampSpot(vWorldPos);
  vec3 light = uAmbient * 0.9 + uKey * 0.45 + lampC * 0.9;
  vec3 col = light * (edge * 0.9 + core * 0.15) * flow;
  float a = (edge * 0.55 + core * 0.12) * vStrength;
  gl_FragColor = vec4(col * vStrength * uAlpha, a * uAlpha);
}
`;

function premultiplied(m: ShaderMaterial): ShaderMaterial {
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  return m;
}

/** 注ぐ水の筋の分かれ目の数 */
const STREAM_N = 28;

/** カップの中の容積に一様に散らした点（水の量から水面の高さを出すのに使う） */
function volumeSamples(n: number): Float32Array {
  const out = new Float32Array(n * 3);
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  let k = 0;
  while (k < n) {
    const y = rnd() * H;
    const r = cupRadiusAt(y);
    const x = (rnd() * 2 - 1) * r;
    const z = (rnd() * 2 - 1) * r;
    if (x * x + z * z > r * r) continue;
    out[k * 3] = x;
    out[k * 3 + 1] = y;
    out[k * 3 + 2] = z;
    k++;
  }
  return out;
}

export class Cup {
  /** カップの壁と水面・水の筋をまとめたもの（瓶1つの座標で描く） */
  readonly group = new Group();
  /** カップ本体（姿勢はここに入れる） */
  private readonly body = new Group();
  private readonly waterMesh: Mesh;
  private readonly streamMesh: Mesh;
  private readonly streamGeo: BufferGeometry;
  private readonly uniforms;
  private readonly samples = volumeSamples(1600);
  private readonly heights = new Float32Array(1600);
  private readonly tmpM = new Matrix4();
  private readonly tmpV = new Vector3();
  private readonly tmpV2 = new Vector3();

  constructor(shared: SharedUniforms) {
    this.uniforms = {
      ...lampUniforms(shared),
      uKey: shared.uKey,
      uKeyDir: shared.uKeyDir,
      uAmbient: shared.uAmbient,
      uClipMode: shared.uClipMode,
      uTime: shared.uTime,
      tRoom: shared.tRoom,
      uResolution: shared.uResolution,
      uAlpha: { value: 1 },
      uWaterY: { value: -10 },
      uAxisA: { value: new Vector2() },
      uAxisB: { value: new Vector2() },
      uCupInv: { value: new Matrix4() },
    };
    const geo = cupGeometry();
    const wall = (side: number): ShaderMaterial =>
      premultiplied(
        new ShaderMaterial({
          glslVersion: GLSL3,
          vertexShader: WALL_VERT,
          fragmentShader: frag(WALL_FRAG),
          side: side === 0 ? BackSide : FrontSide,
          uniforms: { ...this.uniforms, uSide: { value: side } },
        }),
      );
    const back = new Mesh(geo, wall(0));
    back.renderOrder = 20;
    const front = new Mesh(geo, wall(1));
    front.renderOrder = 80;
    this.body.add(back, front);

    this.waterMesh = new Mesh(
      unitDisk(8, 72),
      premultiplied(
        new ShaderMaterial({
          glslVersion: GLSL3,
          vertexShader: WATER_VERT,
          fragmentShader: frag(WATER_FRAG),
          side: DoubleSide,
          uniforms: this.uniforms,
        }),
      ),
    );
    this.waterMesh.renderOrder = 21;

    const verts = (STREAM_N + 1) * 2;
    this.streamGeo = new BufferGeometry();
    this.streamGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(verts * 3), 3));
    this.streamGeo.setAttribute('across', new Float32BufferAttribute(new Float32Array(verts), 1));
    this.streamGeo.setAttribute('alongS', new Float32BufferAttribute(new Float32Array(verts), 1));
    this.streamGeo.setAttribute('strength', new Float32BufferAttribute(new Float32Array(verts), 1));
    const sidx: number[] = [];
    for (let i = 0; i < STREAM_N; i++) {
      const a = i * 2;
      sidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.streamGeo.setIndex(sidx);
    const across = this.streamGeo.getAttribute('across') as Float32BufferAttribute;
    for (let i = 0; i <= STREAM_N; i++) {
      across.setX(i * 2, -1);
      across.setX(i * 2 + 1, 1);
    }
    this.streamMesh = new Mesh(
      this.streamGeo,
      premultiplied(
        new ShaderMaterial({
          glslVersion: GLSL3,
          vertexShader: STREAM_VERT,
          fragmentShader: frag(STREAM_FRAG),
          side: DoubleSide,
          uniforms: this.uniforms,
        }),
      ),
    );
    this.streamMesh.renderOrder = 81;
    this.streamMesh.frustumCulled = false;
    this.streamMesh.visible = false;
    this.waterMesh.frustumCulled = false;
    this.group.add(this.body, this.waterMesh, this.streamMesh);
    this.group.visible = false;
  }

  /** 見え方の濃さ（現れる・消えるとき）。0 なら描かない */
  setAlpha(a: number): void {
    this.uniforms.uAlpha.value = a;
    this.group.visible = a > 1e-3;
  }

  /** 姿勢：カップの底の真ん中の位置と、向き */
  setPose(bottom: Vector3, quat: Quaternion): void {
    this.body.position.copy(bottom);
    this.body.quaternion.copy(quat);
    this.body.updateMatrixWorld(true);
    this.uniforms.uCupInv.value.copy(this.body.matrixWorld).invert();
  }

  /** 姿勢から、カップの中の点 local の位置（ワールド） */
  toWorld(local: Vector3, out: Vector3): Vector3 {
    return out.copy(local).applyQuaternion(this.body.quaternion).add(this.body.position);
  }

  /**
   * 今の姿勢で、中の水の量 fill（容積に対する割合）のときの水面の高さ（ワールド）と、
   * こぼれずに入っていられる量の上限。上限を越えた分は注ぎ口からこぼれる
   */
  waterFor(fill: number): { level: number; max: number } {
    const q = this.body.quaternion;
    // 回したときの y だけを求める（行列の2行目）
    this.tmpM.makeRotationFromQuaternion(q);
    const e = this.tmpM.elements;
    const ax = e[1]!;
    const ay = e[5]!;
    const az = e[9]!;
    const n = this.heights.length;
    const s = this.samples;
    for (let i = 0; i < n; i++) this.heights[i] = s[i * 3]! * ax + s[i * 3 + 1]! * ay + s[i * 3 + 2]! * az;
    this.heights.sort();
    // 口の縁のいちばん低い所（注ぎ口）より上には入っていられない
    const lip = SPOUT_LIP.x * ax + SPOUT_LIP.y * ay + SPOUT_LIP.z * az;
    let below = 0;
    while (below < n && this.heights[below]! < lip) below++;
    const max = below / n;
    const f = Math.min(Math.max(fill, 0), max);
    const idx = Math.min(Math.max(Math.round(f * n) - 1, 0), n - 1);
    const level = f <= 0 ? -10 : this.body.position.y + this.heights[idx]!;
    return { level, max };
  }

  /** 水面の高さ（ワールド）。-10 なら水なし。瓶の水に沈んでいる間は瓶の水面に合わせる */
  setWater(level: number): void {
    this.uniforms.uWaterY.value = level;
    const m = this.waterMesh;
    if (level < -1) {
      m.visible = false;
      return;
    }
    m.visible = true;
    // カップの軸が水面と交わる所を中心に、傾いていても内側を覆う大きさの円盤
    const up = this.tmpV.set(0, 1, 0).applyQuaternion(this.body.quaternion);
    const base = this.body.position;
    const t = Math.abs(up.y) > 0.2 ? (level - base.y) / up.y : H * 0.5;
    const c = this.tmpV2.copy(base).addScaledVector(up, Math.min(Math.max(t, 0), H));
    m.position.set(c.x, level, c.z);
    m.scale.setScalar(RT * 2.2 + 0.05);
    m.updateMatrixWorld(true);
  }

  /** 注ぎ口の先（ワールド） */
  lip(out: Vector3): Vector3 {
    return this.toWorld(SPOUT_LIP, out);
  }

  /** カップの軸の両端を画面へ（背景が水で曲がって見える所を決める）。描く前に、そのカメラで呼ぶ */
  prepare(cam: PerspectiveCamera): void {
    const res = this.uniforms.uResolution.value;
    const toPx = (v: Vector3, out: Vector2): void => {
      v.project(cam);
      out.set(((v.x + 1) / 2) * res.x, ((v.y + 1) / 2) * res.y);
    };
    toPx(this.toWorld(this.tmpV.set(0, 0, 0), this.tmpV), this.uniforms.uAxisA.value);
    toPx(this.toWorld(this.tmpV.set(0, H, 0), this.tmpV), this.uniforms.uAxisB.value);
  }

  /**
   * 注ぐ水の筋。points は注ぎ口から水面までの線（ワールド）、widths は太さ、strength は濃さ。
   * camPos は描くカメラの位置（帯をカメラへ向ける）。points が空なら消す
   */
  setStream(points: readonly Vector3[], widths: readonly number[], strength: readonly number[], camPos: Vector3): void {
    if (points.length < 2) {
      this.streamMesh.visible = false;
      return;
    }
    this.streamMesh.visible = true;
    const pos = this.streamGeo.getAttribute('position') as Float32BufferAttribute;
    const al = this.streamGeo.getAttribute('alongS') as Float32BufferAttribute;
    const st = this.streamGeo.getAttribute('strength') as Float32BufferAttribute;
    const last = points.length - 1;
    const tan = new Vector3();
    const view = new Vector3();
    const side = new Vector3();
    for (let i = 0; i <= STREAM_N; i++) {
      const u = (i / STREAM_N) * last;
      const k = Math.min(Math.floor(u), last - 1);
      const f = u - k;
      const p = new Vector3().lerpVectors(points[k]!, points[k + 1]!, f);
      tan.subVectors(points[k + 1]!, points[k]!).normalize();
      view.subVectors(camPos, p).normalize();
      side.crossVectors(tan, view).normalize();
      const w = (widths[k]! * (1 - f) + widths[k + 1]! * f) * 0.5;
      const s = strength[k]! * (1 - f) + strength[k + 1]! * f;
      pos.setXYZ(i * 2, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      pos.setXYZ(i * 2 + 1, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      al.setX(i * 2, i / STREAM_N);
      al.setX(i * 2 + 1, i / STREAM_N);
      st.setX(i * 2, s);
      st.setX(i * 2 + 1, s);
    }
    pos.needsUpdate = true;
    al.needsUpdate = true;
    st.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as ShaderMaterial).dispose();
      }
    });
  }
}
