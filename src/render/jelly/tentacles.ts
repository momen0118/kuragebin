// 縁触手。張りのない細く柔らかい糸（verlet の鎖で長さだけを保つ）。
// 重力と水の抵抗にまかせて垂れ、泳げば後ろにたなびき、止まればゆっくり落ちて垂れ下がる。
// 描くときは画面上で一定の太さの細い帯にする。
import {
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  GLSL3,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  type Vector3,
} from 'three';
import { BELL, JAR, JELLY_LOOK, TENTACLES } from '../../config';
import { LOBES } from './profile';
import type { Rng } from '../../sim/rng';
import type { SharedUniforms } from '../uniforms';
import { LAMP_GLSL, lampUniforms } from '../lamp';
import type { BellLook } from './bell';
import { frag } from '../shaders/glsl';

const INNER_R = JAR.radius - JAR.glassThickness;

const VERT = /* glsl */ `
in vec3 aTangent;
in float aSide;
in float aT;
in float aSeed;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uWidth;
out float vSide;
out float vT;
out float vSeed;
out float vThin;
out vec3 vWorldPos;
void main() {
  vec4 c0 = projectionMatrix * viewMatrix * vec4(position, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(position + aTangent * 0.01, 1.0);
  vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * uResolution;
  float l = length(d);
  d = l > 1e-5 ? d / l : vec2(0.0, 1.0);
  vec2 n = vec2(-d.y, d.x);
  // 1.5px より細い線は太さを保ったまま薄くしてちらつきを防ぐ
  float want = uWidth * uPixelRatio * mix(1.0, 0.5, aT) * (0.7 + 0.6 * aSeed);
  float w = max(want, 1.5);
  vThin = want / w;
  c0.xy += n * aSide * w / uResolution * c0.w;
  gl_Position = c0;
  vSide = aSide;
  vT = aT;
  vSeed = aSeed;
  vWorldPos = position;
}
`;

const FRAG = /* glsl */ `
${LAMP_GLSL}
uniform float uGlowPass;
uniform float uBrightness;
uniform vec3 uKey, uAmbient;
uniform vec3 uBody, uGlow;
in float vSide;
in float vT;
in float vSeed;
in float vThin;
in vec3 vWorldPos;
void main() {
  float across = exp(-vSide * vSide * 2.5);
  float along = (1.0 - smoothstep(0.4, 1.0, vT)) * (0.5 + 0.5 * smoothstep(0.0, 0.1, vT));
  float a = across * along * vThin * (0.45 + 0.55 * vSeed) * uBrightness;
  float scatter = a * (0.08 + 0.14 * (1.0 - vT));
  vec3 glow = uGlow * scatter;
  if (uGlowPass > 0.5) {
    gl_FragColor = vec4(glow, 0.0);
    return;
  }
  vec3 light = uAmbient * 0.9 + uKey * 0.3 + uLampColor * lampSpot(vWorldPos) * 0.3;
  // 夜はデスクライトの光が細い糸で散って、ほのかに見える
  vec3 col = uBody * light * a * 0.6 + glow + uBody * uLampColor * lampSpot(vWorldPos) * scatter * ${JELLY_LOOK.lampScatter.toFixed(3)};
  gl_FragColor = vec4(col, a * 0.15);
}
`;

/**
 * 細い糸の束を描くメッシュ（縁触手と、ポリプの触手）。count 本 × nodes 節。
 * 糸は画面上で一定の太さの帯にする（widthPx は画面px）。seeds は1本ずつの太さ・明るさのばらつき（0〜1）
 */
