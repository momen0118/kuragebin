// カップで水ごと移す流れ（描画側）。海月はデリケートなので、どの動きもゆっくり丁寧に。
// 上がる：長押しすると、瓶の中の海月がふっと見えなくなり、すでに水ごと海月が入ったカップが瓶の口からゆっくり上がってくる。
// 運ぶ：瓶の口のすぐ上で、指に少し遅れて横についてくる。海月はカップの水の中で揺れに合わせて小さく揺れる。
//   端で待つと画面が隣の瓶へ移り、カップも一緒に隣の瓶の上へ（ここでは注がない）。
// 注ぐ：指を離したとき、今いる瓶の口の上でゆっくり傾ける。水の筋が落ち、海月は水と一緒にするっと滑り出て、
//   水面から静かに入り、そのままゆっくり沈んでいく。
// 位置はいつも、どれか1つの瓶（frame）の座標（その瓶の中心が原点）。隣の瓶へ運ぶ途中で、行き先の瓶の座標へ移す。
import { Quaternion, Vector3 } from 'three';
import { CUP, JAR, SCOOP } from '../config';
import { SPOUT_LIP, type Cup } from './cup';
import type { Jellyfish } from './jelly/jellyfish';
import { swimBounds } from './jelly/swim';

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

type Phase = 'idle' | 'rise' | 'hover' | 'cross' | 'toPour' | 'pour' | 'settle' | 'leave';

const UP = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const RIM = JAR.height;
const WATER = JAR.waterLevel;
const HOVER_Y = RIM + SCOOP.hoverClear;

