// 泳ぐ個体を、カップで水ごとすくって運ぶ（長押しから）。指で動かすのはカップ。
// 左右の端へ運んで少し置くと、隣の瓶の口の上まで運んで注ぐ。
// 隣の瓶が上限なら、隣をのぞいてから、元の瓶の上で注ぎ戻す。途中で指を離したら、その場（今の瓶の上）で注ぎ戻す。
// 1回の長押しで試すのは1回だけ（移しても戻しても、指を離すまで何もしない）。
import { HANDLING } from '../config';
import type { Game } from '../game';
import type { App } from '../render/app';
import type { Point } from './gestures';
import type { JarSlider } from './jarSlider';

export class Carry {
  private active = false;
  private done = false;
  /** 指がいる端（-1 で左、1 で右、0 で端でない） */
  private edge = 0;
  private timer: number | undefined;

  constructor(
    private readonly app: App,
    private readonly game: Game,
    private readonly slider: JarSlider,
    private readonly toNdc: (p: Point) => [number, number],
    private readonly width: () => number,
  ) {}

  /** 個体 id をカップですくいはじめる。はじめられたら true */
  start(id: number, p: Point): boolean {
    if (!this.app.scoopStart(id)) return false;
    this.active = true;
    this.done = false;
    this.edge = 0;
    const [x, y] = this.toNdc(p);
    this.app.scoopFollow(x, y);
    return true;
  }

  move(p: Point): void {
    if (!this.active || this.done) return;
    const [x, y] = this.toNdc(p);
    this.app.scoopFollow(x, y);
    const w = this.width();
    const zone = w * HANDLING.edgeZone;
    const edge = p.x < zone ? -1 : p.x > w - zone ? 1 : 0;
    if (edge === this.edge) return;
    this.edge = edge;
    this.clearTimer();
    this.slider.lean(edge * HANDLING.edgeLean);
    if (edge) this.timer = window.setTimeout(() => this.cross(edge), HANDLING.edgeDwellMs);
  }

  /** 指を離した：まだ運んでいる途中なら、今の瓶の上で注ぎ戻す */
  end(): void {
    this.clearTimer();
    if (this.active && !this.done) {
      this.slider.lean(0);
      this.app.scoopRelease();
    }
    this.active = false;
  }

  /** 端に置いたまま少し経った：隣の瓶（dir が 1 なら右、-1 なら左）へ移す */
  private cross(dir: number): void {
    this.timer = undefined;
    const id = this.app.scoopId;
    if (!this.active || this.done || id === null) return;
    this.done = true;
    const to = this.slider.index + dir;
    const result = this.game.canMove(id, to);
    if (result === 'moved') {
      // 状態は先に移す。カップが運びはじめたら、画面も隣の瓶へ動く
      this.game.moveCreature(id, to);
      this.app.scoopCross(to, () => this.slider.goTo(to));
      return;
    }
    if (result === 'full') {
      // 隣をのぞいてから、元の瓶の上で注ぎ戻す
      this.slider.peek(dir, HANDLING.fullPeek, HANDLING.fullPeekSeconds);
      this.app.scoopRelease(HANDLING.fullPeekSeconds + HANDLING.peekReturnSeconds);
    } else {
      this.slider.lean(0);
      this.app.scoopRelease();
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
