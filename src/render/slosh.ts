// 揺らされた瓶の水（瓶1つ分。瓶の座標で、瓶は原点）。
// 水面は減衰する振り子で傾く：重力（と揺れの慣性）に対して水平を保とうとし、端末の傾きより少し遅れてついてきて、
// 止めたあとは何度か往復してから静まる。
// 水の流れは3つを重ねる：
//   一様な流れ（瓶が動くと水が取り残され、壁に止められてすぐ消える）
//   水面の往復に合わせた流れ（水面が上がる側へ寄り、縁で上下する。深いほど弱い）
//   瓶の中を回る流れ（強く揺らすと生まれ、数秒かけて消える。端末を回したときは、水が取り残されて逆へ回る）
// 流れは瓶の中身を運ぶ。触手と口腕は水と一緒に、傘は遅れて（瓶から見ると先に動く）。
import { Vector2, Vector3 } from 'three';
import { JAR, MOTION, SLOSH, TUMBLE } from '../config';
import type { MotionSample } from '../ui/motionFilter';

const MAX_SLOPE = Math.tan((MOTION.maxTilt * Math.PI) / 180);
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
  /** 下向き（重力の向き。瓶の傾きの上限まで） */
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
  /** 軽くなっている度合い（0〜1）。強く揺れている間 1 へ、収まると TUMBLE.lightFall 秒で戻る */
  private light = 0;
  private acc = 0;
  /** 揺れの強さ（g、ならしたもの）と、振りはじめに決めた回る向き */
  private energy = 0;
  private readonly energyAxis = new Vector3(0, 0, 1);
  private readonly tmp = new Vector3();
  private readonly target = new Vector2();

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
    f.down.set(0, -1, 0);
    f.weight = 1;
    f.stir = 0;
    f.moving = false;
    this.rimSpeed = 0;
    this.light = 0;
    this.energy = 0;
  }

  /** 静かで、傾いてもいない（描くときに何も足さなくてよい） */
  get still(): boolean {
    return !this.field.moving && this.slope.lengthSq() < 1e-10 && this.slopeVel.lengthSq() < 1e-10;
  }

  /** 水面の波立ち（uAgitation）に足す分（0〜1） */
  get agitation(): number {
    return Math.min(1, (this.rimSpeed / 0.2) * SLOSH.agitation + this.field.stir * 0.5);
  }

  /**
   * dt 秒進める。input は瓶の座標の端末の動き（重力の向き・揺れ・回す速さ）。null なら端末は止まっていて、まっすぐ立っている
   */
  update(dt: number, input: MotionSample | null): void {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= SUBSTEP) {
      this.step(SUBSTEP, input);
      this.acc -= SUBSTEP;
    }
  }

  private step(dt: number, input: MotionSample | null): void {
    const f = this.field;
    const g = input?.gravity ?? [0, -1, 0];
    const a = input?.accel ?? [0, 0, 0];
    const spin = input?.spin ?? [0, 0, 0];

    // 水面：重力と揺れの慣性を合わせた向きに対して水平になろうとする（減衰する振り子）
    const ex = g[0] - a[0];
    const ey = g[1] - a[1];
    const ez = g[2] - a[2];
    // 上へ強く加速して「下」がなくなった瞬間は、前の向きのまま
    if (ey < -0.15) {
      this.target.set(-ex / ey, -ez / ey);
      const l = this.target.length();
      if (l > MAX_SLOPE) this.target.multiplyScalar(MAX_SLOPE / l);
    }
    const w = 2 * Math.PI * SLOSH.freq;
    const s = this.slope;
    const sv = this.slopeVel;
    sv.x += (w * w * (this.target.x - s.x) - 2 * SLOSH.damping * w * sv.x) * dt;
    sv.y += (w * w * (this.target.y - s.y) - 2 * SLOSH.damping * w * sv.y) * dt;
    s.addScaledVector(sv, dt);
    const sl = s.length();
    if (sl > MAX_SLOPE * 1.3) s.multiplyScalar((MAX_SLOPE * 1.3) / sl);

    // 下向き（中身が沈む・垂れる向き）は、傾きの上限までの重力の向き
    f.down.set(g[0], g[1], g[2]).normalize();

    // 一様な流れ：瓶が動くと水が取り残され、壁に止められてすぐ消える
    const fl = this.flow;
    fl.x += (-a[0] * SLOSH.flowGain - fl.x / SLOSH.flowDecay) * dt;
    fl.y += (-a[1] * SLOSH.flowGain - fl.y / SLOSH.flowDecay) * dt;
    fl.z += (-a[2] * SLOSH.flowGain - fl.z / SLOSH.flowDecay) * dt;
    if (fl.length() > SLOSH.maxFlow) fl.setLength(SLOSH.maxFlow);

    // 回る流れ：横に揺らすと、水面に近い所ほど強く取り残されて、瓶の中を縦に回る（上 × 揺れと逆向き）
    const sw = this.swirl;
    sw.x += (-a[2] * SLOSH.swirlGain - sw.x / SLOSH.swirlDecay) * dt;
    sw.y += (-sw.y / SLOSH.swirlDecay) * dt;
    sw.z += (a[0] * SLOSH.swirlGain - sw.z / SLOSH.swirlDecay) * dt;
    // 何往復も振ると、往復は打ち消しあうが、水はかき混ぜられて回りだす。向きは振りはじめの揺れで決める
    const am = Math.hypot(a[0], a[1], a[2]);
    const wasCalm = this.energy < SLOSH.energyFloor;
    this.energy += (am - this.energy) * (1 - Math.exp(-dt / SLOSH.energySmooth));
    if (wasCalm && am > SLOSH.energyFloor) {
      // 上 × 揺れと逆向き（ほとんど画面の中で回る向き）。上下にだけ振ったときは、画面の中で回す
      this.energyAxis.set(-a[2] * 0.5, 0, a[0]);
      if (this.energyAxis.lengthSq() < 1e-6) this.energyAxis.set(0, 0, a[1] >= 0 ? 1 : -1);
      this.energyAxis.normalize();
    }
    const drive = Math.max(0, this.energy - SLOSH.energyFloor) * SLOSH.energySwirl;
    sw.addScaledVector(this.energyAxis, (drive / SLOSH.swirlDecay) * dt);
    if (sw.length() > SLOSH.maxSwirl) sw.setLength(SLOSH.maxSwirl);
    // 端末を回したときは、水が取り残されて逆へ回る
    f.omega.set(sw.x - spin[0] * SLOSH.spinFollow, sw.y - spin[1] * SLOSH.spinFollow, sw.z - spin[2] * SLOSH.spinFollow);
    if (f.omega.length() > SLOSH.maxSwirl) f.omega.setLength(SLOSH.maxSwirl);

    // 水面の縁の上下の速さ（いちばん速い向き）
    this.rimSpeed = sv.length() * INNER_R;
    if (this.rimSpeed > 1e-6) this.rimDir.copy(sv).normalize();

    // 流れの強さ：揺れで取り残された水と、回る流れ（傾けただけの水面の往復と、ゆっくり回したぶんは数えない）。
    // 上がるのはすぐ、下がるのはゆっくり
    const speed = fl.length() + sw.length() * 0.2 + (f.omega.length() - sw.length()) * 0.05;
    const stirNow = Math.min(1, speed / SLOSH.stirFlow);
    f.stir = stirNow > f.stir ? stirNow : f.stir + (stirNow - f.stir) * (1 - Math.exp(-dt / SLOSH.stirFall));
    // 強く揺れている間、触手と口腕は軽くなる（ふわっと舞い上がる）。収まるとゆっくり重さが戻る
    this.light = f.stir > this.light ? f.stir : this.light * Math.exp(-dt / TUMBLE.lightFall);
    // 急に下げたとき（下向きの揺れ）は、その間さらに軽い
    const drop = Math.max(0, -(a[0] * g[0] + a[1] * g[1] + a[2] * g[2]));
    f.weight = Math.max(0, (1 - TUMBLE.float * this.light) * (1 - Math.min(drop, 1)));
    f.moving = speed > 1e-4 || this.light > 0.01 || this.rimSpeed > 1e-4;

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
