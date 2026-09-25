// 拍動のリズム。縮みは速く、開きはゆっくり。テンポにはわずかな揺らぎを入れる。
// three.js に依存しない。p = 0 が緩んだ状態、1 が縮みきった状態。
import { POKE, PULSE } from '../../config';
import type { Rng } from '../../sim/rng';
import { ADULT_PULSE, type PulseParams } from './form';

interface Cycle {
  start: number;
  tc: number;
  tr: number;
  rest: number;
  /** 縮みの深さ */
  amp: number;
  /** 縮み始めたときの p（前の周期の揺り戻しが残っている） */
  p0: number;
}

const CONTRACT_K = 5;
const CONTRACT_NORM = 1 - (1 + CONTRACT_K) * Math.exp(-CONTRACT_K);

/** 縮む曲線。立ち上がりはなめらかで、すぐに速くなる */
export function contractCurve(u: number): number {
  const x = Math.min(Math.max(u, 0), 1);
  return (1 - (1 + CONTRACT_K * x) * Math.exp(-CONTRACT_K * x)) / CONTRACT_NORM;
}

/** 開く曲線。弾むように戻り、わずかに開きすぎてから落ち着く（u は緩和時間で割った経過） */
export function relaxCurve(u: number, overshoot: number = PULSE.overshoot): number {
  if (u <= 0) return 1;
  const lnOs = Math.log(Math.max(overshoot, 1e-4));
  const zeta = -lnOs / Math.sqrt(Math.PI * Math.PI + lnOs * lnOs);
  const omega = PULSE.relaxOmega;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const e = Math.exp(-zeta * omega * u);
  return e * (Math.cos(wd * u) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * u));
}

function cycleValue(c: Cycle, time: number): number {
  const tau = time - c.start;
  if (tau < 0) return c.p0;
  if (tau < c.tc) return c.p0 + (c.amp - c.p0) * contractCurve(tau / c.tc);
  return c.amp * relaxCurve((tau - c.tc) / c.tr);
}

export class Pulse {
  private time = 0;
  private cycles: Cycle[] = [];
  private readonly tempoPhase: number;
  /** 次の周期からの調子（泳ぎから指定する） */
  private style = { amp: 1, rest: 0, tempo: 1 };
  /** 拍動の速さや深さ（成体とエフィラで違う。次の周期から効く） */
  private params: PulseParams = ADULT_PULSE;

  constructor(private readonly rng: Rng, private readonly tempo = 1) {
    this.tempoPhase = rng.range(0, Math.PI * 2);
    // 起動直後は緩んだ状態から少し待って最初の拍動に入る
    this.cycles.push(this.makeCycle(rng.range(0.3, 1.2), 0));
  }

  /** 拍動の調子を変える（エフィラが育つにつれて成体の拍動へ） */
  setParams(params: PulseParams): void {
    this.params = params;
  }

  private makeCycle(start: number, p0: number): Cycle {
    const P = this.params;
    const j = P.jitter;
    // 数十秒かけてゆっくり揺れるテンポと、周期ごとの揺らぎ
    const drift = 1 + 0.07 * Math.sin(start * 0.045 + this.tempoPhase) + 0.04 * Math.sin(start * 0.13 + this.tempoPhase * 2.3);
    const k = (drift * this.style.tempo) / this.tempo;
    // ふだんは浅いお椀〜お椀、ときどき強く縮んで釣鐘のように深くなる
    const strong = this.rng.next() < P.strongChance;
    const amp = strong ? this.rng.range(P.strongAmpMin, P.strongAmpMax) : this.rng.range(P.ampMin, P.ampMax);
    let rest = this.rng.range(P.restMin, P.restMax) * k + this.style.rest * this.rng.range(0.6, 1.4);
    // ぎこちない拍動（エフィラ）：ときどき間が空き、ときどきすぐにもう一度縮む
    if (P.pauseChance > 0 || P.doubleChance > 0) {
      const r = this.rng.next();
      if (r < P.pauseChance) rest += this.rng.range(P.pauseMin, P.pauseMax);
      else if (r < P.pauseChance + P.doubleChance) rest *= 0.15;
    }
    return {
      start,
      tc: P.contract * k * (1 + j * 0.5 * this.rng.gauss()),
      tr: P.relax * k * (1 + j * this.rng.gauss()),
      rest,
      amp: amp * this.style.amp,
      p0,
    };
  }

  /** つつかれたとき：その場できゅっと深く縮み、数秒かけて緩む。strength は 0〜1 */
  startle(strength: number): void {
    const p0 = this.value(0);
    const amp = Math.max(p0, POKE.depth * (0.65 + 0.35 * strength));
    this.cycles.push({
      start: this.time,
      tc: POKE.contract,
      tr: POKE.relax,
      rest: this.rng.range(this.params.restMin, this.params.restMax),
      amp,
      p0,
    });
    if (this.cycles.length > 4) this.cycles.shift();
  }

  /** 次の周期からの拍動の深さ・休み・テンポ（1 が標準） */
  setStyle(amp: number, rest: number, tempo: number): void {
    this.style.amp = amp;
    this.style.rest = rest;
    this.style.tempo = tempo;
  }

  update(dt: number): void {
    this.time += dt;
    let last = this.cycles[this.cycles.length - 1]!;
    for (;;) {
      const end = last.start + last.tc + last.tr + last.rest;
      if (this.time < end) break;
      const next = this.makeCycle(end, cycleValue(last, end));
      this.cycles.push(next);
      if (this.cycles.length > 4) this.cycles.shift();
      last = next;
    }
  }

  /** 時刻 t を含む周期 */
  private cycleAt(t: number): Cycle {
    for (let i = this.cycles.length - 1; i > 0; i--) {
      const c = this.cycles[i]!;
      if (t >= c.start) return c;
    }
    return this.cycles[0]!;
  }

  /** delay 秒前の p */
  value(delay = 0): number {
    const t = this.time - delay;
    return cycleValue(this.cycleAt(t), t);
  }

  /** p の変化の速さ（1/秒）。正なら縮んでいる */
  rate(): number {
    const h = 1 / 240;
    return (this.value(0) - this.value(h)) / h;
  }

  /**
   * 推進に使う縮む速さ（1/秒）。縮みの深さで割るので、1回の縮みで押し出す量は深さによらず同じ。
   * 形は大きく変わっても、進む距離はゆったりのまま
   */
  thrustRate(): number {
    const c = this.cycleAt(this.time);
    return Math.max(this.rate(), 0) / Math.max(c.amp, 0.3);
  }

  /** 今の周期の中で縮んでいる最中か */
  get contracting(): boolean {
    const c = this.cycles[this.cycles.length - 1]!;
    const tau = this.time - c.start;
    return tau >= 0 && tau < c.tc;
  }

  get now(): number {
    return this.time;
  }
}
