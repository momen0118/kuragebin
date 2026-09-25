// 泳ぎ。収縮の瞬間に前へ進み、緩和中はゆっくり沈む。
// 壁・底・水面が近づくと向きを緩やかに変え、ぶつからない。
import { Quaternion, Vector2, Vector3 } from 'three';
import { BELL, JAR, POKE, SWIM } from '../../config';
import type { Rng } from '../../sim/rng';
import type { Pulse } from './pulse';

const UP = new Vector3(0, 1, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpQ = new Quaternion();

/** 傘の中心が動ける範囲 */
export interface SwimBounds {
  radius: number;
  bottom: number;
  top: number;
}

export function swimBounds(bellRadius: number = BELL.radius): SwimBounds {
  const inner = JAR.radius - JAR.glassThickness;
  return {
    radius: inner - bellRadius - SWIM.sidePadding,
    bottom: JAR.bottomThickness + SWIM.bottomPadding,
    top: JAR.waterLevel - bellRadius * BELL.apexY - SWIM.topPadding,
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

  constructor(
    private readonly rng: Rng,
    private readonly bounds: SwimBounds = swimBounds(),
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
    return b.bottom + (b.top - b.bottom) * this.rng.range(lo, hi);
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

  update(dt: number, pulse: Pulse): void {
    const b = this.bounds;
    // 縮みの深さとは切り離した推進（深く縮んでも1回に進む量は同じ）
    const push = pulse.thrustRate();

    // ときどき大きく傾く
    if (this.leanLeft > 0) this.leanLeft -= dt;
    else {
      this.leanTimer -= dt;
      if (this.leanTimer <= 0) this.startLean();
    }
    const leaning = this.leanLeft > 0;

    // 推進：縮む速さに応じて傘の向きへ。大きく傾いている間は、その場で漂うように弱く
    let thrust = this.mode === 'drift' ? SWIM.thrust * SWIM.driftThrust : SWIM.thrust;
    if (leaning) thrust *= SWIM.leanThrust;
    this.vel.addScaledVector(this.axis, thrust * push * dt);
    // 沈む力と水の抵抗
    this.vel.y -= SWIM.sink * dt;
    this.vel.multiplyScalar(Math.exp(-SWIM.drag * dt));
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
    const ahead = tmpA.copy(this.pos).addScaledVector(this.axis, SWIM.lookAhead).addScaledVector(this.vel, SWIM.lookAheadTime);
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
    if (desired.lengthSq() < 1e-6) desired.copy(UP);
    desired.normalize();
    // 傾きすぎたら起き上がろうとする（自分から大きく傾いている間は起き上がらない）
    const lean = 1 - this.axis.y;
    if (!leaning) desired.addScaledVector(UP, SWIM.righting * lean).normalize();
    if (desired.y < SWIM.minAxisY) {
      desired.y = SWIM.minAxisY;
      desired.normalize();
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
    if (this.mode === 'drift') pulse.setStyle(SWIM.driftAmp, SWIM.driftRest, SWIM.driftTempo);
    else pulse.setStyle(1, 0, 1);

    // 向きを変える。収縮しているときほど変えやすい
    const torque = tmpA.crossVectors(this.axis, desired);
    const boost = 1 + SWIM.turnPulseBoost * Math.min(push / 4, 1.5);
    this.angVel.addScaledVector(torque, SWIM.turnGain * boost * dt);
    this.angVel.multiplyScalar(Math.exp(-SWIM.turnDamping * dt));
    const w = this.angVel.length();
    if (w > 1e-6) {
      tmpQ.setFromAxisAngle(tmpA.copy(this.angVel).divideScalar(w), w * dt);
      this.quat.premultiply(tmpQ);
    }
    // 軸まわりのゆっくりした回転
    this.rollVel += this.rng.gauss() * 0.05 * dt;
    this.rollVel = Math.max(-SWIM.rollSpeed, Math.min(SWIM.rollSpeed, this.rollVel * (1 - 0.02 * dt)));
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
    if (this.pos.y < b.bottom) {
      this.vel.y += (b.bottom - this.pos.y) * SWIM.fenceSpring * dt - Math.min(this.vel.y, 0) * Math.min(1, 10 * dt);
      this.pos.y = Math.max(this.pos.y, b.bottom - 0.02);
    }
  }
}
