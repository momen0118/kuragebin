// カップで水ごと移す流れ（描画側）。海月はデリケートなので、どの動きもゆっくり丁寧に。海月は一度も空気に触れさせない。
// 上がる：長押しすると、瓶の中の海月がふっと見えなくなり、すでに水ごと海月が入ったカップが瓶の口からゆっくり上がってくる。
// 運ぶ：瓶の口のすぐ上で、指に少し遅れて横についてくる。海月はカップの水の中で揺れに合わせて小さく揺れる。
//   端で待つと画面が隣の瓶へ移り、カップも一緒に隣の瓶の上へ（ここでは放さない）。
// 放す：指を離したとき、今いる瓶の口からカップを水の中へゆっくり沈める（水面を通るとき小さな波紋）。すっかり浸かったら
//   水の中でゆっくり傾け、海月がカップの縁から自分の拍動で出ていくのを待つ。出たら、空のカップがゆっくり上がって口から出て消える。
// 位置はいつも、どれか1つの瓶（frame）の座標（その瓶の中心が原点）。隣の瓶へ運ぶ途中で、行き先の瓶の座標へ移す。
import { Quaternion, Vector3 } from 'three';
import { BOX, CUP, JAR, SCOOP } from '../config';
import { SPOUT_LIP, type Cup } from './cup';
import type { Jellyfish } from './jelly/jellyfish';

export interface ScoopHost {
  /** 隣の瓶との間（ワールド） */
  readonly spacing: number;
  /** 瓶の並びの上の見ている位置（0 が1番の瓶、スワイプの途中は小数） */
  readonly view: number;
  /** 運んでいる間にカップの真ん中が動ける横の範囲（瓶の座標、画面からはみ出さない） */
  readonly hoverRange: number;
  /** 瓶 jar の水面に波紋を立てる（瓶の座標）。輪は半径 radius から広がりはじめる */
  ripple(jar: number, x: number, z: number, strength: number, radius: number): void;
  /** 水の中のカップを、瓶 jar の泳ぐ個体によけさせる（真ん中と半径、瓶の座標）。null でやめる */
  obstruct(jar: number, center: Vector3 | null, radius: number): void;
  /** 放した個体を瓶 jar の個体にする（泳ぎつづける） */
  adopt(jar: number, id: number, jelly: Jellyfish): void;
  /** おじさんへ送る箱の底の真ん中（瓶 jar の座標） */
  boxBottom(jar: number, out: Vector3): Vector3;
  /** 箱の中の袋の水へ放し終えた（送った個体の描画を片付ける） */
  sent(id: number, jelly: Jellyfish): void;
}

type Phase = 'idle' | 'rise' | 'hover' | 'cross' | 'lower' | 'tilt' | 'wait' | 'leave' | 'toBox' | 'boxHold' | 'fromBox' | 'boxLower' | 'boxWait' | 'boxLeave';

/** 箱へ運ぶ・箱の中の段階（瓶のガラスより手前に描く） */
const BOX_PHASES: ReadonlySet<Phase> = new Set(['toBox', 'boxHold', 'fromBox', 'boxLower', 'boxWait', 'boxLeave']);

/** 箱の中のカップの注ぎ口の向き（奥の右の隅） */
const BOX_YAW = Math.PI / 4;
const UP = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const RIM = JAR.height;
const WATER = JAR.waterLevel;
const HOVER_Y = RIM + SCOOP.hoverClear;
const H = CUP.height;
/** カップの真ん中（カップの中の座標）。水の中で傾けるときは、ここを中心に回す */
const MID = new Vector3(0, H / 2, 0);

/** カップのいちばん外側をなぞる点（口の縁・注ぎ口・底の縁、カップの中の座標）。傾けたときの上端・下端を求める */
const OUTLINE: readonly Vector3[] = (() => {
  const pts: Vector3[] = [SPOUT_LIP.clone()];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push(new Vector3((CUP.radiusTop + 0.004) * Math.cos(a), H + 0.0015, (CUP.radiusTop + 0.004) * Math.sin(a)));
    pts.push(new Vector3(CUP.radiusBottom * Math.cos(a), 0, CUP.radiusBottom * Math.sin(a)));
  }
  return pts;
})();

