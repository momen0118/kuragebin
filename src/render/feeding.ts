// 餌をやる流れ（描画側）。どの動きもゆっくり丁寧に。空気は入れない：先は水の中で出し入れし、泡もしぶきも出さない。
// 降りる：スポイトが瓶の口の上にふっと現れ、まっすぐゆっくり降りて、先を水面の下にそっと入れる（小さな波紋）。
// 押す：少し置いてから球をゆっくり押し、先から餌の粒を水の中へ出す。押したまま少し待つ。
// 抜く：押したまま先を水から抜き（小さな波紋）、上がりながら球を戻して消える。
// 粒はそのあとも沈みながら食べられていく（food.ts）。見せ場が終わったら、食べきっていない個体の胃の色を食べた量に合わせる。
// 位置は餌をやった瓶の座標（その瓶の中心が原点）。
import { Vector3 } from 'three';
import { FEEDING, FOOD, JAR } from '../config';
import type { Eater, Food } from './food';
import type { Jellyfish } from './jelly/jellyfish';
import type { Pipette } from './pipette';

export interface FeedingHost {
  /** 瓶 jar の水面に波紋を立てる（瓶の座標）。輪は半径 radius から広がりはじめる */
  ripple(jar: number, x: number, z: number, strength: number, radius: number): void;
  /** 水の中のスポイトの先を、瓶 jar の泳ぐ個体によけさせる。null でやめる */
  obstruct(jar: number, center: Vector3 | null, radius: number): void;
  /** 瓶 jar の泳ぐ個体（先を下ろす所を、水面の近くの海月から離す） */
  swimmers(jar: number): readonly Jellyfish[];
  /** 瓶 jar の個体（見せ場で食べる） */
  eaters(jar: number): readonly Eater[];
  /** 見せ場が終わった。食べきっていない個体の胃の色を合わせる（immediate ならすぐ） */
  finish(jar: number, immediate: boolean): void;
}

type Phase = 'idle' | 'descend' | 'settle' | 'squeeze' | 'hold' | 'withdraw';

const WATER = JAR.waterLevel;
/** 先を入れる高さ（水面の少し下） */
const DIP_Y = WATER - FEEDING.dipDepth;
/** 見せ場の終わり：漂う粒も食べられている途中の粒もなくなってから、これだけ待つ（秒） */
const QUIET_SECONDS = 5;

const ease = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

export class Feeding {
  private phase: Phase = 'idle';
  private t = 0;
  private jarIndex = 0;
  private readonly tip = new Vector3();
  private readonly obstacle = new Vector3();
  /** 出す粒の数と、もう出した数 */
  private total = 0;
  private emitted = 0;
  /** 見せ場（粒が食べられている間）。スポイトが去ったあとも続く */
  private showing = false;
  private showT = 0;
  private quietT = 0;
  /** 先が水の中にあるか（水面を通ったら波紋） */
  private wet = false;

  constructor(
    private readonly host: FeedingHost,
    private readonly pipette: Pipette,
    private readonly food: Food,
  ) {}

  /** スポイトを使っているところか（現れてから消えるまで） */
  get busy(): boolean {
    return this.phase !== 'idle';
  }

  /** スポイトか粒が見えている、または見せ場の途中 */
  get active(): boolean {
    return this.busy || this.showing || this.food.active;
  }

  /** 餌をやっている瓶 */
  get jar(): number {
    return this.jarIndex;
  }

  /** 確認用：今の段階 */
  get phaseName(): Phase {
    return this.phase;
  }

  /** 瓶 jar に餌をやりはじめる。grains は出す粒の数 */
  begin(jar: number, grains: number): void {
    if (this.active) this.abort();
    this.jarIndex = jar;
    this.total = grains;
    this.emitted = 0;
    this.showing = true;
    this.showT = 0;
    this.quietT = 0;
    this.food.clear();
    this.tip.set(this.pickSide(jar), FEEDING.startY, 0);
    this.wet = false;
    this.pipette.setTip(this.tip);
    this.pipette.setSqueeze(0);
    this.pipette.setLoad(1);
    this.pipette.setAlpha(0);
    this.enter('descend');
  }

