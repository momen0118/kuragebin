// 縁触手。ばね鎖（verlet）で、傘の動きから遅れてたわむ。
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
import { BELL, JAR, TENTACLES } from '../../config';
import type { Rng } from '../../sim/rng';
import type { SharedUniforms } from '../uniforms';
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
  vec3 glow = uGlow * a * (0.08 + 0.14 * (1.0 - vT));
  if (uGlowPass > 0.5) {
    gl_FragColor = vec4(glow, 0.0);
    return;
  }
  vec3 light = uAmbient * 0.9 + uKey * 0.3;
  vec3 col = uBody * light * a * 0.6 + glow;
  gl_FragColor = vec4(col, a * 0.15);
}
`;

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
  private readonly seeds: Float32Array;
  private readonly geo: BufferGeometry;
  private time = 0;
  private initialized = false;

  constructor(shared: SharedUniforms, look: BellLook, rng: Rng) {
    const n = this.count;
    const m = this.nodes;
    this.angles = new Float32Array(n);
    this.seg = new Float32Array(n);
    this.seeds = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.seeds[i] = rng.next();
      this.angles[i] = ((i + 0.5 + rng.range(-0.3, 0.3)) / n) * Math.PI * 2;
      const len = TENTACLES.length * BELL.radius * (1 + TENTACLES.lengthJitter * (rng.next() * 2 - 1));
      this.seg[i] = len / (m - 1);
    }
    this.x = new Float32Array(n * m * 3);
    this.px = new Float32Array(n * m * 3);

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
        seed[v] = seed[v + 1] = this.seeds[i]!;
        if (j < m - 1) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    geo.setAttribute('position', position);
    geo.setAttribute('aTangent', tangent);
    geo.setAttribute('aSide', new Float32BufferAttribute(side, 1));
    geo.setAttribute('aT', new Float32BufferAttribute(t, 1));
    geo.setAttribute('aSeed', new Float32BufferAttribute(seed, 1));
    geo.setIndex(idx);
    this.geo = geo;

    this.mesh = new Mesh(
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
          uResolution: shared.uResolution,
          uPixelRatio: shared.uPixelRatio,
          uWidth: { value: TENTACLES.widthPx },
          uBrightness: { value: TENTACLES.brightness },
          uGlowPass: shared.uGlowPass,
          uKey: shared.uKey,
          uAmbient: shared.uAmbient,
          uBody: look.uBody,
          uGlow: look.uGlow,
        },
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
  }

  /**
   * 1ステップ進める。roots(i) は i 本目の根元を返す。
   * jet は収縮で押し出される水の向き×強さ（ワールド、加速度）
   */
  step(dt: number, roots: (i: number) => RootFrame, jet: Vector3, jetOrigin: Vector3): void {
    const n = this.count;
    const m = this.nodes;
    const x = this.x;
    const px = this.px;
    const dt2 = dt * dt;
    const keep = 1 - TENTACLES.drag;
    const g = -TENTACLES.gravity;
    const bellR = BELL.radius;
    this.time += dt;
    const t = this.time;
    const cur = TENTACLES.current;

    for (let i = 0; i < n; i++) {
      const root = roots(i);
      const L = this.seg[i]!;
      const base = i * m * 3;
      if (!this.initialized) {
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
        // 水のゆるい流れ。場所と時間でゆっくり向きが変わる
        const y = x[k + 1]!;
        const ax = jet.x * near + cur * Math.sin(y * 31 + t * 0.9 + i * 0.7);
        const ay = jet.y * near + g;
        const az = jet.z * near + cur * Math.cos(y * 27 - t * 0.7 + i * 1.3);
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

      for (let iter = 0; iter < 3; iter++) {
        // 根元の向きを保つ
        const k1 = base + 3;
        const s = TENTACLES.rootStiffness;
        x[k1] = x[k1]! + (root.pos.x + root.dir.x * L - x[k1]!) * s;
        x[k1 + 1] = x[k1 + 1]! + (root.pos.y + root.dir.y * L - x[k1 + 1]!) * s;
        x[k1 + 2] = x[k1 + 2]! + (root.pos.z + root.dir.z * L - x[k1 + 2]!) * s;
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
    this.initialized = true;
  }

  /** 描画用の頂点を書き換える */
  updateGeometry(): void {
    const n = this.count;
    const m = this.nodes;
    const x = this.x;
    const pos = this.geo.getAttribute('position') as Float32BufferAttribute;
    const tan = this.geo.getAttribute('aTangent') as Float32BufferAttribute;
    const P = pos.array as Float32Array;
    const T = tan.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const base = i * m * 3;
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
}
