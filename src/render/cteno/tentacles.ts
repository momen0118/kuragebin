// カブトクラゲの幼生の触手2本。体の中の付け根から口の側へ通って体の外へ出て、風鈴の紐のように垂れる細い糸（verlet の鎖で長さだけを保つ）。
// 体の中の分（付け根から出口まで）は体に固定して、透けて見える。外の分は水の抵抗と少しの重さで垂れ、泳げば後ろにたなびく。
// 育つにつれて縮んでなくなる（CTENO.larva.tentacles）。
// 描くのはミズクラゲの縁触手と同じ細い帯（jelly/tentacles.ts の createStrandMesh）
import { Vector3, type BufferGeometry, type Material, type Mesh } from 'three';
import { CTENO, JAR } from '../../config';
import type { Rng } from '../../sim/rng';
import { createStrandMesh, writeStrands } from '../jelly/tentacles';
import { flowAt, type WaterField } from '../slosh';
import type { SharedUniforms } from '../uniforms';

const T = CTENO.larva.tentacle;
const INNER_R = JAR.radius - JAR.glassThickness;
const COUNT = 2;
/** 体に固定する節の数（体の中の付け根・その途中・体の外へ出る所） */
export const LARVA_FIXED = 3;
const FIXED = LARVA_FIXED;
const tmpFlow = new Vector3();
const tmpA = new Vector3();

export class LarvaTentacles {
  readonly mesh: Mesh;
  /** 瓶の壁と底の中に収める（カップで運ばれている間は false） */
  confined = true;
  private readonly nodes = T.nodes;
  private readonly x: Float32Array;
  private readonly px: Float32Array;
  private readonly alive = new Uint8Array(COUNT);
  private readonly geo: BufferGeometry;
  /** 1本ずつの長さの倍率（わずかに違う） */
  private readonly jitter: Float32Array;
  /** 節の間の長さ（ワールド）。0 なら描かない */
  private seg = 0;
  /** 体の大きさ（流れや重さの強さの目安） */
  private scale = 1;
  private time = 0;

  constructor(shared: SharedUniforms, look: { uBody: { value: Vector3 }; uGlow: { value: Vector3 }; uOpacity: { value: number } }, rng: Rng) {
    const seeds = new Float32Array(COUNT);
    this.jitter = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      seeds[i] = rng.next();
      this.jitter[i] = 1 + 0.12 * (rng.next() * 2 - 1);
    }
    this.x = new Float32Array(COUNT * this.nodes * 3);
    this.px = new Float32Array(COUNT * this.nodes * 3);
    this.mesh = createStrandMesh(shared, look, COUNT, this.nodes, seeds, T.widthPx, T.brightness);
    this.mesh.frustumCulled = false;
    this.geo = this.mesh.geometry;
  }

  /** 体から出た分の長さ（ワールド）と体の大きさ（瓶の高さ単位の体の長さ）。length が 0 なら描かない */
  setLength(length: number, bodyLength: number): void {
    this.seg = length / (this.nodes - FIXED);
    this.scale = Math.sqrt(bodyLength / CTENO.length);
  }

  /** 根元から伸ばしなおす（置きなおしたとき） */
  reset(): void {
    this.alive.fill(0);
  }

  /** まとめて動かす（瓶から瓶へ座標を移すとき、カップの水ごと運ばれるとき） */
  translate(dx: number, dy = 0, dz = 0): void {
    for (let i = 0; i < this.x.length; i += 3) {
      this.x[i]! += dx;
      this.px[i]! += dx;
      this.x[i + 1]! += dy;
      this.px[i + 1]! += dy;
      this.x[i + 2]! += dz;
      this.px[i + 2]! += dz;
    }
  }

  /**
   * 1ステップ進める。anchor(i, j, out) は i 本目の、体に固定する j 番目の節（0 が体の中の付け根、LARVA_FIXED - 1 が体の外へ出る所。ワールド）。
   * down は体の口の側の向き（伸ばしなおすとき、出口からこの向きへ並べる）
   */
  step(dt: number, anchor: (i: number, j: number, out: Vector3) => Vector3, down: Vector3, water: WaterField | null): void {
    const m = this.nodes;
    const x = this.x;
    const px = this.px;
    const dt2 = dt * dt;
    const keep = 1 - T.drag;
    const gw = T.gravity * this.scale * (water ? water.weight : 1);
    const gx = water ? water.down.x * gw : 0;
    const gy = water ? water.down.y * gw : -gw;
    const gz = water ? water.down.z * gw : 0;
    const moving = water !== null && water.moving;
    this.time += dt;
    const t = this.time;
    const cur = T.current * this.scale;
    for (let i = 0; i < COUNT; i++) {
      const base = i * m * 3;
      const L = this.seg * this.jitter[i]!;
      if (L <= 1e-6) {
        this.alive[i] = 0;
        continue;
      }
      // 体の中の分は体に固定
      for (let j = 0; j < FIXED; j++) {
        const k = base + j * 3;
        anchor(i, j, tmpA);
        x[k] = px[k] = tmpA.x;
        x[k + 1] = px[k + 1] = tmpA.y;
        x[k + 2] = px[k + 2] = tmpA.z;
      }
      if (!this.alive[i]) {
        // 出口から口の側へまっすぐ並べなおす
        this.alive[i] = 1;
        const e = base + (FIXED - 1) * 3;
        for (let j = FIXED; j < m; j++) {
          const k = base + j * 3;
          const d = L * (j - FIXED + 1);
          x[k] = px[k] = x[e]! + down.x * d;
          x[k + 1] = px[k + 1] = x[e + 1]! + down.y * d;
          x[k + 2] = px[k + 2] = x[e + 2]! + down.z * d;
        }
      }
      for (let j = FIXED; j < m; j++) {
        const k = base + j * 3;
        const y = x[k + 1]!;
        const ax = cur * Math.sin(y * 31 + t * 0.6 + i * 2.1) + gx;
        const ay = gy;
        const az = cur * Math.cos(y * 27 - t * 0.5 + i * 1.3) + gz;
        let vx = (x[k]! - px[k]!) * keep;
        let vy = (x[k + 1]! - px[k + 1]!) * keep;
        let vz = (x[k + 2]! - px[k + 2]!) * keep;
        if (moving) {
          const f = flowAt(water, x[k]!, y, x[k + 2]!, tmpFlow);
          const d = dt * (1 - keep);
          vx += f.x * d;
          vy += f.y * d;
          vz += f.z * d;
        }
        px[k] = x[k]!;
        px[k + 1] = x[k + 1]!;
        px[k + 2] = x[k + 2]!;
        x[k] = x[k]! + vx + ax * dt2;
        x[k + 1] = x[k + 1]! + vy + ay * dt2;
        x[k + 2] = x[k + 2]! + vz + az * dt2;
      }
      // 長さだけを保つ
      for (let iter = 0; iter < 3; iter++) {
        for (let j = FIXED; j < m; j++) {
          const a = base + (j - 1) * 3;
          const b = base + j * 3;
          const dx = x[b]! - x[a]!;
          const dy = x[b + 1]! - x[a + 1]!;
          const dz = x[b + 2]! - x[a + 2]!;
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (l - L) / l;
          if (j === FIXED) {
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
      for (let j = FIXED; this.confined && j < m; j++) {
        const k = base + j * 3;
        const r = Math.sqrt(x[k]! * x[k]! + x[k + 2]! * x[k + 2]!);
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

  updateGeometry(): void {
    writeStrands(this.geo, this.x, COUNT, this.nodes, this.alive);
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as Material).dispose();
  }
}
