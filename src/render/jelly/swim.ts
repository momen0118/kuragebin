// 泳ぎ。収縮の瞬間に前へ進み、緩和中はゆっくり沈む。
// 壁・底・水面が近づくと向きを緩やかに変え、ぶつからない。
import { Quaternion, Vector2, Vector3 } from 'three';
import { BELL, JAR, SWIM } from '../../config';
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
    top: JAR.waterLevel - bellRadius * BELL.relaxed[1] - SWIM.topPadding,
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
  private mode: 'cruise' | 'drift' = 'cruise';
  private modeTimer = 0;

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
    this.modeTimer = rng.range(SWIM.cruiseMin, SWIM.cruiseMax) * 0.5;
    this.rollVel = rng.range(-1, 1) * SWIM.rollSpeed;
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
    const rate = pulse.rate();
    const push = Math.max(rate, 0);

    // 推進：縮む速さに応じて傘の向きへ
    this.vel.addScaledVector(this.axis, SWIM.thrust * push * dt);
    // 沈む力と水の抵抗
    this.vel.y -= SWIM.sink * dt;
    this.vel.multiplyScalar(Math.exp(-SWIM.drag * dt));
    this.pos.addScaledVector(this.vel, dt);

    // 気まぐれな向き
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) this.pickWander();
    this.aimWander();
    this.wander.lerp(this.wanderTarget, 1 - Math.exp(-dt / 2.5)).normalize();

    // 先読みした位置で壁・底・水面を避ける
    const ahead = tmpA.copy(this.pos).addScaledVector(this.axis, SWIM.lookAhead).addScaledVector(this.vel, SWIM.lookAheadTime);
    const desired = tmpB.copy(this.wander);
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
    // 傾きすぎたら起き上がろうとする
    const lean = 1 - this.axis.y;
    desired.addScaledVector(UP, SWIM.righting * lean).normalize();
    if (desired.y < SWIM.minAxisY) {
      desired.y = SWIM.minAxisY;
      desired.normalize();
    }

    // 上へ泳ぐ／弱い拍動でゆっくり沈む、を行き来する。水面が近づいたら沈む方へ、底が近づいたら泳ぐ方へ
    this.modeTimer -= dt;
    if (this.mode === 'cruise' && (this.modeTimer <= 0 || this.pos.y > b.top - 0.1)) {
      this.mode = 'drift';
      this.modeTimer = this.rng.range(SWIM.driftMin, SWIM.driftMax);
    } else if (this.mode === 'drift' && (this.modeTimer <= 0 || this.pos.y < b.bottom + 0.08)) {
      this.mode = 'cruise';
      this.modeTimer = this.rng.range(SWIM.cruiseMin, SWIM.cruiseMax);
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
