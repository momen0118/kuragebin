// カップですくって運び、注ぐ流れ（描画側）。
// すくう：カップが瓶の口から水の中へ降り、海月のそばで水ごとすくって、口のすぐ上まで引き上げる。
// 運ぶ：瓶の口のすぐ上で、指に少し遅れてついてくる。海月はカップの水の中で揺れに合わせて小さく揺れる。
// 隣の瓶へ：隣の瓶の口の上まで運び、傾けて水ごと注ぐ。水の筋と波紋が立ち、海月はそのままゆっくり沈んでいく。
// 戻す：今の瓶の口の上で傾けて注ぎ戻す（指を離したとき、隣の瓶が上限のとき）。
// 位置はいつも、どれか1つの瓶（frame）の座標（その瓶の中心が原点）。隣の瓶へ運ぶ途中で、行き先の瓶の座標へ移す。
import { Quaternion, Vector3 } from 'three';
import { CUP, JAR, SCOOP } from '../config';
import { SPOUT_LIP, type Cup } from './cup';
import type { Jellyfish } from './jelly/jellyfish';

export interface ScoopHost {
  /** 隣の瓶との間（ワールド） */
  readonly spacing: number;
  /** 瓶の並びの上の見ている位置（0 が1番の瓶、スワイプの途中は小数） */
  readonly view: number;
  /** 運んでいる間にカップの真ん中が動ける横の範囲（瓶の座標、画面からはみ出さない） */
  readonly hoverRange: number;
  /** 瓶 jar の水面に波紋を立てる（瓶の座標） */
  ripple(jar: number, x: number, z: number, strength: number): void;
  /** 注がれた個体を瓶 jar の個体にする（泳ぎはじめる） */
  adopt(jar: number, id: number, jelly: Jellyfish): void;
  /** 瓶 jar を描くカメラの位置（瓶の座標）。注ぐ水の筋をカメラへ向ける */
  cameraPosition(jar: number, out: Vector3): Vector3;
}

type Phase = 'idle' | 'descend' | 'reach' | 'gather' | 'lift' | 'hover' | 'cross' | 'toPour' | 'pour' | 'settle' | 'leave';

const UP = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const RIM = JAR.height;
const WATER = JAR.waterLevel;
/** 瓶の胴の内側でカップの真ん中が動ける半径 */
const BODY_SLACK = JAR.radius - JAR.glassThickness - CUP.radiusTop - CUP.spout - 0.006;

const ease = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

/** xz を半径 r の円の中に収める */
function clampRadial(v: Vector3, r: number): Vector3 {
  const d = Math.hypot(v.x, v.z);
  if (d > r) {
    v.x *= r / d;
    v.z *= r / d;
  }
  return v;
}

export class Scoop {
  private phase: Phase = 'idle';
  private t = 0;
  /** 今の座標の瓶 */
  private jar = 0;
  private id = -1;
  private jelly: Jellyfish | null = null;
  /** カップの底の真ん中（瓶の座標） */
  private readonly pos = new Vector3();
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private readonly mid = new Vector3();
  /** 注ぎ口の向き（0 で +x、π で -x）と、その変わり方 */
  private yaw = 0;
  private yawFrom = 0;
  private yawTo = 0;
  /** 注ぐ傾き（注ぎ口が下がる向き）と、運ぶときの揺れの傾き */
  private tilt = 0;
  private sway = 0;
  private velX = 0;
  private alpha = 0;
  /** 中の水の量（容積に対する割合） */
  private fill: number = CUP.fill;
  private targetX = 0;
  private pendingCross: { to: number; onStart: () => void } | null = null;
  private pendingRelease: number | null = null;
  private crossTo = 0;
  private switched = false;
  /** 隣の瓶へ運ぶ間の、画面の真ん中から見た横の位置（はじめと終わり）。画面の上でなめらかに動かす */
  private crossFromX = 0;
  private crossToX = 0;
  /** 注ぐ：注ぐ瓶、注ぎ口の向き（1 で +x）、注ぎ口の x */
  private pourJar = 0;
  private facing = 1;
  private lipX = 0;
  /** 海月：カップから出た、水に入った。落ちていく位置と速さ */
  private jellyOut = false;
  private jellyIn = false;
  private readonly fallPos = new Vector3();
  private fallVel = 0;
  /** 注ぐ水の筋：流れはじめてからの時間、止まった時刻（-1 なら流れている）、勢い */
  private flowing = false;
  private flowT = 0;
  private stopT = -1;
  private strength = 0;
  private rippleTimer = 0;
  private wasUnder = false;
  private readonly q = new Quaternion();
  private readonly qa = new Quaternion();
  private readonly qb = new Quaternion();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly lip = new Vector3();
  private readonly cam = new Vector3();