export function createStrandMesh(
  shared: SharedUniforms,
  look: Pick<BellLook, 'uBody' | 'uGlow'>,
  n: number,
  m: number,
  seeds: Float32Array,
  widthPx: number,
  brightness: number,
): Mesh {
  const verts = n * m * 2;
  const geo = new BufferGeometry();
  const position = new Float32BufferAttribute(new Float32Array(verts * 3), 3);
  const tangent = new Float32BufferAttribute(new Float32Array(verts * 3), 3);
  position.setUsage(DynamicDrawUsage);
  tangent.setUsage(DynamicDrawUsage);
  const side = new Float32Array(verts);
  const t = new Float32Array(verts);
  const seed = new Float32Array(verts);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const v = (i * m + j) * 2;
      side[v] = -1;
      side[v + 1] = 1;
      t[v] = t[v + 1] = j / (m - 1);
      seed[v] = seed[v + 1] = seeds[i]!;
      if (j < m - 1) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  geo.setAttribute('position', position);
  geo.setAttribute('aTangent', tangent);
  geo.setAttribute('aSide', new Float32BufferAttribute(side, 1));
  geo.setAttribute('aT', new Float32BufferAttribute(t, 1));
  geo.setAttribute('aSeed', new Float32BufferAttribute(seed, 1));
  geo.setIndex(idx);
  const mesh = new Mesh(
    geo,
    new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERT,
      fragmentShader: frag(FRAG),
      // 帯の向きは画面上で決まるので、裏表どちらも描く
      side: DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      uniforms: {
        ...lampUniforms(shared),
        uResolution: shared.uResolution,
        uPixelRatio: shared.uPixelRatio,
        uWidth: { value: widthPx },
        uBrightness: { value: brightness },
        uGlowPass: shared.uGlowPass,
        uKey: shared.uKey,
        uAmbient: shared.uAmbient,
        uBody: look.uBody,
        uGlow: look.uGlow,
      },
    }),
  );
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * 糸の節の位置 x（count 本 × nodes 節 × xyz）を描画用の頂点に書き込む。
 * alive が 0 の糸は長さ0の線にして描かない
 */
export function writeStrands(geo: BufferGeometry, x: Float32Array, n: number, m: number, alive?: Uint8Array): void {
  const pos = geo.getAttribute('position') as Float32BufferAttribute;
  const tan = geo.getAttribute('aTangent') as Float32BufferAttribute;
  const P = pos.array as Float32Array;
  const T = tan.array as Float32Array;
  for (let i = 0; i < n; i++) {
    const base = i * m * 3;
    if (alive && !alive[i]) {
      for (let j = 0; j < m * 2; j++) {
        const v = (i * m * 2 + j) * 3;
        P[v] = x[base]!;
        P[v + 1] = x[base + 1]!;
        P[v + 2] = x[base + 2]!;
        T[v] = T[v + 1] = T[v + 2] = 0;
      }
      continue;
    }
    for (let j = 0; j < m; j++) {
      const k = base + j * 3;
      const a = base + Math.max(j - 1, 0) * 3;
      const b = base + Math.min(j + 1, m - 1) * 3;
      const tx = x[b]! - x[a]!;
      const ty = x[b + 1]! - x[a + 1]!;
      const tz = x[b + 2]! - x[a + 2]!;
      const v = (i * m + j) * 2 * 3;
      for (let side = 0; side < 2; side++) {
        const o = v + side * 3;
        P[o] = x[k]!;
        P[o + 1] = x[k + 1]!;
        P[o + 2] = x[k + 2]!;
        T[o] = tx;
        T[o + 1] = ty;
        T[o + 2] = tz;
      }
    }
  }
  pos.needsUpdate = true;
  tan.needsUpdate = true;
}

export interface RootFrame {
  /** 根元の位置（ワールド） */
  pos: Vector3;
  /** 根元で垂れる向き（ワールド、正規化） */
  dir: Vector3;
}

export class Tentacles {
  readonly mesh: Mesh;
  readonly count = TENTACLES.count;
  readonly nodes = TENTACLES.nodes;
  /** 根元の角度（傘のローカル） */
  readonly angles: Float32Array;
  private readonly x: Float32Array;
  private readonly px: Float32Array;
  private readonly seg: Float32Array;
  /** 1本ずつの長さ（傘の半径 = 1）と、生えはじめる育ち具合（腕の間ほど早い） */
  private readonly baseLen: Float32Array;
  private readonly sproutAt: Float32Array;
  /** 生えているか（生えはじめたら根元から伸ばしなおす） */
  private readonly alive: Uint8Array;
  private readonly seeds: Float32Array;
  private readonly geo: BufferGeometry;
  private time = 0;
  /** 傘の半径（瓶の高さ単位）。触手の長さと、水の流れの強さの目安 */
  private radius: number = BELL.radius;

