// 端末の動きのセンサー（DeviceMotion）の値から、振ったことを検出する。DOM に依存しない。
// 使うのは重力を除いた加速度と回転の速さだけ。端末の傾き（重力の向き）は水面にも海月にも使わない
// （重力は、揺れを分けるのと、加速度の符号の違いを見分けるのと、振った向きを瓶の座標に直すのにだけ使う）。
// 瓶は画面に固定されているので、端末の座標（x が画面の右、y が上、z が手前）をそのまま瓶の座標として使う。
// 前後の傾き（画面を上へ向けて持つ角度）は持っている角度にゆっくり慣れて、そこを「まっすぐ」とする。
import { KICK, MOTION } from '../config';

export type V3 = [number, number, number];

/** 瓶の座標での、今の端末の揺れ */
export interface MotionSample {
  /** 揺れ（重力を除いた加速度、g）。上限 MOTION.maxAccel */
  accel: V3;
  /** 回す速さのうち、速い分（ラジアン/秒）。ゆっくり傾けた回りは入らない */
  spin: V3;
}

/** 振った一回。水に一回ぶんの勢いを与える */
export interface Kick {
  /** 振った向き（瓶の座標、単位ベクトル）。回したときは回す軸 */
  dir: V3;
  /** 勢いの大きさ（0〜1） */
  size: number;
  /** 回した（true）か、振った（false）か */
  spin: boolean;
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

export const quietSample = (): MotionSample => ({ accel: [0, 0, 0], spin: [0, 0, 0] });

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

/**
 * 振ったことの検出。加速度か回転の速さを少しならし（一瞬の衝撃を除く）、閾値を越えたら、
 * 越えた瞬間の向き（振りはじめの向き）と、そこから少しの間でいちばん強かったところの強さを「一回」として返す。次の一回までは少しあける。
 * デバッグパネル用に、今の値と、少し前までのいちばん大きかった値も持つ
 */
export class ShakeDetector {
  /** 今の値（ならしたもの）：加速度（g）と回転の速さ（ラジアン/秒） */
  accel = 0;
  spin = 0;
  /** 少し前（KICK.peakHold 秒）までのいちばん大きかった値 */
  accelPeak = 0;
  spinPeak = 0;
  private peakAge = 0;
  /** 最後の一回（なければ null）と、それからの秒 */
  last: Kick | null = null;
  sinceLast = Infinity;
  private collecting = -1;
  private rest = 0;
  /** 向きをならしたもの（振りはじめの向きを取る。いちばん強いところは、振り終わりに止める向きのことがある） */
  private readonly accelVec: V3 = [0, 0, 0];
  private readonly spinVec: V3 = [0, 0, 0];
  private best = { a: 0, w: 0, dirA: [1, 0, 0] as V3, dirW: [0, 0, 1] as V3 };

  /** 値を1回分入れる（null なら止まっている）。一回振ったと決まったら、その一回を返す */
  push(s: MotionSample | null, dt: number): Kick | null {
    const d = Math.max(dt, 0);
    const m = s ?? quietSample();
    const k = 1 - Math.exp(-d / KICK.smooth);
    const a = len(m.accel);
    const w = len(m.spin);
    this.accel += (a - this.accel) * k;
    this.spin += (w - this.spin) * k;
    for (let i = 0; i < 3; i++) {
      this.accelVec[i]! += (m.accel[i]! - this.accelVec[i]!) * k;
      this.spinVec[i]! += (m.spin[i]! - this.spinVec[i]!) * k;
    }
    this.peakAge += d;
    if (this.peakAge > KICK.peakHold || this.accel > this.accelPeak || this.spin > this.spinPeak) {
      if (this.peakAge > KICK.peakHold) {
        this.accelPeak = 0;
        this.spinPeak = 0;
      }
      this.accelPeak = Math.max(this.accelPeak, this.accel);
      this.spinPeak = Math.max(this.spinPeak, this.spin);
      this.peakAge = 0;
    }
    this.sinceLast += d;
    this.rest -= d;
    const over = this.accel >= KICK.accel || this.spin >= KICK.spin;
    if (this.collecting < 0) {
      if (!over || this.rest > 0) return null;
      // 向きは越えた瞬間（振りはじめ）のもの
      const unit = (v: V3, fb: V3): V3 => {
        const l = len(v);
        return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : fb;
      };
      this.collecting = KICK.window;
      this.best = { a: 0, w: 0, dirA: unit(this.accelVec, [1, 0, 0]), dirW: unit(this.spinVec, [0, 0, 1]) };
    }
    // 強さは、少しの間でいちばん強かったところ
    const b = this.best;
    b.a = Math.max(b.a, this.accel);
    b.w = Math.max(b.w, this.spin);
    this.collecting -= d;
    if (this.collecting > 0) return null;
    this.collecting = -1;
    this.rest = KICK.refractory;
    const byAccel = b.a / KICK.accel >= b.w / KICK.spin;
    const t = byAccel ? (b.a - KICK.accel) / (KICK.full - KICK.accel) : (b.w - KICK.spin) / (KICK.spinFull - KICK.spin);
    const kick: Kick = {
      dir: byAccel ? b.dirA : b.dirW,
      size: KICK.base + (1 - KICK.base) * Math.min(Math.max(t, 0), 1),
      spin: !byAccel,
    };
    this.last = kick;
    this.sinceLast = 0;
    return kick;
  }
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

  /** 瓶の座標の、今の揺れ。まだ値がなければ null */
  sample(): MotionSample | null {
    if (!this.down || this.pitch0 === null) return null;
    const back = -this.pitch0;
    const accel = clampLen(deadZone(rotX(this.linear, back), MOTION.accelDeadZone), MOTION.maxAccel);
    const spin = clampLen(deadZone(rotX(this.spin, back), MOTION.spinDeadZone), MOTION.maxSpin);
    return { accel, spin };
  }
}