const ease = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

const clampSlack = (x: number): number => Math.min(Math.max(x, -SCOOP.mouthSlack), SCOOP.mouthSlack);

export class Scoop {
  private phase: Phase = 'idle';
  private t = 0;
  /** 今の座標の瓶 */
  private jar = 0;
  private id = -1;
  private jelly: Jellyfish | null = null;
  /** カップの底の真ん中（瓶の座標） */
  private readonly pos = new Vector3();
  /** 水の中にあるとき：カップの真ん中（瓶の座標） */
  private readonly center = new Vector3();
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  /** 注ぎ口の向き（上から見た角度。0 で +x、π で -x）と、その変わり方 */
  private yaw = 0;
  private yawFrom = 0;
  private yawTo = 0;
  /** 水の中で傾ける角度（注ぎ口の側へ）と、運ぶときの揺れの傾き */
  private tilt = 0;
  private sway = 0;
  private velX = 0;
  private alpha = 0;
  /** 中の水の量（容積に対する割合） */
  private fill: number = CUP.fill;
  /** 口まで瓶の水に浸かっている（カップの水は瓶の水とひとつで、水面はない） */
  private flooded = false;
  /** 指の横の位置（見ている所から測ったワールドの x。瓶の並びが動いても、画面の上では同じ所） */
  private fingerX = 0;
  private pendingCross: { to: number; onStart: () => void } | null = null;
  private pendingRelease: number | null = null;
  /** 隣の瓶へ移る間：行き先、座標を移したか、画面の真ん中から見た横の位置（画面の上では動かさない） */
  private crossTo = 0;
  private switched = false;
  private crossX = 0;
  /** 放す：放す瓶、沈めたカップの真ん中（水平の位置）と、去るときの位置 */
  private releaseJar = 0;
  private readonly sink = new Vector3();
  private readonly away = new Vector3();
  /** 上がるとき：瓶の中の姿を消して、カップの中へ移したか */
  private jellyMoved = false;
  /** 海月：泳いで出ていくところか、泳ぎはじめてからの時間、出ていってからの時間（まだなら -1） */
  private exiting = false;
  private exitT = 0;
  private outT = -1;
  /** 水面を通ったかを見る：前のフレームのカップの下端 */
  private lowPrev = 0;
  private readonly q = new Quaternion();
  private readonly qa = new Quaternion();
  private readonly qb = new Quaternion();
  private readonly qc = new Quaternion();
  private readonly tiltAxis = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly mid = new Vector3();
  /** 箱の上に着いたら呼ぶ（確かめる）。まだ上がっている・隣へ移っている途中なら、終わってから箱へ */
  private onBoxArrive: (() => void) | null = null;
  private pendingBox = false;
  /** 箱の中の袋の水に浸かっている（袋の水面をカップのあとに描く） */
  private inBoxWater = false;

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

  /** いま指を離したら放す瓶（隣へ移る途中なら行き先） */
  get destination(): number {
    if (this.pendingCross) return this.pendingCross.to;
    if (this.phase === 'cross') return this.crossTo;
    return this.jar;
  }