const ease = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

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
  /** 指の横の位置（見ている所から測ったワールドの x。瓶の並びが動いても、画面の上では同じ所） */
  private fingerX = 0;
  private pendingCross: { to: number; onStart: () => void } | null = null;
  private pendingRelease: number | null = null;
  /** 隣の瓶へ移る間：行き先、座標を移したか、画面の真ん中から見た横の位置（画面の上では動かさない） */
  private crossTo = 0;
  private switched = false;
  private crossX = 0;
  /** 注ぐ：注ぐ瓶、注ぎ口の向き（1 で +x）、注ぎ口の x */
  private pourJar = 0;
  private facing = 1;
  private lipX = 0;
  /** 上がるとき：瓶の中の姿を消して、カップの中へ移したか */
  private jellyMoved = false;
  /** 海月：カップから滑り出た、水に入った。滑り出てからの時間と、滑り出はじめた位置 */
  private jellyOut = false;
  private entered = false;
  private slideT = 0;
  private readonly slideFrom = new Vector3();
  /** 注ぐ水の筋：流れはじめてからの時間、止まった時刻（-1 なら流れている）、勢い */
  private flowing = false;
  private flowT = 0;
  private stopT = -1;
  private strength = 0;
  private rippleTimer = 0;
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

  /** カップを使っているところか（上がる〜去るまで） */
  get busy(): boolean {
    return this.phase !== 'idle';
  }

  /** 今の座標の瓶（カップと運んでいる海月を描く瓶） */
  get frameJar(): number {
    return this.jar;
  }

  /** いま指を離したら注ぐ瓶（隣へ移る途中なら行き先） */
  get destination(): number {
    if (this.pendingCross) return this.pendingCross.to;
    if (this.phase === 'cross') return this.crossTo;
    return this.jar;
  }

  /** カップの中の個体（注ぎ終えたら null） */
  get carriedId(): number | null {
    return this.jelly ? this.id : null;
  }

  /** 長押し：瓶 jar の個体 jelly を、カップに入れて瓶の口から上げる */
  begin(jar: number, id: number, jelly: Jellyfish): void {
    this.jar = jar;
    this.id = id;
    this.jelly = jelly;
    this.pendingCross = null;
    this.pendingRelease = null;
    this.jellyMoved = false;
    this.jellyOut = false;
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
    // 消えていく間は、その場でゆっくり漂う
    jelly.carry(jelly.swimmer.pos, 0.15);
    this.cup.group.add(jelly.group);
    // 口の中（水面のすぐ上）から、口のすぐ上まで上がる
    const x = Math.min(Math.max(jelly.swimmer.pos.x, -SCOOP.mouthSlack), SCOOP.mouthSlack);
    this.from.set(x, WATER + 0.015, 0);
    this.to.set(x, HOVER_Y, 0);
    this.pos.copy(this.from);
    this.fingerX = x + (jar - this.host.view) * this.host.spacing;
    this.enter('rise');
  }

  /** 指の横の位置（見ている所から測ったワールドの x）。運んでいる間、カップが横についてくる */
  follow(x: number): void {
    this.fingerX = x;
  }

  /** 隣の瓶 to の上へ移る（注がない）。onStart は移りはじめたとき（画面を隣の瓶へ動かす） */
  cross(to: number, onStart: () => void): void {
    if (!this.jelly) return;
    this.pendingCross = { to, onStart };
  }

  /** 指を離した：今いる瓶（移る途中なら行き先）の口の上で注ぐ（delay 秒待ってから） */
  release(delay = 0): void {
    if (!this.jelly) return;
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

  /** 瓶の座標を移す（隣の瓶へ移る途中） */
  private shiftFrame(to: number): void {
    const dx = (this.jar - to) * this.host.spacing;
    this.jar = to;
    for (const v of [this.pos, this.from, this.to]) v.x += dx;
    this.jelly?.translate(dx);
  }

  update(dt: number): void {
    if (this.phase === 'idle') return;
    this.t += dt;
    switch (this.phase) {
      case 'rise':
        this.stepRise();
        break;
      case 'hover':
        this.stepHover(dt);
        break;
      case 'cross': {
        // 画面の上では同じ所に浮かんだまま、瓶の並びが下を動いていく
        const e = ease(this.t / SCOOP.crossSeconds);
        this.pos.x = this.crossX + (this.host.view - this.jar) * this.host.spacing;
        this.pos.y = HOVER_Y + Math.sin(Math.PI * e) * SCOOP.crossArc;
        this.sway *= Math.exp(-4 * dt);
        if (!this.switched && e >= 0.5) {
          this.switched = true;
          this.shiftFrame(this.crossTo);
        }
        if (this.t >= SCOOP.crossSeconds) {
          if (!this.switched) this.shiftFrame(this.crossTo);
          this.velX = 0;
          this.enter('hover');
        }
        break;
      }
      case 'toPour': {
        const e = ease(this.t / SCOOP.moveSeconds);
        this.pos.lerpVectors(this.from, this.to, e);
        this.yaw = this.yawFrom + (this.yawTo - this.yawFrom) * e;
        this.sway *= Math.exp(-3 * dt);
        if (this.t >= SCOOP.moveSeconds) {
          this.yaw = this.yawTo;
          this.sway = 0;
          this.enter('pour');
        }
        break;
      }
      case 'pour':
        this.tilt = SCOOP.tiltMax * ease(this.t / SCOOP.tiltSeconds);
        break;
      case 'settle':
        // 起こす（注ぎ口の所を支点に）
        this.tilt = SCOOP.tiltMax * (1 - ease(this.t / SCOOP.settleSeconds));
        break;
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
    this.cup.setPose(this.pos, this.q);
    this.cup.setAlpha(this.alpha);
    this.updateWater(dt);
    this.updateJelly(dt);
    this.updateStream(dt);
    if (this.phase === 'pour') {
      const done = this.fill < 0.01 && !this.jelly && (!this.flowing || this.flowT - this.stopT > 0.6);
      if (this.t >= SCOOP.tiltSeconds && (done || this.t > SCOOP.tiltSeconds + 4)) this.enter('settle');
    } else if (this.phase === 'settle' && this.t >= SCOOP.settleSeconds) {
      this.from.copy(this.pos);
      this.enter('leave');
    }
  }

  /** 上がる：瓶の中の姿がふっと消え、海月の入ったカップが口からゆっくり上がってくる */
  private stepRise(): void {
    const e = ease(this.t / SCOOP.riseSeconds);
    this.pos.lerpVectors(this.from, this.to, e);
    this.alpha = Math.min(1, this.t / SCOOP.fadeSeconds);
    const jelly = this.jelly;
    if (jelly) {
      const f = SCOOP.jellyFadeSeconds;
      if (!this.jellyMoved) {
        jelly.setOpacity(1 - Math.min(1, this.t / f));
        if (this.t >= f) {
          // 見えなくなったら、カップの水の中へ
          this.jellyMoved = true;
          this.orientation(this.q);
          this.cup.setPose(this.pos, this.q);
          const home = this.jellyHome(this.tmp);
          jelly.carry(null);
          jelly.relocate(home);
          jelly.carry(home, 1);
        }
      } else {
        jelly.setOpacity(Math.min(1, (this.t - f) / f));
      }
    }
    if (this.t >= SCOOP.riseSeconds) {
      jelly?.setOpacity(1);
      this.enter('hover');
    }
  }

  /** 運ぶ：瓶の口のすぐ上で、指に少し遅れて横についてくる。動く向きへ少し傾く */
  private stepHover(dt: number): void {
    const w = SCOOP.follow;
    const range = this.host.hoverRange;
    // 指の所（画面の上）を今の瓶の座標へ。隣の瓶へ移ったあとや、のぞいている間も指の下を追う
    const tx = Math.min(Math.max(this.fingerX + (this.host.view - this.jar) * this.host.spacing, -range), range);
    this.velX += (w * w * (tx - this.pos.x) - 2 * w * this.velX) * dt;
    this.pos.x += this.velX * dt;
    this.pos.y += (HOVER_Y - this.pos.y) * Math.min(1, 6 * dt);
    this.pos.z += -this.pos.z * Math.min(1, 6 * dt);
    const want = Math.max(-0.35, Math.min(0.35, -this.velX * SCOOP.followTilt));
    this.sway += (want - this.sway) * Math.min(1, 8 * dt);
    if (this.pendingCross) {
      const { to, onStart } = this.pendingCross;
      this.pendingCross = null;
      this.crossTo = to;
      this.switched = false;
      this.crossX = this.pos.x + (this.jar - this.host.view) * this.host.spacing;
      this.enter('cross');
      onStart();
    } else if (this.pendingRelease !== null) {
      this.pendingRelease -= dt;
      if (this.pendingRelease <= 0) {
        this.pendingRelease = null;
        this.startPour(this.pos.x < 0 ? 1 : -1);
      }
    }
  }

  /** 今の瓶の口の上へ動いて注ぐ。facing は注ぎ口の向き（瓶の真ん中へ向ける） */
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

  /** カップの中の水：注ぐ間は、こぼれた分が注ぎ口から筋になり、水が減ると海月が滑り出る */
  private updateWater(dt: number): void {
    const w = this.cup.waterFor(this.fill);
    if (this.phase === 'pour' || this.phase === 'settle') {
      const out = Math.max(0, this.fill - w.max);
      this.fill -= out;
      const rate = out / Math.max(dt, 1e-4);
      const target = Math.min(1, rate / (CUP.fill / SCOOP.pourFlowSeconds));
      this.strength += (target - this.strength) * Math.min(1, 6 * dt);
      if (!this.flowing && this.strength > 0.05) {
        this.flowing = true;
        this.flowT = 0;
        this.stopT = -1;
      }
      if (this.flowing && this.stopT < 0 && this.fill < 0.005 && this.strength < 0.05) this.stopT = this.flowT;
      if (!this.jellyOut && this.jelly && this.fill < CUP.fill * SCOOP.exitFill) this.startSlide();
    }
    this.cup.setWater(this.fill > 0.004 ? this.cup.waterFor(this.fill).level : -10);
  }

  private startSlide(): void {
    if (!this.jelly || this.jellyOut) return;
    this.jellyOut = true;
    this.entered = false;
    this.slideT = 0;
    this.slideFrom.copy(this.jelly.swimmer.pos);
  }

  /** 注ぐ水の筋の、注ぎ口から k（0〜1）の所（ワールド）。k = 1 で瓶の水面 */
  private streamPoint(k: number, out: Vector3): Vector3 {
    const lip = this.cup.lip(this.lip);
    const g = SCOOP.streamGravity;
    const tEnd = Math.sqrt((2 * Math.max(lip.y - WATER, 0.01)) / g);
    const tt = tEnd * k;
    return out.set(lip.x + this.facing * SCOOP.streamPush * tt, lip.y - 0.5 * g * tt * tt, lip.z);
  }

  /** 海月：カップの水の中について動き、注ぐときは水と一緒に滑り出て、水面から静かに入る */
  private updateJelly(dt: number): void {
    const jelly = this.jelly;
    if (!jelly) return;
    if (this.phase === 'rise' && !this.jellyMoved) {
      jelly.update(dt);
      return;
    }
    if (!this.jellyOut) {
      const home = this.jellyHome(this.tmp);
      if (this.phase === 'pour' || this.phase === 'settle') {
        // 水が減るにつれて、注ぎ口のほうへ寄っていく
        const lip = this.cup.lip(this.lip);
        const k = 1 - Math.min(1, this.fill / CUP.fill);
        home.lerp(lip.setY(lip.y - 0.03), k * 0.7);
      }
      jelly.carry(home, 1);
    } else {
      // 注ぎ口から水の筋に沿って、ゆっくり滑り降り、水面から静かに入って泳げる所まで沈む
      // （はじめと水面の近くはゆっくり）
      this.slideT += dt;
      const s = ease(this.slideT / SCOOP.slideSeconds);
      const a = SCOOP.slideLip;
      const b = 1 - SCOOP.slideSink;
      const p = this.tmp;
      if (s < a) p.lerpVectors(this.slideFrom, this.streamPoint(0, this.tmp2), s / a);
      else if (s < b) this.streamPoint((s - a) / (b - a), p);
      else {
        const surface = this.streamPoint(1, this.tmp2);
        const top = swimBounds(jelly.radius).top;
        p.set(surface.x, surface.y + (Math.min(top, surface.y) - surface.y) * ((s - b) / (1 - b)), surface.z);
      }
      if (!this.entered && p.y <= WATER) {
        this.entered = true;
        this.host.ripple(this.pourJar, p.x, p.z, SCOOP.rippleJelly);
      }
      jelly.carry(p, 3);
      if (this.slideT >= SCOOP.slideSeconds) {
        jelly.letGo(this.tmp2.set(0, -SCOOP.entrySpeed, 0), 'drift');
        this.jelly = null;
        this.host.adopt(this.pourJar, this.id, jelly);
        return;
      }
    }
    jelly.update(dt);
  }

  /** 注ぐ水の筋：注ぎ口から瓶の水面まで。流れはじめは先が伸び、止まると後ろから切れて落ちる */
  private updateStream(dt: number): void {
    if (!this.flowing) {
      this.cup.setStream([], [], [], this.cam);
      return;
    }
    this.flowT += dt;
    const lip = this.cup.lip(this.lip);
    const g = SCOOP.streamGravity;
    const tEnd = Math.sqrt((2 * Math.max(lip.y - WATER, 0.01)) / g);
    const head = Math.min(this.flowT / tEnd, 1);
    const tail = this.stopT >= 0 ? Math.min((this.flowT - this.stopT) / tEnd, 1) : 0;
    if (tail >= head - 1e-3) {
      if (this.stopT >= 0) this.flowing = false;
      this.cup.setStream([], [], [], this.cam);
      return;
    }
    const n = 12;
    const pts: Vector3[] = [];
    const widths: number[] = [];
    const str: number[] = [];
    const s = Math.max(this.strength, this.stopT >= 0 ? 0.3 : 0);
    for (let i = 0; i <= n; i++) {
      const k = tail + ((head - tail) * i) / n;
      pts.push(this.streamPoint(k, new Vector3()));
      // 落ちるほど速くなって細くなる
      widths.push((SCOOP.streamWidth * Math.sqrt(Math.max(s, 0.15))) / (1 + 1.2 * k));
      str.push(Math.min(1, 0.35 + s));
    }
    this.cup.setStream(pts, widths, str, this.host.cameraPosition(this.jar, this.cam));
    // 水面に当たっている間は、小さな波紋が続く
    if (head >= 1 && this.stopT < 0) {
      this.rippleTimer -= dt;
      if (this.rippleTimer <= 0) {
        this.rippleTimer = 0.15;
        const hit = this.streamPoint(1, this.tmp2);
        this.host.ripple(this.pourJar, hit.x, hit.z, SCOOP.rippleStream * Math.max(this.strength, 0.3));
      }
    }
  }
}