  constructor(shared: SharedUniforms, look: BellLook, rng: Rng) {
    const n = this.count;
    const m = this.nodes;
    this.angles = new Float32Array(n);
    this.seg = new Float32Array(n);
    this.baseLen = new Float32Array(n);
    this.sproutAt = new Float32Array(n);
    this.alive = new Uint8Array(n);
    this.seeds = new Float32Array(n);
    const lobe = (Math.PI * 2) / LOBES;
    for (let i = 0; i < n; i++) {
      this.seeds[i] = rng.next();
      this.angles[i] = ((i + 0.5 + rng.range(-0.3, 0.3)) / n) * Math.PI * 2;
      this.baseLen[i] = TENTACLES.length * (1 + TENTACLES.lengthJitter * (rng.next() * 2 - 1));
      // 腕の先（縁弁の真ん中）からの角度の近さ。腕の間（0.5）ほど早く生える
      const u = this.angles[i]! / lobe;
      const d = Math.abs(u - Math.round(u));
      this.sproutAt[i] = 0.85 * (0.4 * rng.next() + 0.6 * (1 - 2 * d));
    }
    this.setForm(BELL.radius, 1);
    this.x = new Float32Array(n * m * 3);
    this.px = new Float32Array(n * m * 3);

    this.mesh = createStrandMesh(shared, look, n, m, this.seeds, TENTACLES.widthPx, TENTACLES.brightness);
    this.geo = this.mesh.geometry;
    this.mesh.renderOrder = 30;
  }

  /** 根元から伸ばしなおす（個体を別の場所へ置きなおしたとき） */
  reset(): void {
    this.alive.fill(0);
  }

  /**
   * 大きさと生えそろい具合（エフィラが育つにつれて）。radius は傘の半径、sprout は 0〜1。
   * 腕の間の触手から先に、根元から少しずつ伸びる
   */
  setForm(radius: number, sprout: number): void {
    this.radius = radius;
    const m = this.nodes;
    for (let i = 0; i < this.count; i++) {
      const grow = Math.min(Math.max((sprout - this.sproutAt[i]!) / 0.15, 0), 1);
      this.seg[i] = (this.baseLen[i]! * radius * grow) / (m - 1);
    }
  }

