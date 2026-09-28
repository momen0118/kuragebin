// 泳ぎ。収縮の瞬間に前へ進み、緩和中はゆっくり沈む。
// 壁・底・水面が近づくと向きを緩やかに変え、ぶつからない。
import { Quaternion, Vector2, Vector3 } from 'three';
import { BELL, EPHYRA, JAR, POKE, SCOOP, SWIM, TUMBLE } from '../../config';
import type { Rng } from '../../sim/rng';
import { flowAt, type WaterField } from '../slosh';
import type { Pulse } from './pulse';

const UP = new Vector3(0, 1, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpQ = new Quaternion();
const tmpC = new Vector3();
const tmpUp = new Vector3();
const RIGHT_AT = Math.cos((TUMBLE.rightAt * Math.PI) / 180);
const RIGHTED_AT = Math.cos((TUMBLE.rightedAt * Math.PI) / 180);

/** 傘の中心が動ける範囲。low は漂って沈んでいく先の下限（ひとりのときの泳ぎ方を決める） */
export interface SwimBounds {
  radius: number;
  bottom: number;
  top: number;
  low: number;
}

/** ほかの泳ぐ個体（近づきすぎたらよける）。obstacle は個体でないもの（水の中のカップ） */
export interface Neighbor {
  pos: Vector3;
  radius: number;
  obstacle?: boolean;
}

/** 大きさと、ぎこちなさ（エフィラ）で変わる泳ぎの強さ。成体は SWIM の値そのもの */
interface SwimScale {
  thrust: number;
  sink: number;
  lookAhead: number;
  righting: number;
  roll: number;
  /** 縮むたびに転がる強さ */
  tumble: number;
  /** 漂うときの拍動の間とゆっくりさの割合（エフィラは間をあけずに打ち続ける） */
  driftRest: number;
  driftTempo: number;
}

const ADULT_SCALE: SwimScale = { thrust: 1, sink: 1, lookAhead: 1, righting: 1, roll: 1, tumble: 0, driftRest: 1, driftTempo: 1 };

export function swimBounds(bellRadius: number = BELL.radius): SwimBounds {
  const inner = JAR.radius - JAR.glassThickness;
  // 小さなエフィラは底の近くまで降りられる（瓶底のポリプより上）
  const low = Math.min(Math.max(bellRadius / BELL.radius, 0.5), 1);
  return {
    radius: inner - bellRadius - SWIM.sidePadding,
    bottom: JAR.bottomThickness + SWIM.bottomPadding * low,
    top: JAR.waterLevel - bellRadius * BELL.apexY - SWIM.topPadding,
    low: JAR.bottomThickness + SWIM.driftPadding * low,
  };
}

export class Swimmer {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  /** 傘の向き（ローカルの +y が傘の頂点の向き） */
  readonly quat = new Quaternion();
  readonly axis = new Vector3(0, 1, 0);
  private readonly angVel = new Vector3();
  private rollVel = 0;
  private readonly wander = new Vector3(0, 1, 0);
  private readonly wanderTarget = new Vector3(0, 1, 0);
  private wanderTimer = 0;
  private readonly goal = new Vector2();
  /** 上へ泳ぐか、ゆっくり沈むか */
  private mode: 'cruise' | 'drift' = 'drift';
  private modeTimer = 0;
  /** 今の調子で目指す高さ */
  private modeTarget = 0;
  /** 瓶の中のごくゆるい流れ（向きがゆっくり変わる） */
  private currentPhase: number;
  /** ときどき大きく傾く：次に傾くまでの時間、傾いている残りの時間、傾く向き */
  private leanTimer: number;
  private leanLeft = 0;
  private readonly leanDir = new Vector3(0, 1, 0);

  /** 大きさとぎこちなさ（setForm） */
  private scale: SwimScale = ADULT_SCALE;
  private radius: number = BELL.radius;
  private wasContracting = false;
  /** 瓶底から離れたばかり（秒）。泳げる範囲の下にいても押し上げず、自分で泳いで上がる */
  private rising = 0;
  /** ほかに泳ぐ個体がいる（沈んでいく先を底の近くまで広げる） */
  private crowded = false;
  /** カップの水の中にいるときの、ついていく先（ワールド）。null なら瓶の中を泳いでいる */
  private carried: Vector3 | null = null;
  /** カップの中での揺れの強さの倍率 */
  private carryStiff = 1;
  /** カップの中で傘を合わせる向き（水の中でカップを傾けるとき、カップの軸）。null ならまっすぐ上 */
  private carryUp: Vector3 | null = null;
  /** ついていく先の前の位置となめらかにした速さ、先からのずれ（揺れ）とその速さ */
  private readonly carryPrev = new Vector3();
  private readonly carryVel = new Vector3();
  private readonly carryOff = new Vector3();
  private readonly carryOffVel = new Vector3();
  /** カップの水ごと動いた量（この刻みの分）。触手と口腕も水と一緒に動かす。水ごとでないときは 0 */
  readonly carryShift = new Vector3();
  private carryWithWater = true;
  /** 水に沈めたカップから、自分の拍動で泳いで出ていく間の道筋：カップの底の真ん中と、カップの軸 */
  private guided = false;
  private readonly guideBase = new Vector3();
  private readonly guideAxis = new Vector3(0, 1, 0);
  /** 揺れの流れに転がされている度合い（0〜1）。流れの強さに合わせてすぐ上がり、ゆっくり下がる */
  private tumble = 0;
  /** 流れのあと大きく傾いていて、拍動で起き直っている最中 */
  private righting = false;

  constructor(
    private readonly rng: Rng,
    private bounds: SwimBounds = swimBounds(),
  ) {
    const b = bounds;
    const r = rng.range(0, b.radius * 0.6);
    const th = rng.range(0, Math.PI * 2);
    this.pos.set(r * Math.cos(th), rng.range(b.bottom + 0.1, b.top - 0.1), r * Math.sin(th));
    const tilt = new Vector3(rng.range(-0.3, 0.3), 1, rng.range(-0.3, 0.3)).normalize();
    this.quat.setFromUnitVectors(UP, tilt);
    this.quat.multiply(tmpQ.setFromAxisAngle(UP, rng.range(0, Math.PI * 2)));
    this.axis.copy(UP).applyQuaternion(this.quat);
    this.wander.copy(this.axis);
    this.pickWander();
    this.modeTimer = SWIM.driftMaxTime;
    this.modeTarget = this.pickTarget('drift');
    this.rollVel = rng.range(-1, 1) * SWIM.rollSpeed;
    this.currentPhase = rng.range(0, Math.PI * 2);
    this.leanTimer = rng.range(SWIM.leanInterval[0] * 0.3, SWIM.leanInterval[1] * 0.6);
  }

  /**
   * 大きさ（傘の半径）とぎこちなさ（1 でエフィラ、0 で成体）。小さいほど弱く押し出してゆっくり沈み、
   * エフィラはよく転がり、起き上がりが弱く、軸まわりによく回る
   */
  setForm(radius: number, jerk: number): void {
    if (radius !== this.radius) {
      this.radius = radius;
      this.bounds = swimBounds(radius);
    }
    if (radius === BELL.radius && jerk <= 0) {
      this.scale = ADULT_SCALE;
      return;
    }
    const k = radius / BELL.radius;
    const mix = (a: number, b: number): number => a + (b - a) * jerk;
    this.scale = {
      thrust: k ** 0.8 * mix(1, EPHYRA.thrust),
      sink: k,
      lookAhead: Math.max(k, 0.3),
      righting: mix(1, EPHYRA.righting),
      roll: mix(1, EPHYRA.roll),
      tumble: EPHYRA.tumble * jerk,
      driftRest: mix(1, 0.15),
      driftTempo: mix(1, 1 / SWIM.driftTempo),
    };
  }

  /**
   * 位置と向きを決めなおす。速さは vel。ストロビラから離れたエフィラは泳いで上がる（cruise）
   */
  place(pos: Vector3, up: Vector3, vel: Vector3, mode: 'cruise' | 'drift' = 'cruise'): void {
    this.carried = null;
    this.guided = false;
    this.rising = pos.y < this.bounds.bottom ? 8 : 0;
    this.pos.copy(pos);
    this.vel.copy(vel);
    this.quat.setFromUnitVectors(UP, tmpA.copy(up).normalize());
    this.axis.copy(UP).applyQuaternion(this.quat);
    this.wander.copy(this.axis);
    this.angVel.set(0, 0, 0);
    this.mode = mode;
    this.modeTimer = mode === 'cruise' ? SWIM.cruiseMaxTime * 0.3 : SWIM.driftMaxTime;
    this.modeTarget = this.pickTarget(mode);
  }


  /**
   * カップの水の中にいる。泳がずに target へ水ごと運ばれ、遅れて小さく揺れる。
   * stiff はついていく強さの倍率。up を渡すと、傘をその向きへ合わせる（水の中で傾けたカップの軸）。
   * null で瓶の中を泳ぐのに戻る（戻すときは place で置きなおす）
   */
  carry(target: Vector3 | null, stiff = 1, withWater = true, up: Vector3 | null = null): void {
    this.carryWithWater = withWater;
    this.guided = false;
    if (!target) {
      this.carried = null;
      this.carryUp = null;
      this.carryShift.set(0, 0, 0);
      return;
    }
    if (up) (this.carryUp ??= new Vector3()).copy(up).normalize();
    else this.carryUp = null;
    if (!this.carried) {
      this.carried = new Vector3().copy(target);
      this.carryPrev.copy(target);
      this.carryVel.set(0, 0, 0);
      this.carryOff.copy(this.pos).sub(target);
      this.carryOffVel.copy(this.vel);
    }
    this.carried.copy(target);
    this.carryStiff = stiff;
  }

  get isCarried(): boolean {
    return this.carried !== null;
  }

  /**
   * 水に沈めて傾けたカップから、自分の拍動で泳いで出ていく。カップの軸 axis に沿ってだけ進み（壁を抜けない）、
   * 傘はカップの軸へ向く。base はカップの底の真ん中（ワールド）。カップが動いている間は毎フレーム呼びなおす
   */
  guide(base: Vector3, axis: Vector3): void {
    if (!this.guided) {
      this.guided = true;
      this.carried = null;
      this.carryUp = null;
      this.carryShift.set(0, 0, 0);
    }
    this.guideBase.copy(base);
    this.guideAxis.copy(axis).normalize();
  }

  /** カップから泳いで出ていくところか */
  get isGuided(): boolean {
    return this.guided;
  }

  /** 泳いで出ていく間、カップの底からカップの軸に沿って進んだ長さ */
  get guideProgress(): number {
    return tmpA.copy(this.pos).sub(this.guideBase).dot(this.guideAxis);
  }

  /** カップから出た：姿勢も動きもそのままで、瓶の中の泳ぎに戻る（drift ならゆっくり沈んでいく） */
  letGo(vel: Vector3, mode: 'cruise' | 'drift'): void {
    this.carried = null;
    this.carryUp = null;
    this.guided = false;
    this.carryShift.set(0, 0, 0);
    this.vel.copy(vel);
    this.rising = 0;
    this.mode = mode;
    this.modeTimer = mode === 'cruise' ? SWIM.cruiseMaxTime * 0.3 : SWIM.driftMaxTime;
    this.modeTarget = this.pickTarget(mode);
  }

  /** 瓶から瓶へ座標を移す（x を dx だけずらす）。動きはそのまま */
  translate(dx: number): void {
    this.pos.x += dx;
    if (this.carried) {
      this.carried.x += dx;
      this.carryPrev.x += dx;
    }
  }

  /**
   * カップの中：カップの水ごと運ばれる。カップが動きを変えると、水の中で慣性で少し取り残されて揺れ、
   * ずれた向きと反対へ少し傾く（ずれはカップの中に収まる大きさまで）。拍動は続くが、押し出しはしない
   */
  private stepCarried(dt: number): void {
    const target = this.carried!;
    const stiff = this.carryStiff;
    // ついていく先の速さ（なめらかに）と、その変わり方（加速度）
    if (this.carryWithWater) this.carryShift.copy(target).sub(this.carryPrev);
    else this.carryShift.set(0, 0, 0);
    const raw = tmpA.copy(target).sub(this.carryPrev).divideScalar(Math.max(dt, 1e-4));
    this.carryPrev.copy(target);
    const before = tmpB.copy(this.carryVel);
    this.carryVel.lerp(raw, 1 - Math.exp(-25 * dt));
    const acc = before.sub(this.carryVel).divideScalar(-Math.max(dt, 1e-4));
    const k = SCOOP.jellySpring * stiff;
    const c = SCOOP.jellyDamping * Math.sqrt(stiff);
    const off = this.carryOff;
    const ov = this.carryOffVel;
    ov.x += (-k * off.x - c * ov.x - acc.x) * dt;
    ov.y += (-k * off.y - c * ov.y - acc.y) * dt;
    ov.z += (-k * off.z - c * ov.z - acc.z) * dt;
    off.addScaledVector(ov, dt);
    const max = SCOOP.jellySway / stiff;
    const len = off.length();
    if (len > max) {
      off.multiplyScalar(max / len);
      ov.multiplyScalar(0.5);
    }
    this.pos.copy(target).add(off);
    this.vel.copy(this.carryVel).add(ov);
    // ずれた向きと反対へ少し傾く。水の中で傾けたカップでは、傘もカップの軸へ向く（壁に沿って一緒に傾く）
    const up = this.carryUp;
    const desired = tmpA.copy(up ?? UP).add(tmpB.set(-off.x * SCOOP.jellyTilt, 0, -off.z * SCOOP.jellyTilt)).normalize();
    if (up) this.turnToward(desired, SCOOP.jellyTurn, SCOOP.jellyTurnDamping, dt);
    else this.turnToward(desired, SWIM.turnGain, SWIM.turnDamping, dt);
  }

  /** 傘の向きを desired へ、ばね（gain）と減衰で回す */
  private turnToward(desired: Vector3, gain: number, damping: number, dt: number): void {
    const torque = tmpB.crossVectors(this.axis, desired);
    this.angVel.addScaledVector(torque, gain * dt);
    this.angVel.multiplyScalar(Math.exp(-damping * dt));
    const w = this.angVel.length();
    if (w > 1e-6) {
      tmpQ.setFromAxisAngle(tmpB.copy(this.angVel).divideScalar(w), w * dt);
      this.quat.premultiply(tmpQ).normalize();
    }
    this.axis.copy(UP).applyQuaternion(this.quat);
  }

  /**
   * 水に沈めたカップから泳いで出ていく：拍動のたびにカップの軸に沿ってふわっと進む（ふだんより強く押し、抵抗は小さく）。
   * 軸から外れた分は戻し、カップの底のほうへは戻らない。沈む力はかけない
   */
  private stepGuided(dt: number, pulse: Pulse): void {
    const S = this.scale;
    pulse.setStyle(1, 0, 1);
    const A = this.guideAxis;
    const thrust = SWIM.thrust * Math.max(S.thrust, SCOOP.exitMinThrust) * SCOOP.exitThrust;
    this.vel.addScaledVector(this.axis, thrust * pulse.thrustRate() * dt);
    this.vel.multiplyScalar(Math.exp(-SCOOP.exitDrag * dt));
    const along = Math.max(this.vel.dot(A), 0);
    this.vel.copy(A).multiplyScalar(along);
    this.pos.addScaledVector(this.vel, dt);
    // 軸からのずれ（カップの壁のほう）を戻す
    const rel = tmpA.copy(this.pos).sub(this.guideBase);
    const s = rel.dot(A);
    rel.addScaledVector(A, -s);
    this.pos.addScaledVector(rel, -Math.min(1, 5 * dt));
    this.turnToward(tmpA.copy(A), SCOOP.jellyTurn, SCOOP.jellyTurnDamping, dt);
  }

  /** 揺れのあと、拍動で起き直っている最中か */
  get isRighting(): boolean {
    return this.righting;
  }

  /**
   * 確認用：逆さまにして、流れが収まった直後のようにする（拍動で起き直るところを見る）
   */
  flipForDebug(): void {
    this.carried = null;
    this.guided = false;
    this.quat.setFromUnitVectors(UP, tmpA.set(this.rng.range(-0.25, 0.25), -1, this.rng.range(-0.15, 0.15)).normalize());
    this.axis.copy(UP).applyQuaternion(this.quat);
    this.angVel.set(0, 0, 0);
    this.leanLeft = 0;
    this.tumble = 0;
    this.righting = true;
  }

  /** 大きく傾いている最中か */
  get leaning(): boolean {
    return this.leanLeft > 0;
  }

  /**
   * 大きく傾きはじめる。手前へ傾くことが多く、斜め上や真上から四つ葉が見える。
   * 手前の壁に近いときは、瓶の真ん中のほうへ傾く
   */
  private startLean(): void {
    const tilt = this.rng.range(SWIM.leanTilt[0], SWIM.leanTilt[1]);
    let az: number;
    if (this.rng.next() < SWIM.leanTowardViewer && this.pos.z < this.bounds.radius * 0.4) {
      az = this.rng.range(-0.6, 0.6);
    } else {
      const toCenter = Math.atan2(-this.pos.x, -this.pos.z);
      az = Math.hypot(this.pos.x, this.pos.z) > this.bounds.radius * 0.4 ? toCenter + this.rng.range(-0.8, 0.8) : this.rng.range(-Math.PI, Math.PI);
    }
    this.leanDir.set(Math.sin(tilt) * Math.sin(az), Math.cos(tilt), Math.sin(tilt) * Math.cos(az));
    this.leanLeft = this.rng.range(SWIM.leanDuration[0], SWIM.leanDuration[1]);
    this.leanTimer = this.rng.range(SWIM.leanInterval[0], SWIM.leanInterval[1]);
  }

  /** つつかれた点から離れる。strength は 0〜1 */
  flee(point: Vector3, strength: number): void {
    const away = tmpB.copy(this.pos).sub(point);
    away.y *= 0.5;
    if (away.lengthSq() < 1e-8) away.set(0, 1, 0);
    away.normalize();
    this.vel.addScaledVector(away, POKE.push * strength);
    // 傘の向きも少し離れる方へ
    const torque = tmpA.crossVectors(this.axis, away);
    this.angVel.addScaledVector(torque, POKE.turn * strength);
  }

  /** 次に沈んでいく先、または泳いで上がる先の高さ */
  private pickTarget(mode: 'cruise' | 'drift'): number {
    const b = this.bounds;
    const [lo, hi] = mode === 'drift' ? SWIM.driftTargetLow : SWIM.cruiseTargetHigh;
    // ほかの個体がいるときは、底の近くまで沈んでいく（瓶の下のほうも使う）
    const low = this.crowded ? b.bottom : b.low;
    return low + (b.top - low) * this.rng.range(lo, hi);
  }

  /** 瓶の中の行きたい場所（水平）を決めなおす */
  private pickWander(): void {
    const r = Math.sqrt(this.rng.next()) * this.bounds.radius * 0.9;
    const th = this.rng.range(0, Math.PI * 2);
    this.goal.set(r * Math.cos(th), r * Math.sin(th));
    this.wanderTimer = this.rng.range(SWIM.wanderMin, SWIM.wanderMax);
  }

  /** 行きたい場所へ向かう傾き。遠いほど大きく傾く */
  private aimWander(): void {
    const dx = this.goal.x - this.pos.x;
    const dz = this.goal.y - this.pos.z;
    const d = Math.hypot(dx, dz);
    const tilt = Math.min(d * 6, SWIM.wanderTilt);
    if (d > 1e-4) this.wanderTarget.set((dx / d) * tilt, SWIM.upBias, (dz / d) * tilt).normalize();
    else this.wanderTarget.copy(UP);
  }

  /**
   * water は揺らされた瓶の水の流れ（なければ止まった水）。傘は流れに遅れてついていき、回る流れに乗って転がる。
   * 強く流れている間は向きを変えられず、収まったあと大きく傾いていたら、拍動のたびに少しずつ起き直る
   */
  update(dt: number, pulse: Pulse, others: readonly Neighbor[] = [], water: WaterField | null = null): void {
    if (this.carried) {
      this.stepCarried(dt);
      return;
    }
    if (this.guided) {
      this.stepGuided(dt, pulse);
      return;
    }
    const moving = water !== null && water.moving;
    // 上（起き直る向き）は重力の逆。瓶を傾けたままにしていれば、傾いた上
    const up = water ? tmpUp.copy(water.down).negate() : tmpUp.copy(UP);
    const stir = moving ? water.stir : 0;
    this.tumble = stir > this.tumble ? stir : this.tumble + (stir - this.tumble) * (1 - Math.exp(-dt / 1.5));
    const tumbling = this.tumble > TUMBLE.calm;
    const upDot = this.axis.dot(up);
    if (tumbling) this.righting = false;
    else if (!this.righting && upDot < RIGHT_AT) this.righting = true;
    else if (this.righting && upDot > RIGHTED_AT) this.righting = false;
    const S = this.scale;
    this.crowded = others.some((o) => o.pos !== this.pos && !o.obstacle);
    // エフィラは縮むたびに少し転がる（ぎこちない）
    const contracting = pulse.contracting;
    if (contracting && !this.wasContracting && S.tumble > 0) {
      this.angVel.x += this.rng.gauss() * S.tumble * 0.8;
      this.angVel.z += this.rng.gauss() * S.tumble * 0.8;
      this.rollVel += this.rng.gauss() * S.tumble * 0.3;
    }
    this.wasContracting = contracting;
    const b = this.bounds;
    // 縮みの深さとは切り離した推進（深く縮んでも1回に進む量は同じ）
    const push = pulse.thrustRate();

    // ときどき大きく傾く（揺れの中と、起き直っている間は傾かない）
    if (tumbling || this.righting) this.leanLeft = 0;
    if (this.leanLeft > 0) this.leanLeft -= dt;
    else {
      this.leanTimer -= dt;
      if (this.leanTimer <= 0 && !tumbling && !this.righting) this.startLean();
    }
    const leaning = this.leanLeft > 0;

    // 推進：縮む速さに応じて傘の向きへ。大きく傾いている間は、その場で漂うように弱く。
    // 起き直っている間も弱く（逆さまのまま底へ泳いでいかないように）
    let thrust = (this.mode === 'drift' ? SWIM.thrust * SWIM.driftThrust : SWIM.thrust) * S.thrust;
    if (leaning) thrust *= SWIM.leanThrust;
    if (this.righting) thrust *= TUMBLE.rightingThrust;
    this.vel.addScaledVector(this.axis, thrust * push * dt);
    // 沈む力と水の抵抗。揺らされた水の中では、傘は流れに遅れてついていく（抵抗が流れのほうへ引く）
    this.vel.addScaledVector(up, -SWIM.sink * S.sink * dt);
    const keep = Math.exp(-SWIM.drag * dt);
    if (moving) {
      const u = flowAt(water, this.pos.x, this.pos.y, this.pos.z, tmpC).multiplyScalar(TUMBLE.bellFollow);
      this.vel.sub(u).multiplyScalar(keep).add(u);
    } else this.vel.multiplyScalar(keep);
    this.pos.addScaledVector(this.vel, dt);
    // ごくゆるい水の流れに乗って漂う
    this.currentPhase += dt * 0.021;
    const cp = this.currentPhase;
    this.pos.x += Math.cos(cp) * Math.cos(cp * 0.37) * SWIM.current * dt;
    this.pos.z += Math.sin(cp * 1.3) * SWIM.current * dt;

    // 気まぐれな向き
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) this.pickWander();
    this.aimWander();
    this.wander.lerp(this.wanderTarget, 1 - Math.exp(-dt / 2.5)).normalize();

    // 先読みした位置で壁・底・水面を避ける
    const ahead = tmpA.copy(this.pos).addScaledVector(this.axis, SWIM.lookAhead * S.lookAhead).addScaledVector(this.vel, SWIM.lookAheadTime);
    const desired = tmpB.copy(leaning ? this.leanDir : this.wander);
    const m = SWIM.wallMargin;
    const mv = SWIM.floorMargin;
    const rAhead = Math.hypot(ahead.x, ahead.z);
    const dr = b.radius - rAhead;
    if (dr < m && rAhead > 1e-4) {
      const k = Math.min((m - dr) / m, 1.5) ** 2 * SWIM.avoidWall;
      desired.x -= (ahead.x / rAhead) * k;
      desired.z -= (ahead.z / rAhead) * k;
    }
    // 水面は向きを変えて避けるのではなく、沈む調子に切り替えて離れる（下は軽く傾ける程度）
    const dTop = b.top - ahead.y;
    if (dTop < mv * 0.5) desired.y -= Math.min((mv * 0.5 - dTop) / (mv * 0.5), 1.5) ** 2 * SWIM.avoidTop;
    const dBottom = ahead.y - b.bottom;
    if (dBottom < mv) desired.y += Math.min((mv - dBottom) / mv, 1.5) ** 2 * SWIM.avoidFloor;
    // ほかの泳ぐ個体に近づきすぎたら、離れる向きへ向きを変え、少し押し離す（重ならない）。
    // 画面の上で重ならないように、奥行きの差は小さく数え、横と上下に離れる
    for (const o of others) {
      if (o.pos === this.pos) continue;
      const dx = this.pos.x - o.pos.x;
      const dy = this.pos.y - o.pos.y;
      const dz = (this.pos.z - o.pos.z) * SWIM.othersDepth;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const reach = (this.radius + o.radius) * SWIM.othersMargin;
      if (d >= reach) continue;
      const k = (reach - d) / reach;
      // 離れる向き（画面の横と上下）。ちょうど前後に重なっているときは、上下どちらかへ
      let ux = dx;
      let uy = dy;
      const h = Math.sqrt(ux * ux + uy * uy);
      if (h < 1e-4) {
        ux = 0;
        uy = this.pos.z >= o.pos.z ? 1 : -1;
      } else {
        ux /= h;
        uy /= h;
      }
      desired.x += ux * k * k * SWIM.avoidOthers;
      desired.y += uy * k * k * SWIM.avoidOthers * 0.5;
      this.vel.x += ux * k * SWIM.othersPush * dt;
      this.vel.y += uy * k * SWIM.othersPush * dt;
    }
    if (desired.lengthSq() < 1e-6) desired.copy(up);
    desired.normalize();
    // 傾きすぎたら起き上がろうとする（自分から大きく傾いている間は起き上がらない）
    const lean = 1 - upDot;
    if (!leaning) desired.addScaledVector(up, SWIM.righting * S.righting * lean).normalize();
    // 上への傾きの限界（瓶を傾けたままにしていれば、傾いた上から数える）
    const dUp = desired.dot(up);
    if (dUp < SWIM.minAxisY) {
      desired.addScaledVector(up, SWIM.minAxisY - dUp).normalize();
    }

    // 上へ泳ぐ／弱い拍動でゆっくり沈む、を行き来する。水面が近づいたら沈む方へ、底が近づいたら泳ぐ方へ
    this.modeTimer -= dt;
    if (this.mode === 'cruise' && (this.modeTimer <= 0 || this.pos.y > this.modeTarget)) {
      this.mode = 'drift';
      this.modeTimer = SWIM.driftMaxTime;
      this.modeTarget = this.pickTarget('drift');
    } else if (this.mode === 'drift' && (this.modeTimer <= 0 || this.pos.y < this.modeTarget)) {
      this.mode = 'cruise';
      this.modeTimer = SWIM.cruiseMaxTime;
      this.modeTarget = this.pickTarget('cruise');
    }
    // 起き直っている間は、間をあけずに打ち続ける
    if (this.mode === 'drift' && !this.righting) pulse.setStyle(SWIM.driftAmp, SWIM.driftRest * S.driftRest, SWIM.driftTempo * S.driftTempo);
    else pulse.setStyle(1, 0, 1);

    // 向きを変える。収縮しているときほど変えやすい。揺れの流れの中では、流れに負けて向きを変えられない
    if (this.righting) {
      // 流れのあと大きく傾いている：縮むたびに少しずつ上へ起き直る（何拍もかけて）
      const torque = tmpA.crossVectors(this.axis, up);
      if (torque.lengthSq() < 1e-4) torque.crossVectors(this.axis, tmpB.set(1, 0, 0)).addScaledVector(tmpB.set(0, 0, 1), 0.3);
      this.angVel.addScaledVector(torque.normalize(), TUMBLE.rightingPerBeat * push * dt);
    } else {
      const torque = tmpA.crossVectors(this.axis, desired);
      const boost = 1 + SWIM.turnPulseBoost * Math.min(push / 4, 1.5);
      this.angVel.addScaledVector(torque, SWIM.turnGain * boost * (1 - this.tumble) * dt);
    }
    // 水の中で回るのを止める抵抗。回る流れの中では、流れと一緒に回る
    const spinKeep = Math.exp(-SWIM.turnDamping * dt);
    if (moving) {
      const w = tmpC.copy(water.omega).multiplyScalar(TUMBLE.spinFollow);
      this.angVel.sub(w).multiplyScalar(spinKeep).add(w);
    } else this.angVel.multiplyScalar(spinKeep);
    const w = this.angVel.length();
    if (w > 1e-6) {
      tmpQ.setFromAxisAngle(tmpA.copy(this.angVel).divideScalar(w), w * dt);
      this.quat.premultiply(tmpQ);
    }
    // 軸まわりのゆっくりした回転
    this.rollVel += this.rng.gauss() * 0.05 * dt;
    const roll = SWIM.rollSpeed * S.roll;
    this.rollVel = Math.max(-roll, Math.min(roll, this.rollVel * (1 - 0.02 * dt)));
    this.axis.copy(UP).applyQuaternion(this.quat);
    tmpQ.setFromAxisAngle(this.axis, this.rollVel * dt);
    this.quat.premultiply(tmpQ).normalize();
    this.axis.copy(UP).applyQuaternion(this.quat);

    // 念のための柔らかい囲い。はみ出しそうなら押し戻す
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > b.radius) {
      const over = r - b.radius;
      const nx = this.pos.x / r;
      const nz = this.pos.z / r;
      const vOut = this.vel.x * nx + this.vel.z * nz;
      if (vOut > 0) {
        this.vel.x -= nx * vOut * Math.min(1, 12 * dt);
        this.vel.z -= nz * vOut * Math.min(1, 12 * dt);
      }
      this.vel.x -= nx * over * SWIM.fenceSpring * dt;
      this.vel.z -= nz * over * SWIM.fenceSpring * dt;
      const hard = b.radius + 0.02;
      if (r > hard) {
        this.pos.x = nx * hard;
        this.pos.z = nz * hard;
      }
    }
    if (this.pos.y > b.top) {
      this.vel.y -= (this.pos.y - b.top) * SWIM.fenceSpring * dt + Math.max(this.vel.y, 0) * Math.min(1, 10 * dt);
      this.pos.y = Math.min(this.pos.y, b.top + 0.02);
    }
    if (this.rising > 0) {
      // 瓶底から離れたばかり：下へは行かせず、泳いで上がるのを待つ
      this.rising -= dt;
      if (this.pos.y >= b.bottom) this.rising = 0;
      if (this.vel.y < 0) this.vel.y *= 1 - Math.min(1, 6 * dt);
    } else if (this.pos.y < b.bottom) {
      this.vel.y += (b.bottom - this.pos.y) * SWIM.fenceSpring * dt - Math.min(this.vel.y, 0) * Math.min(1, 10 * dt);
      this.pos.y = Math.max(this.pos.y, b.bottom - 0.02);
    }
  }
}