  constructor(
    private readonly host: ScoopHost,
    private readonly cup: Cup,
  ) {}

  /** カップを使っているところか（すくう〜去るまで） */
  get busy(): boolean {
    return this.phase !== 'idle';
  }

  /** 今の座標の瓶（カップと運んでいる海月を描く瓶） */
  get frameJar(): number {
    return this.jar;
  }

  /** すくっている個体（注ぎ終えたら null） */
  get carriedId(): number | null {
    return this.jelly ? this.id : null;
  }

  /** すくいはじめる。jelly は瓶 jar から引き取った個体 */
  begin(jar: number, id: number, jelly: Jellyfish): void {
    this.jar = jar;
    this.id = id;
    this.jelly = jelly;
    this.pendingCross = null;
    this.pendingRelease = null;
    this.jellyOut = false;
    this.jellyIn = false;
    this.flowing = false;
    this.stopT = -1;
    this.strength = 0;
    this.fill = CUP.fill;
    this.tilt = 0;
    this.sway = 0;
    this.velX = 0;
    this.yaw = 0;
    this.alpha = 0;
    jelly.neighbors = [];
    jelly.setRenderOrder(30);
    // すくわれるまで、その場でゆっくり漂う
    jelly.carry(jelly.swimmer.pos, 0.15);
    this.cup.group.add(jelly.group);
    // 口を通れる所の真上に現れて、水面まで降りる
    const start = clampRadial(this.tmp.copy(jelly.swimmer.pos), SCOOP.mouthSlack);
    this.from.set(start.x, RIM + SCOOP.appearHeight, start.z);
    this.to.set(start.x, WATER + 0.01, start.z);
    this.pos.copy(this.from);
    this.targetX = start.x;
    this.wasUnder = false;
    this.enter('descend');
  }

  /** 指の位置（瓶の座標の x）。運んでいる間、カップがついてくる */
  follow(x: number): void {
    this.targetX = x;
  }

  /** 隣の瓶 to へ運んで注ぐ。onStart は運びはじめたとき（画面を隣の瓶へ動かす） */
  cross(to: number, onStart: () => void): void {
    if (!this.jelly) return;
    this.pendingCross = { to, onStart };
    this.pendingRelease = null;
  }

  /** 今の瓶へ注ぎ戻す（delay 秒待ってから） */
  release(delay = 0): void {
    if (!this.jelly || this.pendingCross) return;
    this.pendingRelease = delay;
  }

  private enter(p: Phase): void {
    this.phase = p;
    this.t = 0;
  }

  /** カップの向き：注ぎ口の向き、運ぶ揺れ、注ぐ傾き */
  private orientation(out: Quaternion): Quaternion {
    this.qa.setFromAxisAngle(UP, this.yaw);
    this.qb.setFromAxisAngle(Z, -this.tilt * Math.cos(this.yaw) + this.sway);
    return out.copy(this.qb).multiply(this.qa);
  }