  /** カップの中の個体（出ていったら null） */
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
    this.pendingBox = false;
    this.onBoxArrive = null;
    this.inBoxWater = false;
    this.jellyMoved = false;
    this.exiting = false;
    this.outT = -1;
    this.flooded = false;
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
    const x = clampSlack(jelly.swimmer.pos.x);
    this.from.set(x, WATER + 0.015, 0);
    this.to.set(x, HOVER_Y, 0);
    this.pos.copy(this.from);
    this.lowPrev = this.pos.y;
    this.fingerX = x + (jar - this.host.view) * this.host.spacing;
    this.enter('rise');
  }

  /** 指の横の位置（見ている所から測ったワールドの x）。運んでいる間、カップが横についてくる */
  follow(x: number): void {
    this.fingerX = x;
  }

  /** 隣の瓶 to の上へ移る（放さない）。onStart は移りはじめたとき（画面を隣の瓶へ動かす） */
  cross(to: number, onStart: () => void): void {
    if (!this.jelly) return;
    this.pendingCross = { to, onStart };
  }

  /** 箱へ運んでいる・箱の中にある間（瓶のガラスより手前に描く） */
  get inFront(): boolean {
    return BOX_PHASES.has(this.phase);
  }

  /** カップが箱の中の袋の水に浸かっている（袋の水面をカップのあとに描く） */
  get submergedInBox(): boolean {
    return this.inFront && this.inBoxWater;
  }

  /** 箱の上で、送るかを確かめているところか */
  get atBox(): boolean {
    return this.phase === 'boxHold';
  }

  /** 運んでいるところか（上がる・口の上・隣へ移る）。この間だけ、天板に「おじさんに送る」が出る */
  get carrying(): boolean {
    return this.jelly !== null && (this.phase === 'rise' || this.phase === 'hover' || this.phase === 'cross') && this.pendingRelease === null;
  }

  /**
   * 指を離した所が箱の上だった：カップを箱の上へ運ぶ。着いたら onArrive（送るかを確かめる）。
   * まだ上がっている・隣へ移っている途中なら、口の上に来てから
   */
  toBox(onArrive: () => void): void {
    if (!this.jelly || !this.carrying) return;
    this.onBoxArrive = onArrive;
    this.pendingBox = true;
  }

  private startToBox(): void {
    this.pendingBox = false;
    this.from.copy(this.pos);
    this.host.boxBottom(this.jar, this.to);
    this.to.y += BOX.height + BOX.hoverClear;
    this.yawFrom = this.yaw;
    this.enter('toBox');
  }

  /** 送る：箱の中の袋の水へ、カップごとゆっくり下ろして放す */
  sendToBox(): void {
    if (this.phase !== 'boxHold') return;
    this.from.copy(this.pos);
    this.host.boxBottom(this.jar, this.to);
    this.to.y += BOX.wall + 0.004;
    this.enter('boxLower');
  }

  /** やめる：瓶の口の上へ戻って、瓶の水へ放す */
  backFromBox(): void {
    if (this.phase !== 'boxHold') return;
    this.from.copy(this.pos);
    const x = clampSlack(this.from.x - (this.host.view - this.jar) * this.host.spacing) + (this.host.view - this.jar) * this.host.spacing;
    this.to.set(Math.min(Math.max(x, -this.host.hoverRange), this.host.hoverRange), HOVER_Y, 0);
    this.enter('fromBox');
  }

  /** 指を離した：今いる瓶（移る途中なら行き先）の水へ沈めて放す（delay 秒待ってから） */
  release(delay = 0): void {
    if (!this.jelly) return;
    this.pendingRelease = delay;
  }

  private enter(p: Phase): void {
    this.phase = p;
    this.t = 0;
  }

  /** カップの向き：注ぎ口の向き、水の中で傾ける角度（注ぎ口の側が下がる）、運ぶ揺れ */
  private orientation(out: Quaternion): Quaternion {
    this.qa.setFromAxisAngle(UP, this.yaw);
    // 注ぎ口の向き (cos, 0, -sin) へ軸を倒す
    this.qb.setFromAxisAngle(this.tiltAxis.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), this.tilt);
    this.qc.setFromAxisAngle(Z, this.sway);
    return out.copy(this.qc).multiply(this.qb).multiply(this.qa);
  }

  /** 向き q のカップの、真ん中から測った上端と下端の高さ */
  private extent(q: Quaternion): { top: number; bottom: number } {
    let top = -Infinity;
    let bottom = Infinity;
    for (const p of OUTLINE) {
      const y = this.tmp.copy(p).sub(MID).applyQuaternion(q).y;
      top = Math.max(top, y);
      bottom = Math.min(bottom, y);
    }
    return { top, bottom };
  }

  /** 水の中のカップ：真ん中を水平の位置 at に、いちばん上が水面の少し下にくる高さに（今の向きで） */
  private placeSunk(at: Vector3): void {
    this.orientation(this.q);
    this.center.set(at.x, WATER - SCOOP.submergeDepth - this.extent(this.q).top, at.z);
  }

  /** カップの中で海月を置く所（ワールド） */
  private jellyHome(out: Vector3): Vector3 {
    return this.cup.toWorld(this.tmp2.set(0, H * SCOOP.jellyHeight, 0), out);
  }

  /** カップの軸（底から口への向き、ワールド） */
  private cupAxis(out: Vector3): Vector3 {
    return out.copy(UP).applyQuaternion(this.q);
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
      case 'lower':
        this.stepLower(dt);
        break;
      case 'tilt':
        // 水の中でゆっくり傾ける。途中から、海月が自分で泳いで出ていく
        this.tilt = SCOOP.tiltMax * ease(this.t / SCOOP.tiltSeconds);
        this.placeSunk(this.sink);
        if (this.t >= SCOOP.tiltSeconds * SCOOP.exitAt) this.exiting = true;
        if (this.t >= SCOOP.tiltSeconds) this.enter('wait');
        break;
      case 'wait':
        // 傾けたまま、海月が出ていくのを待つ
        this.placeSunk(this.sink);
        if (this.outT >= SCOOP.clearSeconds) {
          // 海月が出ていった向きと反対へ少し離れてから上がる（口を通れる所に収める）
          this.away.set(this.sink.x - Math.cos(this.yaw) * SCOOP.leaveShift, 0, this.sink.z + Math.sin(this.yaw) * SCOOP.leaveShift);
          const r = Math.hypot(this.away.x, this.away.z);
          if (r > SCOOP.mouthSlack) this.away.multiplyScalar(SCOOP.mouthSlack / r);
          this.enter('leave');
        }
        break;
      case 'leave':
        if (this.stepLeave()) return;
        break;
      case 'toBox': {
        // 瓶の口の上から、手前の箱の上へ（少し持ち上げてから、ゆっくり下ろす）
        const e = ease(this.t / BOX.toSeconds);
        this.pos.lerpVectors(this.from, this.to, e);
        this.pos.y += Math.sin(Math.PI * e) * 0.06;
        // 注ぎ口は箱の奥の隅へ（いちばん広い向き）
        this.yaw = this.yawFrom + (BOX_YAW - this.yawFrom) * e;
        this.sway *= Math.exp(-4 * dt);
        if (this.t >= BOX.toSeconds) {
          this.enter('boxHold');
          const done = this.onBoxArrive;
          this.onBoxArrive = null;
          done?.();
        }
        break;
      }
      case 'boxHold':
        // 箱の上で、送るかを確かめている（少しだけ揺れる）
        this.pos.copy(this.to);
        this.pos.y += Math.sin(this.t * 1.7) * 0.004;
        this.sway *= Math.exp(-4 * dt);
        break;
      case 'fromBox': {
        const e = ease(this.t / BOX.toSeconds);
        this.pos.lerpVectors(this.from, this.to, e);
        this.pos.y += Math.sin(Math.PI * e) * 0.06;
        if (this.t >= BOX.toSeconds) {
          this.velX = 0;
          this.enter('hover');
          // 指はもう離しているので、そのまま瓶の水へ放す
          this.pendingRelease = 0;
        }
        break;
      }
      case 'boxLower': {
        const e = ease(this.t / BOX.lowerSeconds);
        this.pos.lerpVectors(this.from, this.to, e);
        if (this.t >= BOX.lowerSeconds) this.enter('boxWait');
        break;
      }
      case 'boxWait': {
        // 袋の水の中で放す（海月は箱の奥へ泳いでいく。手前の壁に隠れてほとんど見えない）
        this.pos.copy(this.to);
        const jelly = this.jelly;
        if (jelly) {
          jelly.setOpacity(1 - ease(this.t / BOX.waitSeconds));
          if (this.t >= BOX.waitSeconds) {
            this.jelly = null;
            this.host.sent(this.id, jelly);
          }
        }
        if (this.t >= BOX.waitSeconds) {
          this.from.copy(this.pos);
          this.enter('boxLeave');
        }
        break;
      }
      case 'boxLeave': {
        // 空のカップ（水でいっぱい）が上がってきて、消える
        const e = ease(this.t / BOX.leaveSeconds);
        this.pos.copy(this.from);
        this.pos.y += e * (BOX.height + 0.2);
        this.alpha = 1 - ease((this.t - BOX.leaveSeconds * 0.55) / (BOX.leaveSeconds * 0.45));
        if (this.t >= BOX.leaveSeconds) {
          this.phase = 'idle';
          this.cup.setAlpha(0);
          this.inBoxWater = false;
          this.host.obstruct(this.jar, null, 0);
          return;
        }
        break;
      }
      default:
        break;
    }

    // 水の中にあるときは、真ん中からカップの位置を決める
    this.orientation(this.q);
    if (this.phase === 'tilt' || this.phase === 'wait' || this.phase === 'leave') {
      this.pos.copy(this.center).sub(this.tmp.copy(MID).applyQuaternion(this.q));
    }
    this.cup.setPose(this.pos, this.q);
    this.cup.setAlpha(this.alpha);
    this.updateWater();
    this.updateJelly(dt);
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
    } else if (this.pendingBox) {
      this.startToBox();
    } else if (this.pendingRelease !== null) {
      this.pendingRelease -= dt;
      if (this.pendingRelease <= 0) {
        this.pendingRelease = null;
        this.startRelease();
      }
    }
  }

  /**
   * 放しはじめる：口を通れる所へ寄せながら、今の瓶の水の中へ沈める。
   * 口（注ぎ口の側）は瓶の真ん中のほうへ、少し手前へも向け、そちらへ傾ける
   */
  private startRelease(): void {
    this.releaseJar = this.jar;
    const x = clampSlack(this.pos.x);
    this.sink.set(x, 0, 0);
    // 注ぎ口の向き：瓶の真ん中の側へ、手前へ tiltToward だけ回した向き。近いほうへ回す
    const side = x > 0 ? -1 : 1;
    const dx = side * Math.cos(SCOOP.tiltToward);
    const dz = Math.sin(SCOOP.tiltToward);
    this.from.copy(this.pos);
    this.yawFrom = this.yaw;
    let d = Math.atan2(-dz, dx) - this.yawFrom;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yawTo = this.yawFrom + d;
    // 沈めきった所（まっすぐのまま）：カップのいちばん上が水面の少し下
    const saveYaw = this.yaw;
    const saveSway = this.sway;
    this.yaw = this.yawTo;
    this.sway = 0;
    this.placeSunk(this.sink);
    this.to.copy(this.center).sub(this.tmp.copy(MID).applyQuaternion(this.q));
    this.yaw = saveYaw;
    this.sway = saveSway;
    this.exiting = false;
    this.exitT = 0;
    this.outT = -1;
    this.enter('lower');
  }

  /** 沈める：口の上で口を通れる所へ寄せ、まっすぐのままゆっくり水の中へ */
  private stepLower(dt: number): void {
    const ex = ease(this.t / SCOOP.alignSeconds);
    const ey = ease((this.t - SCOOP.lowerDelay) / (SCOOP.lowerSeconds - SCOOP.lowerDelay));
    this.pos.x = this.from.x + (this.to.x - this.from.x) * ex;
    this.pos.z = this.from.z + (this.to.z - this.from.z) * ex;
    this.pos.y = this.from.y + (this.to.y - this.from.y) * ey;
    this.yaw = this.yawFrom + (this.yawTo - this.yawFrom) * ex;
    this.sway *= Math.exp(-3 * dt);
    if (this.t >= SCOOP.lowerSeconds) {
      this.yaw = this.yawTo;
      this.sway = 0;
      this.enter('tilt');
    }
  }

  /** 去る：空のカップを起こしながら海月から少し離れ、ゆっくり上がって口から出て消える。終わったら true */
  private stepLeave(): boolean {
    const er = ease(this.t / SCOOP.rightSeconds);
    const at = this.tmp2.lerpVectors(this.sink, this.away, er);
    // まっすぐにしたときの沈めた高さ
    this.tilt = 0;
    this.placeSunk(at);
    const upright = this.center.y;
    this.tilt = SCOOP.tiltMax * (1 - er);
    this.placeSunk(at);
    // 起こしながら、沈めた高さから口の上まで上がる
    const endY = HOVER_Y + H / 2 + SCOOP.leaveLift;
    this.center.y += (endY - upright) * ease((this.t - SCOOP.leaveDelay) / SCOOP.liftSeconds);
    const end = SCOOP.leaveDelay + SCOOP.liftSeconds;
    this.alpha = 1 - ease((this.t - (end - SCOOP.leaveFadeSeconds)) / SCOOP.leaveFadeSeconds);
    if (this.t >= end) {
      this.phase = 'idle';
      this.cup.setAlpha(0);
      this.host.obstruct(this.jar, null, 0);
      return true;
    }
    return false;
  }

  /**
   * カップの水：口まで瓶の水に浸かったら、瓶の水とひとつ（水面はない）。口が水面から出たら、水をいっぱいに入れたまま上がる。
   * カップの下端と口が水面を通るときに、小さな波紋。水の中にある間は、瓶の泳ぐ個体がカップをよける
   */
  private updateWater(): void {
    const mid = this.mid.copy(MID).applyQuaternion(this.q).add(this.pos);
    const e = this.extent(this.q);
    const top = mid.y + e.top;
    const low = mid.y + e.bottom;
    const jar = this.jar;
    if (this.inFront) {
      // 箱の中の袋の水：口まで浸かったら水面はない（瓶の水と同じ扱い）
      const boxWater = this.host.boxBottom(jar, this.tmp).y + BOX.height * BOX.waterLevel;
      this.inBoxWater = top < boxWater;
      if (this.inBoxWater) this.flooded = true;
      else if (this.flooded) {
        this.flooded = false;
        this.fill = 0.97;
      }
      this.lowPrev = low;
      this.cup.setWater(this.flooded ? -10 : this.cup.waterFor(this.fill).level);
      this.host.obstruct(jar, null, 0);
      return;
    }
    if (this.lowPrev > WATER && low <= WATER) this.host.ripple(jar, mid.x, mid.z, SCOOP.rippleEnter, CUP.radiusBottom);
    else if (this.lowPrev <= WATER && low > WATER) this.host.ripple(jar, mid.x, mid.z, SCOOP.rippleLeave, CUP.radiusBottom);
    this.lowPrev = low;
    if (!this.flooded && top < WATER) {
      this.flooded = true;
      this.host.ripple(jar, mid.x, mid.z, SCOOP.rippleSubmerge, CUP.radiusTop);
    } else if (this.flooded && top > WATER) {
      this.flooded = false;
      this.fill = 0.97;
      this.host.ripple(jar, mid.x, mid.z, SCOOP.rippleEmerge, CUP.radiusTop);
    }
    this.cup.setWater(this.flooded ? -10 : this.cup.waterFor(this.fill).level);
    const inJar = this.phase === 'lower' || this.phase === 'tilt' || this.phase === 'wait' || this.phase === 'leave';
    this.host.obstruct(jar, inJar && low < RIM ? mid : null, SCOOP.obstacleRadius);
  }

  /**
   * 海月：カップの水の中について動き、水の中で傾けるときは傘もカップの軸へ向く。
   * 放すときは、自分の拍動でカップの軸に沿って口から泳いで出ていき、出たら瓶の個体になる
   */
  private updateJelly(dt: number): void {
    if (this.outT >= 0) this.outT += dt;
    const jelly = this.jelly;
    if (!jelly) return;
    if (this.phase === 'rise' && !this.jellyMoved) {
      jelly.update(dt);
      return;
    }
    if (!this.exiting) {
      const tilting = this.phase === 'tilt' || this.phase === 'wait';
      jelly.carry(this.jellyHome(this.tmp), 1, true, tilting ? this.cupAxis(this.tmp2) : null);
      jelly.update(dt);
      return;
    }
    jelly.swimOut(this.pos, this.cupAxis(this.tmp2), SCOOP.exitPulseDelay);
    jelly.update(dt);
    this.exitT += dt;
    if (jelly.swimmer.guideProgress >= H + jelly.radius * SCOOP.exitClear || this.exitT > SCOOP.exitMaxSeconds) {
      jelly.letGo(jelly.swimmer.vel, 'drift');
      this.jelly = null;
      this.outT = 0;
      this.host.adopt(this.releaseJar, this.id, jelly);
    }
  }
}
