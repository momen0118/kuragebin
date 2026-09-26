// 泳ぐ個体を、カップに水ごと入れて運ぶ（長押しから）。指で動かすのはカップ。
// 左右の端へ運んで少し置くと、画面が隣の瓶へ移り、カップも隣の瓶の上へ（ここでは注がない）。
// 隣の瓶が上限なら、隣をのぞいて戻ってくる。指を離したとき、カップがいる瓶の口の上で注ぐ
// （元の瓶の上なら注ぎ戻す）。状態を移すのは注ぐとき。
import { HANDLING } from '../config';
import type { Game } from '../game';
import type { App } from '../render/app';
import type { Point } from './gestures';
import type { JarSlider } from './jarSlider';

export class Carry {
  private active = false;
  /** 運びはじめた瓶 */
  private source = 0;
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

  /** 個体 id をカップに入れて上げはじめる。はじめられたら true */
  start(id: number, p: Point): boolean {
    if (!this.app.scoopStart(id)) return false;
    this.active = true;
    this.edge = 0;
    this.source = this.app.scoopDestination;
    const [x, y] = this.toNdc(p);
    this.app.scoopFollow(x, y);
    return true;
  }

  move(p: Point): void {
    if (!this.active) return;
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

  /** 指を離した：カップがいる瓶の口の上で注ぐ。運びはじめた瓶と違えば、そこで状態を移す */
  end(): void {
    this.clearTimer();
    if (!this.active) return;
    this.active = false;
    this.slider.lean(0);
    const id = this.app.scoopId;
    if (id === null) return;
    const dest = this.app.scoopDestination;
    if (dest !== this.source && this.game.moveCreature(id, dest) !== 'moved') {
      // その間に移せなくなっていた（上限など）：元の瓶の上へ戻ってから注ぎ戻す
      const src = this.source;
      this.app.scoopCross(src, () => this.slider.goTo(src));
    }
    this.app.scoopRelease();
  }

  /** 端に置いたまま少し経った：隣の瓶（dir が 1 なら右、-1 なら左）の上へ移る */
  private cross(dir: number): void {
    this.timer = undefined;
    const id = this.app.scoopId;
    if (!this.active || id === null) return;
    const to = this.app.scoopDestination + dir;
    if (to < 0 || to >= this.game.state.jars.length) {
      this.slider.lean(0);
      return;
    }
    const result = to === this.source ? 'moved' : this.game.canMove(id, to);
    if (result === 'moved') {
      this.app.scoopCross(to, () => this.slider.goTo(to));
    } else if (result === 'full') {
      // 隣をのぞいて戻ってくる（カップは今の瓶の上のまま）
      this.slider.peek(dir, HANDLING.fullPeek, HANDLING.fullPeekSeconds);
    } else {
      this.slider.lean(0);
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