  /** やめる（餌をやっている瓶が見えなくなった）：スポイトも粒もすぐ片付け、胃の色はすぐに食べた量の分にする */
  abort(): void {
    if (this.showing) this.host.finish(this.jarIndex, true);
    this.showing = false;
    this.phase = 'idle';
    this.pipette.setAlpha(0);
    this.food.clear();
    this.host.obstruct(this.jarIndex, null, 0);
  }

  update(dt: number): void {
    if (this.phase !== 'idle') this.stepPipette(dt);
    if (this.showing || this.food.active) this.food.update(dt, this.host.eaters(this.jarIndex));
    if (!this.showing) return;
    this.showT += dt;
    this.quietT = this.busy || this.food.moving ? 0 : this.quietT + dt;
    if (this.quietT > QUIET_SECONDS || this.showT > FOOD.showSeconds) {
      this.showing = false;
      this.host.finish(this.jarIndex, false);
    }
  }

  private enter(p: Phase): void {
    this.phase = p;
    this.t = 0;
  }

  /** 先を下ろす所：口の真ん中を基本に、水面の近くにいる海月から離れた所を選ぶ（左右に少しだけ） */
  private pickSide(jar: number): number {
    const r = FEEDING.sideRange;
    let best = 0;
    let bestScore = Infinity;
    for (const x of [0, -r / 2, r / 2, -r, r]) {
      let score = Math.abs(x) * 2;
      for (const j of this.host.swimmers(jar)) {
        const p = j.swimmer.pos;
        const near = Math.max(0, 1 - (WATER - p.y) / 0.35);
        const d2 = (p.x - x) ** 2 + p.z * p.z * 0.5;
        score += near * Math.exp(-d2 / (0.02 + j.radius * j.radius));
      }
      if (score < bestScore) {
        bestScore = score;
        best = x;
      }
    }
    return best;
  }

  private stepPipette(dt: number): void {
    const F = FEEDING;
    this.t += dt;
    switch (this.phase) {
      case 'descend':
        this.tip.y = F.startY + (DIP_Y - F.startY) * ease(this.t / F.descendSeconds);
        this.pipette.setAlpha(Math.min(1, this.t / F.fadeInSeconds));
        if (this.t >= F.descendSeconds) this.enter('settle');
        break;
      case 'settle':
        if (this.t >= F.settleSeconds) this.enter('squeeze');
        break;
      case 'squeeze': {
        const k = this.t / F.squeezeSeconds;
        this.pipette.setSqueeze(ease(k));
        // 押すにつれて、先から少しずつ出る
        const want = Math.round(this.total * ease((k - 0.1) / 0.8));
        if (want > this.emitted) {
          this.food.emit(this.tip, want - this.emitted);
          this.emitted = want;
        }
        this.pipette.setLoad(1 - this.emitted / Math.max(this.total, 1));
        if (this.t >= F.squeezeSeconds) this.enter('hold');
        break;
      }
      case 'hold':
        if (this.t >= F.holdSeconds) this.enter('withdraw');
        break;
      case 'withdraw': {
        this.tip.y = DIP_Y + (F.startY + 0.05 - DIP_Y) * ease(this.t / F.withdrawSeconds);
        // 押したまま先を水から抜き、水から出てから上がりながら球を戻す（水の中で戻すと吸い込んでしまう）
        this.pipette.setSqueeze(1 - 0.7 * ease((this.tip.y - (WATER + 0.02)) / 0.2));
        this.pipette.setAlpha(1 - ease((this.t - (F.withdrawSeconds - F.fadeOutSeconds)) / F.fadeOutSeconds));
        if (this.t >= F.withdrawSeconds) {
          this.phase = 'idle';
          this.pipette.setAlpha(0);
        }
        break;
      }
      default:
        break;
    }
    this.pipette.setTip(this.tip);
    // 先が水面を通るときに小さな波紋。水の中の先は、泳ぐ個体がよける
    const wet = this.phase !== 'idle' && this.tip.y < WATER;
    if (wet !== this.wet) {
      this.wet = wet;
      this.host.ripple(this.jarIndex, this.tip.x, this.tip.z, F.ripple, F.rippleRadius);
    }
    this.host.obstruct(this.jarIndex, wet ? this.obstacle.set(this.tip.x, this.tip.y + 0.02, this.tip.z) : null, F.obstacleRadius);
  }
}
