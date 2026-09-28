// 端末の動きのセンサー（DeviceMotion）の値を、瓶の座標の「重力の向き・揺れ・回す速さ」にする。DOM に依存しない。
// 瓶は画面に固定されているので、端末の座標（x が画面の右、y が上、z が手前）をそのまま瓶の座標として使う。
// 左右の傾き（画面の中で回す向き）はそのまま、前後の傾き（画面を上へ向けて持つ角度）は持っている角度にゆっくり慣れて、
// そこを「まっすぐ」とする。傾きは上限までにする。
import { MOTION } from '../config';

export type V3 = [number, number, number];

/** 瓶の座標での、今の端末の動き */
export interface MotionSample {
  /** 重力の向き（単位ベクトル、下向き）。傾きは MOTION.maxTilt まで */
  gravity: V3;
  /** 揺れ（重力を除いた加速度、g）。上限 MOTION.maxAccel */
  accel: V3;
  /** 回す速さのうち、水が取り残される分（ラジアン/秒） */
  spin: V3;
  /** 振ってかき混ぜられている強さ（g、ならしたもの。ShakeGate が入れる）。瓶の中を回る流れのもと */
  stir?: number;
  /** 振りはじめの向き（単位ベクトル。ShakeGate が入れる）。回る流れの向きを決める */
  push?: V3;
}

/** センサーの1回分の値（DeviceMotionEvent のまま。単位は m/s² と 度/秒） */
export interface RawMotion {
  /** 重力込みの加速度 */
  withGravity: V3 | null;
  /** 重力を除いた加速度（渡さない端末もある） */
  linear: V3 | null;
  /** 回す速さ：[alpha（z まわり）, beta（x まわり）, gamma（y まわり）] */
  rotation: V3 | null;
}

const G = 9.80665;

export const neutralSample = (): MotionSample => ({ gravity: [0, -1, 0], accel: [0, 0, 0], spin: [0, 0, 0] });