  /** 向き q のとき、カップの底が瓶の口より上にあるための、注ぎ口の高さ */
  private lipHeight(q: Quaternion): number {
    const lipY = this.tmp.copy(SPOUT_LIP).applyQuaternion(q).y;
    let depth = 0;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const y = this.tmp2.set(CUP.radiusBottom * Math.cos(a), 0, CUP.radiusBottom * Math.sin(a)).applyQuaternion(q).y;
      depth = Math.max(depth, lipY - y);
    }
    return Math.max(RIM + 0.03, RIM + 0.015 + depth);
  }

  /** 注ぎ口を (x, 高さ, 0) に置いたときのカップの底の位置 */
  private bottomFromLip(q: Quaternion, x: number, out: Vector3): Vector3 {
    const y = this.lipHeight(q);
    return out.set(x, y, 0).sub(this.tmp.copy(SPOUT_LIP).applyQuaternion(q));
  }

  /** カップの中で海月を置く所（ワールド） */
  private jellyHome(out: Vector3): Vector3 {
    return this.cup.toWorld(this.tmp2.set(0, CUP.height * SCOOP.jellyHeight, 0), out);
  }

  /** 瓶の座標を移す（隣の瓶へ運ぶ途中） */
  private shiftFrame(to: number): void {
    const dx = (this.jar - to) * this.host.spacing;
    this.jar = to;
    for (const v of [this.pos, this.from, this.to, this.mid]) v.x += dx;
    this.targetX += dx;
    this.jelly?.translate(dx);
  }

  update(dt: number): void {
    if (this.phase === 'idle') return;
    this.t += dt;
    const jelly = this.jelly;
    switch (this.phase) {
      case 'descend': {
        const e = ease(this.t / SCOOP.descendSeconds);
        this.pos.lerpVectors(this.from, this.to, e);
        this.alpha = Math.min(1, this.t / SCOOP.fadeSeconds);
        if (this.t >= SCOOP.descendSeconds && jelly) {
          // 水の中を、海月のそばまで（カップの水の真ん中に海月が来る所）
          this.from.copy(this.pos);
          const m = this.to.copy(jelly.swimmer.pos);
          m.y -= CUP.height * SCOOP.jellyHeight;
          clampRadial(m, BODY_SLACK);
          m.y = Math.min(Math.max(m.y, JAR.bottomThickness + 0.01), WATER - CUP.height - 0.012);
          this.enter('reach');
        }
        break;
      }
      case 'reach': {
        const e = ease(this.t / SCOOP.reachSeconds);
        this.pos.lerpVectors(this.from, this.to, e);
        if (this.t >= SCOOP.reachSeconds) {
          this.from.copy(jelly ? jelly.swimmer.pos : this.pos);
          this.enter('gather');
        }
        break;
      }
      case 'gather': {
        // 海月をカップの水の中へ
        const e = ease(this.t / SCOOP.gatherSeconds);
        if (jelly) jelly.carry(this.tmp.copy(this.from).lerp(this.jellyHome(this.lip), e), 0.4 + 0.6 * e);
        if (this.t >= SCOOP.gatherSeconds) {
          // 引き上げる：まず口を通れる所まで寄せながら上がり、それから口の上まで
          this.from.copy(this.pos);
          this.mid.copy(this.pos);
          clampRadial(this.mid, SCOOP.mouthSlack);
          this.mid.y = JAR.shoulderStart - CUP.height - 0.02;
          this.to.set(this.mid.x, RIM + SCOOP.hoverClear, 0);
          this.enter('lift');
        }
        break;
      }
      case 'lift': {
        const k = this.t / SCOOP.liftSeconds;
        const split = 0.4;
        if (k < split) this.pos.lerpVectors(this.from, this.mid, ease(k / split));
        else this.pos.lerpVectors(this.mid, this.to, ease((k - split) / (1 - split)));
        if (k >= 1) {
          this.targetX = this.pos.x;
          this.enter('hover');
        }
        break;
      }
      case 'hover': {
        // 指に少し遅れてついてくる（瓶の口のすぐ上）。動く向きへ少し傾く
        const w = SCOOP.follow;
        const range = this.host.hoverRange;
        const tx = Math.min(Math.max(this.targetX, -range), range);
        this.velX += (w * w * (tx - this.pos.x) - 2 * w * this.velX) * dt;
        this.pos.x += this.velX * dt;
        this.pos.y += (RIM + SCOOP.hoverClear - this.pos.y) * Math.min(1, 6 * dt);
        this.pos.z += -this.pos.z * Math.min(1, 6 * dt);
        const want = Math.max(-0.35, Math.min(0.35, -this.velX * SCOOP.followTilt));
        this.sway += (want - this.sway) * Math.min(1, 8 * dt);
        if (this.pendingCross) {
          const { to, onStart } = this.pendingCross;
          this.pendingCross = null;
          this.startCross(to);
          onStart();
        } else if (this.pendingRelease !== null) {
          this.pendingRelease -= dt;
          if (this.pendingRelease <= 0) {
            this.pendingRelease = null;
            this.startPour(this.pos.x < 0 ? 1 : -1);
          }
        }
        break;
      }
      case 'cross':
      case 'toPour': {
        const dur = this.phase === 'cross' ? SCOOP.crossSeconds : SCOOP.moveSeconds;
        const e = ease(this.t / dur);
        this.pos.lerpVectors(this.from, this.to, e);
        if (this.phase === 'cross') {
          // 瓶の並びは画面ごと動くので、横は画面の真ん中から見た位置で動かす（瓶に流されない）
          const viewX = this.crossFromX + (this.crossToX - this.crossFromX) * e;
          this.pos.x = viewX + (this.host.view - this.jar) * this.host.spacing;
          this.pos.y += Math.sin(Math.PI * e) * SCOOP.crossArc;
        }
        this.yaw = this.yawFrom + (this.yawTo - this.yawFrom) * e;
        this.sway *= Math.exp(-6 * dt);
        if (this.phase === 'cross' && !this.switched && e >= 0.5) {
          this.switched = true;
          this.shiftFrame(this.crossTo);
        }
        if (this.t >= dur) {
          this.yaw = this.yawTo;
          this.sway = 0;
          this.enter('pour');
        }
        break;
      }
      case 'pour':
        this.stepPour();
        break;
      case 'settle': {
        // 起こす（注ぎ口の所を支点に）
        const e = ease(this.t / SCOOP.settleSeconds);
        this.tilt = SCOOP.tiltMax * (1 - e);
        break;
      }
      case 'leave': {
        const e = ease(this.t / SCOOP.leaveSeconds);
        this.pos.y = this.from.y + 0.15 * e;
        this.alpha = 1 - e;
        if (this.t >= SCOOP.leaveSeconds) {
          this.phase = 'idle';
          this.cup.setAlpha(0);
          this.cup.setStream([], [], [], this.cam);
          return;
        }
        break;
      }
      default:
        break;
    }

    // 注ぐ・起こす間は、注ぎ口を支点にしてカップの位置を決める
    this.orientation(this.q);
    if (this.phase === 'pour' || this.phase === 'settle') this.bottomFromLip(this.q, this.lipX, this.pos);
    if (this.phase === 'settle' && this.t >= SCOOP.settleSeconds) {
      this.from.copy(this.pos);
      this.enter('leave');
    }
    this.cup.setPose(this.pos, this.q);
    this.cup.setAlpha(this.alpha);
    this.updateWater(dt);
    this.updateJelly(dt);
    this.updateStream(dt);
  }

  /** 隣の瓶へ運びはじめる */
  private startCross(to: number): void {
    const dir = to > this.jar ? 1 : -1;
    this.crossTo = to;
    this.switched = false;
    this.pourJar = to;
    this.facing = dir;
    this.lipX = -dir * SCOOP.pourOffset;
    this.from.copy(this.pos);
    this.yawFrom = this.yaw;
    this.yawTo = dir > 0 ? 0 : Math.PI;
    // 行き先の瓶の口の上（今の瓶の座標で）
    const saveYaw = this.yaw;
    const saveSway = this.sway;
    this.yaw = this.yawTo;
    this.sway = 0;
    this.bottomFromLip(this.orientation(this.q), this.lipX, this.to);
    this.yaw = saveYaw;
    this.sway = saveSway;
    this.crossFromX = this.pos.x + (this.jar - this.host.view) * this.host.spacing;
    this.crossToX = this.to.x;
    this.to.x += dir * this.host.spacing;
    this.enter('cross');
  }

  /** 今の瓶の口の上へ動いて注ぎ戻す。facing は注ぎ口の向き（瓶の真ん中へ向ける） */
  private startPour(facing: number): void {
    this.pourJar = this.jar;
    this.facing = facing;
    this.lipX = -facing * SCOOP.pourOffset;
    this.from.copy(this.pos);
    this.yawFrom = this.yaw;
    this.yawTo = facing > 0 ? 0 : Math.PI;
    const saveYaw = this.yaw;
    const saveSway = this.sway;
    this.yaw = this.yawTo;
    this.sway = 0;
    this.bottomFromLip(this.orientation(this.q), this.lipX, this.to);
    this.yaw = saveYaw;
    this.sway = saveSway;
    this.enter('toPour');
  }

  /** 傾けて注ぐ。水がこぼれる分だけ筋になり、水が減ると海月が出て落ちていく */
  private stepPour(): void {
    this.tilt = SCOOP.tiltMax * ease(this.t / SCOOP.tiltSeconds);
    // 傾けきっても海月が出ていなければ、出す
    if (this.jelly && this.t >= SCOOP.tiltSeconds) this.letJellyOut();
    const done = this.fill < 0.01 && !this.jelly && (!this.flowing || this.flowT - this.stopT > 0.5);
    if (this.t >= SCOOP.tiltSeconds && (done || this.t > SCOOP.tiltSeconds + 3)) this.enter('settle');
  }

  private letJellyOut(): void {
    if (!this.jelly || this.jellyOut) return;
    this.jellyOut = true;
    this.fallPos.copy(this.jelly.swimmer.pos);
    this.fallVel = 0;
  }

  /** カップの中の水：沈んでいる間は瓶の水のまま、出てからは量に合わせた水面。注ぐ間はこぼれた分が筋になる */
  private updateWater(dt: number): void {
    const under = this.pos.y < WATER;
    // 水面を通るとき（入る・出る）に波紋
    if (under !== this.wasUnder && this.phase !== 'idle') {
      this.host.ripple(this.jar, this.pos.x, this.pos.z, SCOOP.rippleCup);
      this.wasUnder = under;
    }
    if (this.phase === 'descend' || this.phase === 'reach' || this.phase === 'gather' || (this.phase === 'lift' && under)) {
      this.fill = 1;
      this.cup.setWater(-10);
      return;
    }
    if (this.phase === 'lift' || this.phase === 'hover' || this.phase === 'cross' || this.phase === 'toPour') {
      // 引き上げたときはふちまで入っていて、すぐに少しこぼれて落ち着く
      this.fill += (CUP.fill - this.fill) * Math.min(1, 4 * dt);
    }
    const w = this.cup.waterFor(this.fill);
    if (this.phase === 'pour' || this.phase === 'settle') {
      const out = Math.max(0, this.fill - w.max);
      this.fill -= out;
      const rate = out / Math.max(dt, 1e-4);
      const target = Math.min(1, rate / (CUP.fill / 0.6));
      this.strength += (target - this.strength) * Math.min(1, 10 * dt);
      if (!this.flowing && this.strength > 0.05) {
        this.flowing = true;
        this.flowT = 0;
        this.stopT = -1;
      }
      if (this.flowing && this.stopT < 0 && this.fill < 0.005 && this.strength < 0.05) this.stopT = this.flowT;
      if (!this.jellyOut && this.fill < CUP.fill * SCOOP.exitFill) this.letJellyOut();
    }
    this.cup.setWater(this.fill > 0.004 ? this.cup.waterFor(this.fill).level : -10);
  }

  /** 海月：カップの水の中について動き、注ぐときは注ぎ口から落ちて瓶の水に入る */
  private updateJelly(dt: number): void {
    const jelly = this.jelly;
    if (!jelly) return;
    if (this.phase === 'lift' || this.phase === 'hover' || this.phase === 'cross' || this.phase === 'toPour' || (this.phase === 'pour' && !this.jellyOut)) {
      const home = this.jellyHome(this.tmp);
      if (this.phase === 'pour') {
        // 水が減るにつれて、注ぎ口のほうへ寄っていく
        const lip = this.cup.lip(this.lip);
        const k = 1 - Math.min(1, this.fill / CUP.fill);
        home.lerp(lip.setY(lip.y - 0.03), k * 0.7);
      }
      jelly.carry(home, 1);
    } else if (this.jellyOut && !this.jellyIn) {
      // 注ぎ口から、水と一緒にゆっくり落ちていく
      const lip = this.cup.lip(this.lip);
      this.fallVel += SCOOP.fallGravity * dt;
      this.fallPos.y -= this.fallVel * dt;
      this.fallPos.x += (lip.x + this.facing * 0.02 - this.fallPos.x) * Math.min(1, 6 * dt);
      this.fallPos.z += -this.fallPos.z * Math.min(1, 6 * dt);
      jelly.carry(this.fallPos, 5, false);
      if (this.fallPos.y <= WATER - 0.01) {
        this.jellyIn = true;
        this.host.ripple(this.pourJar, this.fallPos.x, this.fallPos.z, SCOOP.rippleJelly);
        const at = this.tmp.set(this.fallPos.x, WATER - 0.03, this.fallPos.z);
        jelly.place(at, UP, this.tmp2.set(0, -SCOOP.entrySpeed, 0), 'drift');
        this.jelly = null;
        this.host.adopt(this.pourJar, this.id, jelly);
        return;
      }
    }
    jelly.update(dt);
  }

  /** 注ぐ水の筋：注ぎ口から放物線で瓶の水面まで。流れはじめは先が伸び、止まると後ろから切れて落ちる */
  private updateStream(dt: number): void {
    if (!this.flowing) {
      this.cup.setStream([], [], [], this.cam);
      return;
    }
    this.flowT += dt;
    const g = SCOOP.streamGravity;
    const lip = this.cup.lip(this.lip);
    const drop = Math.max(lip.y - WATER, 0.01);
    const tEnd = Math.sqrt((2 * drop) / g);
    const head = Math.min(this.flowT, tEnd);
    const tail = this.stopT >= 0 ? Math.min(this.flowT - this.stopT, tEnd) : 0;
    if (tail >= head - 1e-3) {
      if (this.stopT >= 0) this.flowing = false;
      this.cup.setStream([], [], [], this.cam);
      return;
    }
    const n = 12;
    const pts: Vector3[] = [];
    const widths: number[] = [];
    const str: number[] = [];
    const vx = this.facing * 0.18;
    const s = Math.max(this.strength, this.stopT >= 0 ? 0.3 : 0);
    for (let i = 0; i <= n; i++) {
      const tt = tail + ((head - tail) * i) / n;
      pts.push(new Vector3(lip.x + vx * tt, lip.y - 0.5 * g * tt * tt, lip.z));
      // 落ちるほど速くなって細くなる
      widths.push(SCOOP.streamWidth * Math.sqrt(Math.max(s, 0.15)) / (1 + (1.2 * tt) / tEnd));
      str.push(Math.min(1, 0.35 + s));
    }
    this.cup.setStream(pts, widths, str, this.host.cameraPosition(this.jar, this.cam));
    // 水面に当たっている間は波紋が続く
    if (head >= tEnd && this.stopT < 0) {
      this.rippleTimer -= dt;
      if (this.rippleTimer <= 0) {
        this.rippleTimer = 0.12;
        this.host.ripple(this.pourJar, lip.x + vx * tEnd, lip.z, SCOOP.rippleStream * Math.max(this.strength, 0.3));
      }
    }
  }
}
