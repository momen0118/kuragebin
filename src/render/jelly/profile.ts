// 傘の断面の形。頂点から縁までの長さは変えずに、曲がり方だけを変えて拍動させる。
// 緩みきると平たい皿、縮むとお椀、強く縮むと釣鐘のように深くなる。縮みは頂点から縁へ遅れて伝わる。
// 縁は浅い切れ込みで8枚の縁弁（花びら）に分かれ、1枚ずつ少しずつ独立にしなる。
// 拍動に遅れてしなるだけでなく、緩んでいる間もゆっくり揺れ、ときどき内側へ折れる。
// 毎ステップ CPU で縁弁ごとの断面の点列を作り、頂点シェーダ（bell.ts）は角度で補間して使う。
import { BELL } from '../../config';
import type { Rng } from '../../sim/rng';
import type { Pulse } from './pulse';

/** 断面の分割数（点は +1 個） */
export const PROFILE_SEGMENTS = 32;
/** 縁弁の数。縁弁の真ん中は角度 k·π/4、切れ込みはその間 */
export const LOBES = 8;
const LOBE_ANGLE = (Math.PI * 2) / LOBES;

/** 緩んだときの断面の傾き（水平から下向きへのラジアン）。上は平たく、縁で少し下がる */
function relaxedAngle(s: number): number {
  const [a, b] = BELL.relaxedCurve;
  return a * s + b * s ** 4;
}

/** 縮んだときに足す曲がり。縁に近いほど大きい */
function bendWeight(s: number, power: number): number {
  return s ** power;
}

/** 縮み方としなり方。成体は BELL の値、エフィラは腕が大きく折れ、腕ごとにずれてしなる */
export interface ShapeParams {
  contractBend: number;
  bendPower: number;
  flexGain: number;
  flexSpread: number;
  /** 縁弁（腕）ごとの縮みのずれの上限（秒）。0 ならそろって縮む */
  lobeLag: number;
}

export const ADULT_SHAPE: ShapeParams = {
  contractBend: BELL.contractBend,
  bendPower: BELL.bendPower,
  flexGain: BELL.flexGain,
  flexSpread: BELL.flexSpread,
  lobeLag: 0,
};

function smooth(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}

/** 縁弁のしなりが効く度合い。縁に近いほど柔らかい */
function flexWeight(s: number): number {
  const t = smooth((s - BELL.flexStart) / (1 - BELL.flexStart));
  return t * t;
}

/** 内側への折れが効く度合い。縁のごく近くだけ */
function foldWeight(s: number): number {
  return smooth((s - 0.8) / 0.2);
}

/** 緩んだ形で縁の半径が 1 になる断面の長さ */
function arcLength(): number {
  const n = 256;
  let x = 0;
  for (let i = 0; i < n; i++) x += Math.cos(relaxedAngle((i + 0.5) / n)) / n;
  return 1 / x;
}

/**
 * 角度 θ での、隣り合う2枚の縁弁とその混ぜ具合。
 * 縁弁の真ん中あたりはその縁弁だけ、切れ込みのあたりで隣へなめらかに移る（bell.ts と同じ式）
 */
export function lobeBlend(theta: number): [number, number, number] {
  const u = theta / LOBE_ANGLE;
  const k = Math.floor(u);
  const t = u - k;
  const l0 = ((k % LOBES) + LOBES) % LOBES;
  const l1 = (l0 + 1) % LOBES;
  const w = smooth((t - 0.32) / 0.36);
  return [l0, l1, w];
}

/**
 * 縁弁の形による半径の減り（花びらの丸みと、切れ込み）。s が縁に近いほど効く。θ はラジアン。
 * bell.ts の scallop() と同じ式
 */
export function scallop(theta: number, s: number): number {
  const u = theta / LOBE_ANGLE;
  const d = Math.abs(u - Math.round(u));
  const w = smooth((s - 0.8) / 0.2);
  const round = BELL.lobeRound * (2 * d) ** 3;
  const cut = BELL.notchDepth * Math.exp(-(((0.5 - d) / BELL.notchWidth) ** 2));
  return 1 - (round + cut) * w;
}

