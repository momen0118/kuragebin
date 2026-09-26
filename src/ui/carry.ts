// 泳ぐ個体をつまんで運ぶ（長押しから）。左右の端へ運んで少し置くと、隣の瓶へ移す。
// 隣の瓶が上限なら、隣をのぞいてから戻り、個体は瓶の真ん中のほうへ戻される。
// 1回の長押しで試すのは1回だけ（移しても戻されても、指を離すまで何もしない）。
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

  /** 個体 id をつまむ。つまめたら true */
  start(id: number, p: Point): boolean {
    const [x, y] = this.toNdc(p);
    if (!this.app.grab(id, x, y)) return false;
    this.active = true;
    this.done = false;
    this.edge = 0;
    return true;
  }

  move(p: Point): void {
    if (!this.active || this.done) return;
    const [x, y] = this.toNdc(p);
    this.app.dragHeld(x, y);
    if (this.app.heldId === null) {
      // 運んでいる間に個体がいなくなった
      this.done = true;
      this.slider.lean(0);
      return;
    }
    const w = this.width();
    const zone = w * HANDLING.edgeZone;
    const edge = p.x < zone ? -1 : p.x > w - zone ? 1 : 0;
    if (edge === this.edge) return;
    this.edge = edge;
    this.clearTimer();
    this.slider.lean(edge * HANDLING.edgeLean);
    if (edge) this.timer = window.setTimeout(() => this.cross(edge), HANDLING.edgeDwellMs);
  }

  end(): void {
    this.clearTimer();
    if (this.active && !this.done) {
      this.slider.lean(0);
      this.app.releaseHeld();
    }
    this.active = false;
  }

  /** 端に置いたまま少し経った：隣の瓶（dir が 1 なら右、-1 なら左）へ移す */
  private cross(dir: number): void {
    this.timer = undefined;
    const id = this.app.heldId;
    if (!this.active || this.done || id === null) return;
    this.done = true;
    const to = this.slider.index + dir;
    const result = this.game.canMove(id, to);
    // 描画を先に隣の瓶へ渡してから状態を変える（泳ぎをそのまま引き継ぐ）
    if (result === 'moved' && this.app.transferHeld(to, -dir)) {
      this.game.moveCreature(id, to);
      this.slider.goTo(to);
      return;
    }
    if (result === 'full') this.slider.peek(dir, HANDLING.fullPeek, HANDLING.fullPeekSeconds);
    else this.slider.lean(0);
    this.app.returnHeld();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