  /**
   * 1ステップ進める。roots(i) は i 本目の根元を返す。
   * jet は収縮で押し出される水の向き×強さ（ワールド、加速度）、inflow は緩むときに傘の下へ吸い込む強さ。
   * 小さな個体では、重さや水の流れも大きさに合わせて弱める（同じ形で縮めた動きになる）
   */
  step(dt: number, roots: (i: number) => RootFrame, jet: Vector3, jetOrigin: Vector3, inflow = 0): void {
    const n = this.count;
    const m = this.nodes;
    const x = this.x;
    const px = this.px;
    const dt2 = dt * dt;
    const keep = 1 - TENTACLES.drag;
    const bellR = this.radius;
    const scale = bellR / BELL.radius;
    const g = -TENTACLES.gravity * scale;
    this.time += dt;
    const t = this.time;
    const cur = TENTACLES.current * scale;

    for (let i = 0; i < n; i++) {
      const L = this.seg[i]!;
      const base = i * m * 3;
      // まだ生えていない触手は、根元に畳んだまま
      if (L <= 1e-6) {
        this.alive[i] = 0;
        continue;
      }
      const root = roots(i);
      if (!this.alive[i]) {
        this.alive[i] = 1;
        for (let j = 0; j < m; j++) {
          const k = base + j * 3;
          x[k] = px[k] = root.pos.x + root.dir.x * L * j;
          x[k + 1] = px[k + 1] = root.pos.y + root.dir.y * L * j;
          x[k + 2] = px[k + 2] = root.pos.z + root.dir.z * L * j;
        }
      }
      // 根元は傘の縁に固定
      x[base] = px[base] = root.pos.x;
      x[base + 1] = px[base + 1] = root.pos.y;
      x[base + 2] = px[base + 2] = root.pos.z;

      for (let j = 1; j < m; j++) {
        const k = base + j * 3;
        // 傘の真下ほど強く押し出される
        const ox = x[k]! - jetOrigin.x;
        const oy = x[k + 1]! - jetOrigin.y;
        const oz = x[k + 2]! - jetOrigin.z;
        const near = 1 / (1 + (ox * ox + oy * oy + oz * oz) / (bellR * bellR * 2.5));
        // 水のゆるい流れ。場所でゆっくり向きが変わるので、近くの触手は一緒に揺れてまとまる
        const px0 = x[k]!;
        const y = x[k + 1]!;
        const pz0 = x[k + 2]!;
        const own = TENTACLES.currentOwn;
        const od = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
        const pull = (inflow * near) / od;
        const ax = jet.x * near - ox * pull + cur * (Math.sin(y * 23 + t * 0.7 + px0 * 37) + own * Math.sin(t * 1.3 + i * 0.9));
        const ay = jet.y * near - oy * pull + g;
        const az = jet.z * near - oz * pull + cur * (Math.cos(y * 19 - t * 0.6 + pz0 * 41) + own * Math.cos(t * 1.1 + i * 1.7));
        const vx = (x[k]! - px[k]!) * keep;
        const vy = (x[k + 1]! - px[k + 1]!) * keep;
        const vz = (x[k + 2]! - px[k + 2]!) * keep;
        px[k] = x[k]!;
        px[k + 1] = x[k + 1]!;
        px[k + 2] = x[k + 2]!;
        x[k] = x[k]! + vx + ax * dt2;
        x[k + 1] = x[k + 1]! + vy + ay * dt2;
        x[k + 2] = x[k + 2]! + vz + az * dt2;
      }

      // 張りはない。長さだけを保つ糸
      for (let iter = 0; iter < 3; iter++) {
        for (let j = 1; j < m; j++) {
          const a = base + (j - 1) * 3;
          const b = base + j * 3;
          const dx = x[b]! - x[a]!;
          const dy = x[b + 1]! - x[a + 1]!;
          const dz = x[b + 2]! - x[a + 2]!;
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (l - L) / l;
          if (j === 1) {
            x[b] = x[b]! - dx * diff;
            x[b + 1] = x[b + 1]! - dy * diff;
            x[b + 2] = x[b + 2]! - dz * diff;
          } else {
            x[a] = x[a]! + dx * diff * 0.5;
            x[a + 1] = x[a + 1]! + dy * diff * 0.5;
            x[a + 2] = x[a + 2]! + dz * diff * 0.5;
            x[b] = x[b]! - dx * diff * 0.5;
            x[b + 1] = x[b + 1]! - dy * diff * 0.5;
            x[b + 2] = x[b + 2]! - dz * diff * 0.5;
          }
        }
      }
      // 瓶の壁と底からははみ出さない
      for (let j = 1; j < m; j++) {
        const k = base + j * 3;
        const r = Math.hypot(x[k]!, x[k + 2]!);
        const lim = INNER_R - 0.006;
        if (r > lim) {
          x[k] = (x[k]! / r) * lim;
          x[k + 2] = (x[k + 2]! / r) * lim;
        }
        const floorY = JAR.bottomThickness + 0.004;
        if (x[k + 1]! < floorY) x[k + 1] = floorY;
      }
    }
  }

  /** 描画用の頂点を書き換える */
  updateGeometry(): void {
    writeStrands(this.geo, this.x, this.count, this.nodes, this.alive);
  }
}