interface Lobe {
  flex: number;
  vel: number;
  /** しなりの速さと、縮みへの反応のばらつき（-1〜1。params の flexSpread を掛けて使う） */
  freqJitter: number;
  gainJitter: number;
  /** 縮みのずれ（0〜1。params の lobeLag を掛けて使う）。縮むたびに選び直す */
  lag: number;
  /** ゆっくりした揺れ（2つの周期の重ね合わせ） */
  w1: number;
  w2: number;
  ph1: number;
  ph2: number;
  /** 内側への折れ（今の値、目標、切り替えまでの時間） */
  fold: number;
  foldTarget: number;
  foldTimer: number;
}

export class BellShape {
  /** 縁弁ごとの断面の点 (r, y) の並び（縁弁ごとに PROFILE_SEGMENTS+1 個）。傘の半径 = 1、頂点が y = BELL.apexY */
  readonly points = new Float32Array(LOBES * (PROFILE_SEGMENTS + 1) * 2);
  private readonly length = arcLength();
  private readonly lobes: Lobe[] = [];
  private readonly accel = new Float64Array(LOBES);
  private readonly base = new Float64Array(PROFILE_SEGMENTS);
  private prevMargin = 0;
  private time = 0;
  private params: ShapeParams = ADULT_SHAPE;
  private wasContracting = false;

  constructor(private readonly rng: Rng) {
    const [pMin, pMax] = BELL.lobeSwayPeriod;
    const [iMin, iMax] = BELL.foldInterval;
    for (let k = 0; k < LOBES; k++) {
      this.lobes.push({
        flex: 0,
        vel: 0,
        freqJitter: rng.next() * 2 - 1,
        gainJitter: rng.next() * 2 - 1,
        lag: rng.next(),
        w1: (Math.PI * 2) / rng.range(pMin, pMax),
        w2: (Math.PI * 2) / rng.range(pMin, pMax),
        ph1: rng.range(0, Math.PI * 2),
        ph2: rng.range(0, Math.PI * 2),
        fold: 0,
        foldTarget: 0,
        foldTimer: rng.range(iMin * 0.2, iMax),
      });
    }
    this.integrate(() => 0);
  }

  /** 縮み方としなり方を変える（エフィラが育つにつれて成体へ） */
  setParams(params: ShapeParams): void {
    this.params = params;
  }

  /** 縁弁のしなりと折れを進めて、断面を作り直す */
  update(dt: number, pulse: Pulse): void {
    const lag = BELL.propagation;
    const P = this.params;
    if (dt > 0) {
      this.time += dt;
      // 縮み始めるたびに、腕ごとのずれを選び直す（エフィラのぎこちなさ）
      const contracting = pulse.contracting;
      if (contracting && !this.wasContracting && P.lobeLag > 0) for (const b of this.lobes) b.lag = this.rng.next();
      this.wasContracting = contracting;
      // 縁が速く縮むほど、薄い縁は置いていかれて外へ反り、追いついて内へ行き過ぎる
      const m = pulse.value(lag);
      const rate = (m - this.prevMargin) / dt;
      this.prevMargin = m;
      const L = this.lobes;
      for (let k = 0; k < LOBES; k++) {
        const b = L[k]!;
        const freq = BELL.flexFreq * (1 + P.flexSpread * b.freqJitter);
        const gain = P.flexGain * (1 + P.flexSpread * b.gainJitter);
        const w = freq * Math.PI * 2;
        // 緩んでいる間もゆっくり揺れる
        const sway = BELL.lobeSway * (0.6 * Math.sin(this.time * b.w1 + b.ph1) + 0.4 * Math.sin(this.time * b.w2 + b.ph2));
        const left = L[(k + LOBES - 1) % LOBES]!.flex;
        const right = L[(k + 1) % LOBES]!.flex;
        this.accel[k] =
          -w * w * (b.flex - sway) - 2 * BELL.flexDamping * w * b.vel - gain * w * w * rate + BELL.lobeCoupling * (left + right - 2 * b.flex);
      }
      for (let k = 0; k < LOBES; k++) {
        const b = L[k]!;
        b.vel += this.accel[k]! * dt;
        b.flex += b.vel * dt;
        this.stepFold(b, dt);
      }
    }
    this.integrate((delay) => pulse.value(delay));
  }

