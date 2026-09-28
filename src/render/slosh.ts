// 揺らされた瓶の水（瓶1つ分。瓶の座標で、瓶は原点）。
// 端末の傾きには追従しない。振った一回ぶんの勢い（Kick）を受けて動き、何度か揺れて静まる：
//   水面は減衰する振り子で、振った向きの側が下がるように往復する
//   一様な流れ（振った向きと逆へ水が取り残され、壁に止められてすぐ消える）
//   水面の往復に合わせた流れ（水面が上がる側へ寄り、縁で上下する。深いほど弱い）
//   瓶の中を回る流れ（数秒かけて消える。続けて振ると、はじめの一回で決めた向きに回り続ける。回したときは、回した向きと逆）
// 勢いはいきなりではなく、少しの間にゆっくり立ち上がってから与える。
// 流れは瓶の中身を運ぶ。触手と口腕は水と一緒に、傘は遅れて（瓶から見ると先に動く）。
import { Vector2, Vector3 } from 'three';
import { JAR, KICK, SLOSH, TUMBLE } from '../config';
import type { Kick } from '../ui/motionFilter';

const MAX_SLOPE = Math.tan((SLOSH.maxTilt * Math.PI) / 180);
const INNER_R = JAR.radius - JAR.glassThickness;
const SUBSTEP = 1 / 120;

/** 水の流れを、触手や粒の計算の中で速く求めるための値（WaterMotion.field） */
export interface WaterField {
  /** 流れがあるか。なければ触手・口腕・傘は今までどおり（止まった水の中） */
  moving: boolean;
  /** 一様な流れ（瓶の高さ/秒） */
  flow: Vector3;
  /** 回る流れ（ラジアン/秒、回転軸×速さ）と、その中心 */
  omega: Vector3;
  center: Vector3;
  /** 水面の傾きの変わる速さ（水面の往復に合わせた流れ） */
  slopeVel: Vector2;
  /** 下向き（中身が沈む・垂れる向き。端末の傾きは使わないので、いつも瓶の真下） */
  down: Vector3;
  /** 触手と口腕の重さの割合（1 がふだん。強く揺れている間は軽くなり、ふわっと舞い上がる） */
  weight: number;
  /** 流れの強さ（0〜1） */
  stir: number;
}

/** 点 p の水の流れの速さ（瓶の高さ/秒） */
export function flowAt(f: WaterField, x: number, y: number, z: number, out: Vector3): Vector3 {
  if (!f.moving) return out.set(0, 0, 0);
  const o = f.omega;
  const rx = x - f.center.x;
  const ry = y - f.center.y;
  const rz = z - f.center.z;
  // 水面の往復：水面が上がっていく側へ寄り、縁で上下する（深いほど弱い）
  const e = Math.exp((y - JAR.waterLevel) / SLOSH.sloshDepth) * SLOSH.sloshFlow;
  const sv = f.slopeVel;
  return out.set(
    f.flow.x + o.y * rz - o.z * ry + sv.x * SLOSH.sloshDepth * e,
    f.flow.y + o.z * rx - o.x * rz + (sv.x * x + sv.y * z) * e,
    f.flow.z + o.x * ry - o.y * rx + sv.y * SLOSH.sloshDepth * e,
  );
}

