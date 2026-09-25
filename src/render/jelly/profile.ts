// 傘の断面の形。頂点から縁までの長さは変えずに、曲がり方だけを変えて拍動させる。
// 縮みは頂点から縁へ遅れて伝わり、薄い縁はばねのように少し遅れてしなる。
// 毎ステップ CPU で断面の点列を作り、頂点シェーダ（bell.ts）はそれを補間して使う。
import { BELL } from '../../config';
import type { Pulse } from './pulse';

/** 断面の分割数（点は +1 個） */
export const PROFILE_SEGMENTS = 32;

/** 緩んだときの断面の傾き（水平から下向きへのラジアン）。上は平たく、縁で急に曲がる */
function relaxedAngle(s: number): number {
  const [a, b] = BELL.relaxedCurve;
  return a * s + b * s ** 4;
}

/** 縮んだときに足す曲がり。縁に近いほど大きい */
function bendWeight(s: number): number {
  return s ** BELL.bendPower;
}

/** 縁のしなりが効く範囲 */
function flexWeight(s: number): number {
  const t = Math.min(Math.max((s - 0.62) / 0.38, 0), 1);
  return t * t * (3 - 2 * t);
}

/** 緩んだ形で縁の半径が 1 になる断面の長さ */
function arcLength(): number {
  const n = 256;
  let x = 0;
  for (let i = 0; i < n; i++) x += Math.cos(relaxedAngle((i + 0.5) / n)) / n;
  return 1 / x;
}

export class BellShape {
  /** 断面の点 (r, y) の並び。傘の半径 = 1 の単位、頂点が y = BELL.apexY */
  readonly points = new Float32Array((PROFILE_SEGMENTS + 1) * 2);
  private readonly length = arcLength();
  private flex = 0;
  private flexVel = 0;
  private prevMargin = 0;

  constructor() {
    this.integrate(() => 0);
  }

  /** 縁のしなりを進めて、断面を作り直す */
  update(dt: number, pulse: Pulse): void {
    const lag = BELL.propagation;
    if (dt > 0) {
      // 縁が速く縮むほど、薄い縁は置いていかれて外へ反り、追いついて内へ行き過ぎる
      const m = pulse.value(lag);
      const rate = (m - this.prevMargin) / dt;
      this.prevMargin = m;
      const w = BELL.flexFreq * Math.PI * 2;
      const acc = -w * w * this.flex - 2 * BELL.flexDamping * w * this.flexVel - BELL.flexGain * w * w * rate;
      this.flexVel += acc * dt;
      this.flex += this.flexVel * dt;
    }
    this.integrate((s) => pulse.value(lag * s));
  }

  private integrate(contraction: (s: number) => number): void {
    const n = PROFILE_SEGMENTS;
    const ds = this.length / n;
    const p = this.points;
    let r = 0;
    let y = BELL.apexY;
    p[0] = 0;
    p[1] = y;
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const th = relaxedAngle(s) + BELL.contractBend * bendWeight(s) * contraction(s) + this.flex * flexWeight(s);
      r += ds * Math.cos(th);
      y -= ds * Math.sin(th);
      p[(i + 1) * 2] = r;
      p[(i + 1) * 2 + 1] = y;
    }
  }

  /** 縁の位置 (r, y) */
  margin(): [number, number] {
    const k = PROFILE_SEGMENTS * 2;
    return [this.points[k]!, this.points[k + 1]!];
  }

  /** 縁での断面の向き（外へ、下へ） */
  marginTangent(): [number, number] {
    const k = PROFILE_SEGMENTS * 2;
    const dr = this.points[k]! - this.points[k - 2]!;
    const dy = this.points[k + 1]! - this.points[k - 1]!;
    const l = Math.hypot(dr, dy) || 1;
    return [dr / l, dy / l];
  }
}

/** 8つの切れ込み（感覚器）による縁の半径の減り。θ はラジアン */
export function notch(theta: number, s: number): number {
  const k = theta / (Math.PI / 4) - 0.5;
  const d = (k - Math.round(k)) * (Math.PI / 4);
  const w = Math.min(Math.max((s - 0.86) / 0.14, 0), 1);
  return 1 - BELL.notchDepth * Math.exp(-(d * d) / 0.0035) * w * w;
}