  /** ときどき内側へ折れて、しばらくすると戻る */
  private stepFold(b: Lobe, dt: number): void {
    b.foldTimer -= dt;
    if (b.foldTimer <= 0) {
      if (b.foldTarget === 0) {
        b.foldTarget = this.rng.range(BELL.foldAngle[0], BELL.foldAngle[1]);
        b.foldTimer = this.rng.range(BELL.foldDuration[0], BELL.foldDuration[1]);
      } else {
        b.foldTarget = 0;
        b.foldTimer = this.rng.range(BELL.foldInterval[0], BELL.foldInterval[1]);
      }
    }
    b.fold += (b.foldTarget - b.fold) * (1 - Math.exp(-dt / 0.6));
  }

  /** contraction(delay) は delay 秒前の縮み。縮みは頂点から縁へ遅れて伝わる */
  private integrate(contraction: (delay: number) => number): void {
    const n = PROFILE_SEGMENTS;
    const ds = this.length / n;
    const p = this.points;
    const stride = (n + 1) * 2;
    const base = this.base;
    const P = this.params;
    const lag = BELL.propagation;
    const perLobe = P.lobeLag > 0;
    const fillBase = (extra: number): void => {
      for (let i = 0; i < n; i++) {
        const s = (i + 0.5) / n;
        base[i] = relaxedAngle(s) + P.contractBend * bendWeight(s, P.bendPower) * contraction(lag * s + extra);
      }
    };
    if (!perLobe) fillBase(0);
    for (let k = 0; k < LOBES; k++) {
      const b = this.lobes[k];
      const flex = b ? b.flex : 0;
      const fold = b ? b.fold : 0;
      if (perLobe) fillBase(b ? b.lag * P.lobeLag : 0);
      const o = k * stride;
      let r = 0;
      let y = BELL.apexY;
      p[o] = 0;
      p[o + 1] = y;
      for (let i = 0; i < n; i++) {
        const s = (i + 0.5) / n;
        const th = base[i]! + flex * flexWeight(s) + fold * foldWeight(s);
        r += ds * Math.cos(th);
        y -= ds * Math.sin(th);
        p[o + (i + 1) * 2] = r;
        p[o + (i + 1) * 2 + 1] = y;
      }
    }
  }

  private lobePoint(lobe: number, i: number): [number, number] {
    const o = lobe * (PROFILE_SEGMENTS + 1) * 2 + i * 2;
    return [this.points[o]!, this.points[o + 1]!];
  }

  /** 角度 θ での縁の位置 (r, y)（切れ込みを含む）と、断面の向き（外へ、下へ） */
  marginAt(theta: number, out: { r: number; y: number; tr: number; ty: number }): void {
    this.pointAt(theta, 1, out);
  }

  /**
   * 角度 θ、断面の位置 s（頂点 0〜縁 1）での点 (r, y)（切れ込みを含む）と、断面の向き。
   * エフィラの腕の間では縁が s < 1 の所にある（form.ts の armReach）
   */
  pointAt(theta: number, s: number, out: { r: number; y: number; tr: number; ty: number }): void {
    const [l0, l1, w] = lobeBlend(theta);
    const n = PROFILE_SEGMENTS;
    const f = Math.min(Math.max(s, 0), 1) * n;
    const i = Math.min(Math.floor(f), n - 1);
    const t = f - i;
    const [a0, b0] = this.lobePoint(l0, i);
    const [a1, b1] = this.lobePoint(l0, i + 1);
    const [c0, d0] = this.lobePoint(l1, i);
    const [c1, d1] = this.lobePoint(l1, i + 1);
    const ri = a0 + (c0 - a0) * w;
    const yi = b0 + (d0 - b0) * w;
    const rj = a1 + (c1 - a1) * w;
    const yj = b1 + (d1 - b1) * w;
    const dr = rj - ri;
    const dy = yj - yi;
    const l = Math.hypot(dr, dy) || 1;
    out.r = (ri + dr * t) * scallop(theta, s);
    out.y = yi + dy * t;
    out.tr = dr / l;
    out.ty = dy / l;
  }

  /** 縁の平均の位置 (r, y)。傘の開き具合を見るのに使う */
  margin(): [number, number] {
    let r = 0;
    let y = 0;
    for (let k = 0; k < LOBES; k++) {
      const [a, b] = this.lobePoint(k, PROFILE_SEGMENTS);
      r += a / LOBES;
      y += b / LOBES;
    }
    return [r, y];
  }
}