export class WaterMotion {
  /** 水面の傾き：高さ = 水位 + slope.x·x + slope.y·z */
  readonly slope = new Vector2();
  private readonly slopeVel = new Vector2();
  private readonly flow = new Vector3();
  private readonly swirl = new Vector3();
  /** 流れに運ばれたマリンスノーのずれ（ずれた量と、回った量）。粒は描くたびに場所を決めるので、ずれとして持つ */
  readonly snowShift = new Vector3();
  readonly snowTurn = new Vector3();
  /** 触手・口腕・傘・粒に渡す流れ */
  readonly field: WaterField = {
    moving: false,
    flow: this.flow,
    omega: new Vector3(),
    center: new Vector3(0, SLOSH.centerY, 0),
    slopeVel: this.slopeVel,
    down: new Vector3(0, -1, 0),
    weight: 1,
    stir: 0,
  };
  /** 水面の縁がいちばん速く上下している所の速さ（瓶の高さ/秒）と、その向き（x, z の単位ベクトル）。飛沫に使う */
  rimSpeed = 0;
  readonly rimDir = new Vector2(1, 0);
  /** 強い一回を振った直後（飛沫を跳ねさせる）：勢いの大きさと、水が寄る側（x, z の単位ベクトル）。Splash が読んだら 0 にする */
  splashKick = 0;
  readonly splashDir = new Vector2(1, 0);
  /** 軽くなっている度合い（0〜1）。強く揺れている間 1 へ、収まると TUMBLE.lightFall 秒で戻る */
  private light = 0;
  private acc = 0;
  /** 与えている途中の勢い：残りの時間と、与えきったときの水面の速さ・流れ・回る流れ */
  private readonly pending: Array<{ t: number; slope: Vector2; flow: Vector3; swirl: Vector3 }> = [];
  /** 続けて振っている間の回る向き（はじめの一回で決める）と、最後に振ってからの秒 */
  private readonly episodeAxis = new Vector3(0, 0, 1);
  private sinceKick = Infinity;
  private readonly tmp = new Vector3();

  /** 静かな水に戻す（瓶が見えなくなったとき） */
  reset(): void {
    this.slope.set(0, 0);
    this.slopeVel.set(0, 0);
    this.flow.set(0, 0, 0);
    this.swirl.set(0, 0, 0);
    this.snowShift.set(0, 0, 0);
    this.snowTurn.set(0, 0, 0);
    const f = this.field;
    f.omega.set(0, 0, 0);
    f.weight = 1;
    f.stir = 0;
    f.moving = false;
    this.rimSpeed = 0;
    this.light = 0;
    this.pending.length = 0;
    this.sinceKick = Infinity;
    this.splashKick = 0;
  }

  /** 静かで、傾いてもいない（描くときに何も足さなくてよい） */
  get still(): boolean {
    return !this.field.moving && !this.pending.length && this.slope.lengthSq() < 1e-10 && this.slopeVel.lengthSq() < 1e-10;
  }

  /** 水面の波立ち（uAgitation）に足す分（0〜1） */
  get agitation(): number {
    return Math.min(1, (this.rimSpeed / 0.2) * SLOSH.agitation + this.field.stir * 0.5);
  }

  /**
   * 振った一回ぶんの勢いを与える（KICK.spread 秒かけて、ゆっくり立ち上がってから）。
   * 振った向きの側の水面が下がり、水は逆へ取り残され、瓶の中を回りだす
   */
  kick(k: Kick): void {
    const [dx, dy, dz] = k.dir;
    const m = k.size;
    const slope = new Vector2();
    const flow = new Vector3();
    const swirl = new Vector3();
    if (k.spin) {
      // 回した：水は取り残されて、回した向きと逆へ回る。水面も少し揺れる
      swirl.set(-dx, -dy, -dz).multiplyScalar(SLOSH.kickSwirl * m);
      slope.set(-dz, dx).multiplyScalar(SLOSH.kickSlope * m * 0.4);
    } else {
      // 振った：振った向きの側の水面が下がる（水は逆側へ寄る）。水は逆へ取り残される
      slope.set(-dx, -dz).multiplyScalar(SLOSH.kickSlope * m);
      flow.set(-dx, -dy, -dz).multiplyScalar(SLOSH.kickFlow * m);
      // 回る向きは、続けて振っている間ははじめの一回のまま（往復して打ち消しあわないように）。上 × 振った向きと逆向き
      if (this.sinceKick > KICK.episode) {
        this.episodeAxis.set(-dz * 0.5, 0, dx);
        if (this.episodeAxis.lengthSq() < 1e-6) this.episodeAxis.set(0, 0, dy >= 0 ? 1 : -1);
        this.episodeAxis.normalize();
      }
      swirl.copy(this.episodeAxis).multiplyScalar(SLOSH.kickSwirl * m);
      this.sinceKick = 0;
    }
    this.pending.push({ t: 0, slope, flow, swirl });
    // 水は振った向きと逆の側へ寄って、縁から跳ねる
    if (!k.spin && Math.hypot(dx, dz) > 0.2) {
      this.splashKick = Math.max(this.splashKick, m);
      this.splashDir.set(-dx, -dz).normalize();
    }
  }