function len(v: V3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function clampLen(v: V3, max: number): V3 {
  const l = len(v);
  return l > max ? [(v[0] * max) / l, (v[1] * max) / l, (v[2] * max) / l] : v;
}

/** 小さな値は 0 に、それより大きい分はなめらかにつなぐ */
function deadZone(v: V3, dz: number): V3 {
  const l = len(v);
  if (l <= dz) return [0, 0, 0];
  const k = (l - dz) / l;
  return [v[0] * k, v[1] * k, v[2] * k];
}

/** 画面の向き（度、screen.orientation.angle）に合わせて、端末の座標を画面の座標へ */
function toScreen(v: V3, angleDeg: number): V3 {
  if (!angleDeg) return v;
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

/** x 軸まわりに回す（前後の傾きを戻す） */
function rotX(v: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

/** 重力の向き（下向きの単位ベクトル）の傾きを、真下から max ラジアンまでにする */
export function clampTilt(g: V3, max: number): V3 {
  const h = Math.hypot(g[0], g[2]);
  const angle = Math.atan2(h, -g[1]);
  if (angle <= max || h < 1e-9) return g;
  const s = Math.sin(max) / h;
  return [g[0] * s, -Math.cos(max), g[2] * s];
}

/** 真下から dz ラジアンまでの傾きは真下に、越えた分だけ傾ける（持っている手のぶれ） */
export function tiltDeadZone(g: V3, dz: number): V3 {
  const h = Math.hypot(g[0], g[2]);
  if (h < 1e-9) return g;
  const angle = Math.atan2(h, -g[1]);
  const a = Math.max(0, angle - dz);
  const s = Math.sin(a) / h;
  return [g[0] * s, -Math.cos(a), g[2] * s];
}

/**
 * 揺らしたいときだけ揺れる。揺れの強さ（ならしたもの）か回す速さがしきい値を越えたときだけ開き、
 * 揺れと回す速さを通す。開くときはゆっくり立ち上がり、弱まってしばらくしたら閉じる。
 * 傾き（重力の向き）はいつも通すが、閉じている間はゆっくりした変化だけ（軽く振ったときの手首の小さな回りで水面が揺れないように）。
 * 振ってかき混ぜられている強さ（stir）と振りはじめの向き（push）も添える
 */
export class ShakeGate {
  private energy = 0;
  private stirred = 0;
  private open = false;
  private quiet = 0;
  private readonly push: V3 = [1, 0, 0];
  /** ならした傾き（重力の向き）。閉じている間は、ゆっくりした傾きだけを通す */
  private gravity: V3 | null = null;
  /** 開いている度合い（0〜1、なめらかにする前） */
  level = 0;

  apply(s: MotionSample | null, dt: number): MotionSample | null {
    if (!s) {
      // 値が来なくなった（揺れを使わない・デバッグの揺れが終わった）：閉じきるまでは、止まっているものとして続ける
      if (this.level <= 0 && this.stirred < 0.01) {
        this.energy = 0;
        this.stirred = 0;
        this.open = false;
        this.gravity = null;
        return null;
      }
      s = { ...neutralSample(), gravity: this.gravity ? [...this.gravity] : [0, -1, 0] };
    }
    const d = Math.max(dt, 0);
    const a = Math.hypot(s.accel[0], s.accel[1], s.accel[2]);
    const w = Math.hypot(s.spin[0], s.spin[1], s.spin[2]);
    this.energy += (a - this.energy) * (1 - Math.exp(-d / MOTION.shakeSmooth));
    const tau = a > this.stirred ? MOTION.shakeStirAttack : MOTION.shakeStirRelease;
    this.stirred += (a - this.stirred) * (1 - Math.exp(-d / tau));
    if (this.energy > MOTION.shakeOpen || w > MOTION.shakeSpinOpen) {
      if (!this.open && a > 1e-6) for (let i = 0; i < 3; i++) this.push[i] = s.accel[i]! / a;
      this.open = true;
      this.quiet = 0;
    } else if (this.open && this.energy < MOTION.shakeClose && w < MOTION.shakeSpinOpen * 0.3) {
      this.quiet += d;
      if (this.quiet > MOTION.shakeHold) this.open = false;
    } else this.quiet = 0;
    this.level = this.open ? Math.min(1, this.level + d / MOTION.shakeRampIn) : Math.max(0, this.level - d / MOTION.shakeRampOut);
    // ゆっくり立ち上がってから大きくなる
    const L = this.level;
    const k = L * L * (3 - 2 * L);
    // 傾き：閉じている間はゆっくりした変化だけ、開くほど速くついていく
    const gs = (this.gravity ??= [...s.gravity]);
    const tg = MOTION.calmTiltSmooth + (MOTION.shakeTiltSmooth - MOTION.calmTiltSmooth) * k;
    const kg = 1 - Math.exp(-d / tg);
    for (let i = 0; i < 3; i++) gs[i]! += (s.gravity[i]! - gs[i]!) * kg;
    const gl = Math.hypot(gs[0], gs[1], gs[2]) || 1;
    for (let i = 0; i < 3; i++) gs[i]! /= gl;
    return {
      gravity: [gs[0], gs[1], gs[2]],
      accel: [s.accel[0] * k, s.accel[1] * k, s.accel[2] * k],
      spin: [s.spin[0] * k, s.spin[1] * k, s.spin[2] * k],
      stir: this.stirred * k,
      push: [this.push[0], this.push[1], this.push[2]],
    };
  }
}

/**
 * 画面の傾き（度、左右。正で右が下がる）から、瓶の座標の重力の向き。デバッグの「傾けたままにする」つまみ
 */
export function gravityForRoll(deg: number): V3 {
  const a = (deg * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a), 0];
}

export class MotionFilter {
  /** 重力の向き（端末の座標、下向き、なめらかにしたもの）。まだなければ null */
  private down: V3 | null = null;
  /** 重力込みの加速度をなめらかにしたもの（重力を分けて渡さない端末用） */
  private slow: V3 | null = null;
  private spinSlow: V3 = [0, 0, 0];
  /** 慣れた前後の傾き（ラジアン） */
  private pitch0: number | null = null;
  private linear: V3 = [0, 0, 0];
  private spin: V3 = [0, 0, 0];
  /** 加速度の符号（仕様どおりなら 1。符号が逆の端末では -1） */
  private sign: number;
  private upsideDown = 0;

  constructor(sign = 1) {
    this.sign = sign;
  }

  /** 加速度の符号（確認用） */
  get accelSign(): number {
    return this.sign;
  }

  /** 値を捨てて、はじめから（センサーを止めたとき） */
  reset(): void {
    this.down = null;
    this.slow = null;
    this.spinSlow = [0, 0, 0];
    this.pitch0 = null;
    this.linear = [0, 0, 0];
    this.spin = [0, 0, 0];
    this.upsideDown = 0;
  }

  /** センサーの値を1回分入れる。dt は前の値からの秒、angle は画面の向き（度） */
  push(raw: RawMotion, dt: number, angle = 0): void {
    const d = Math.min(Math.max(dt, 1e-3), 0.2);
    const sg = this.sign;
    const scale = (v: V3): V3 => toScreen([(v[0] * sg) / G, (v[1] * sg) / G, (v[2] * sg) / G], angle);
    const withG = raw.withGravity ? scale(raw.withGravity) : null;
    const lin = raw.linear ? scale(raw.linear) : null;
    if (!withG) return;
    // 仕様では、止まっているときの重力込みの加速度は上向き（重力の反作用）。重力の向きはその逆
    let gRaw: V3;
    let linear: V3;
    if (lin) {
      gRaw = [lin[0] - withG[0], lin[1] - withG[1], lin[2] - withG[2]];
      linear = lin;
    } else {
      const k = 1 - Math.exp(-d / MOTION.highPass);
      const s = (this.slow ??= [...withG]);
      for (let i = 0; i < 3; i++) s[i]! += (withG[i]! - s[i]!) * k;
      gRaw = [-s[0], -s[1], -s[2]];
      linear = [withG[0] - s[0], withG[1] - s[1], withG[2] - s[2]];
    }
    const gl = len(gRaw);
    if (gl > 0.2) {
      const gn: V3 = [gRaw[0] / gl, gRaw[1] / gl, gRaw[2] / gl];
      if (!this.down) this.down = gn;
      else {
        const k = 1 - Math.exp(-d / MOTION.gravitySmooth);
        const dn = this.down;
        for (let i = 0; i < 3; i++) dn[i]! += (gn[i]! - dn[i]!) * k;
        const l = len(dn) || 1;
        for (let i = 0; i < 3; i++) dn[i]! /= l;
      }
      // 縦画面で、重力が画面の上のほうを向いたまま続く：加速度の符号が逆の端末とみなして直す
      if (this.down[1] > 0.6) {
        this.upsideDown += d;
        if (this.upsideDown > MOTION.flipCheckSeconds) {
          this.sign = -this.sign;
          this.reset();
          return;
        }
      } else this.upsideDown = 0;
      // 前後の傾き（画面を上へ向けるほど大きい）。持っている角度にゆっくり慣れる
      const pitch = Math.atan2(-this.down[2], -this.down[1]);
      if (this.pitch0 === null) this.pitch0 = pitch;
      else {
        let dp = pitch - this.pitch0;
        if (dp > Math.PI) dp -= 2 * Math.PI;
        if (dp < -Math.PI) dp += 2 * Math.PI;
        this.pitch0 += dp * (1 - Math.exp(-d / MOTION.pitchAdapt));
      }
    }
    this.linear = linear;
    if (raw.rotation) {
      // 度/秒 → ラジアン/秒。[beta, gamma, alpha] が x, y, z まわり（回す向きに符号の違いはない）
      const r = raw.rotation;
      const w = toScreen([(r[1] * Math.PI) / 180, (r[2] * Math.PI) / 180, (r[0] * Math.PI) / 180], angle);
      const k = 1 - Math.exp(-d / MOTION.spinHighPass);
      const s = this.spinSlow;
      for (let i = 0; i < 3; i++) s[i]! += (w[i]! - s[i]!) * k;
      this.spin = [w[0] - s[0], w[1] - s[1], w[2] - s[2]];
    }
  }

  /** 瓶の座標の、今の動き。まだ値がなければ null */
  sample(): MotionSample | null {
    if (!this.down || this.pitch0 === null) return null;
    const back = -this.pitch0;
    const maxTilt = (MOTION.maxTilt * Math.PI) / 180;
    const g = clampTilt(tiltDeadZone(rotX(this.down, back), (MOTION.tiltDeadZone * Math.PI) / 180), maxTilt);
    const accel = clampLen(deadZone(rotX(this.linear, back), MOTION.accelDeadZone), MOTION.maxAccel);
    const spin = clampLen(deadZone(rotX(this.spin, back), MOTION.spinDeadZone), MOTION.maxSpin);
    return { gravity: g, accel, spin };
  }
}