  /** dt 秒進める */
  update(dt: number): void {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= SUBSTEP) {
      this.step(SUBSTEP);
      this.acc -= SUBSTEP;
    }
  }

  private step(dt: number): void {
    const f = this.field;
    this.sinceKick += dt;
    const s = this.slope;
    const sv = this.slopeVel;
    const fl = this.flow;
    const sw = this.swirl;
    // 勢いを、ゆっくり立ち上がる形（sin² の山）で KICK.spread 秒かけて与える
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]!;
      const t0 = p.t / KICK.spread;
      p.t += dt;
      const t1 = Math.min(p.t / KICK.spread, 1);
      const share = (x: number): number => x - Math.sin(2 * Math.PI * x) / (2 * Math.PI);
      const k = share(t1) - share(t0);
      sv.addScaledVector(p.slope, k);
      fl.addScaledVector(p.flow, k);
      sw.addScaledVector(p.swirl, k);
      if (t1 >= 1) this.pending.splice(i, 1);
    }

    // 水面：まっすぐに戻ろうとする減衰する振り子（端末の傾きには追従しない）
    const w = 2 * Math.PI * SLOSH.freq;
    sv.x += (-w * w * s.x - 2 * SLOSH.damping * w * sv.x) * dt;
    sv.y += (-w * w * s.y - 2 * SLOSH.damping * w * sv.y) * dt;
    s.addScaledVector(sv, dt);
    const sl = s.length();
    if (sl > MAX_SLOPE) {
      s.multiplyScalar(MAX_SLOPE / sl);
      // 上限に当たったら、外へ向かう速さを弱める
      const out = sv.dot(s) / MAX_SLOPE;
      if (out > 0) sv.addScaledVector(s, (-out * 0.7) / MAX_SLOPE);
    }

    // 取り残された流れは壁に止められてすぐ消え、回る流れは数秒かけて消える
    fl.multiplyScalar(Math.exp(-dt / SLOSH.flowDecay));
    if (fl.length() > SLOSH.maxFlow) fl.setLength(SLOSH.maxFlow);
    sw.multiplyScalar(Math.exp(-dt / SLOSH.swirlDecay));
    if (sw.length() > SLOSH.maxSwirl) sw.setLength(SLOSH.maxSwirl);
    f.omega.copy(sw);

    // 水面の縁の上下の速さ（いちばん速い向き）
    this.rimSpeed = sv.length() * INNER_R;
    if (this.rimSpeed > 1e-6) this.rimDir.copy(sv).normalize();

    // 流れの強さ：取り残された水と、回る流れ（水面の往復は数えない）。上がるのはすぐ、下がるのはゆっくり
    const speed = fl.length() + sw.length() * 0.2;
    const stirNow = Math.min(1, speed / SLOSH.stirFlow);
    f.stir = stirNow > f.stir ? stirNow : f.stir + (stirNow - f.stir) * (1 - Math.exp(-dt / SLOSH.stirFall));
    // 強く揺れている間、触手と口腕は軽くなる（ふわっと舞い上がる）。収まるとゆっくり重さが戻る
    this.light = f.stir > this.light ? f.stir : this.light * Math.exp(-dt / TUMBLE.lightFall);
    f.weight = Math.max(0, 1 - TUMBLE.float * this.light);
    f.moving = speed > 1e-4 || this.light > 0.01 || this.rimSpeed > 1e-4 || this.pending.length > 0;

    // マリンスノーのずれ：流れに運ばれ、ゆっくり元へ戻る
    const k = 1 / SLOSH.snowReturn;
    const sh = this.snowShift;
    flowAt(f, 0, SLOSH.centerY, 0, this.tmp);
    sh.x += (this.tmp.x - sh.x * k) * dt;
    sh.y += (this.tmp.y - sh.y * k) * dt;
    sh.z += (this.tmp.z - sh.z * k) * dt;
    const tn = this.snowTurn;
    tn.x += (f.omega.x - tn.x * k) * dt;
    tn.y += (f.omega.y - tn.y * k) * dt;
    tn.z += (f.omega.z - tn.z * k) * dt;
    if (tn.length() > SLOSH.maxSnowTurn) tn.setLength(SLOSH.maxSnowTurn);
  }
}
