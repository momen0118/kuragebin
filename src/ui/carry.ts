// 泳ぐ個体を、カップに水ごと入れて運ぶ（長押しから）。指で動かすのはカップ。
// 左右の端へ運んで少し置くと、画面が隣の瓶へ移り、カップも隣の瓶の上へ（ここでは放さない）。
// 隣の瓶が上限なら、隣をのぞいて戻ってくる。指を離したとき、カップがいる瓶の水の中で放す
// （元の瓶の上なら元の瓶へ戻す）。状態を移すのは指を離したとき。
// 運んでいる間は、天板の手前に「おじさんに送る」と下向きの印が出る。指をそこ（画面の下のほう）まで運ぶと箱がせり上がり、離すとカップが箱の上へ行き、
// 「この子を送る？」と確かめる。送るなら箱の中の水へ放し、やめるなら瓶の口の上へ戻って瓶の水へ放す。
import { BOX, HANDLING } from '../config';
import type { Game } from '../game';
import type { App } from '../render/app';
import type { Point } from './gestures';
import type { JarSlider } from './jarSlider';
import type { SendConfirm } from './sendConfirm';

export class Carry {
  private active = false;
  /** 運びはじめた瓶 */
  private source = 0;
  /** 指がいる端（-1 で左、1 で右、0 で端でない） */
  private edge = 0;
  /** 指が画面の下のほう（箱のあたり）にあるか */
  private nearBox = false;
  private timer: number | undefined;

  constructor(
    private readonly app: App,
    private readonly game: Game,
    private readonly slider: JarSlider,
    private readonly toNdc: (p: Point) => [number, number],
    private readonly width: () => number,
    private readonly confirm: SendConfirm,
    /** 箱の上で待っているカップの上端（CSS px） */
    private readonly boxAnchor: () => { x: number; y: number },
  ) {}

  /** 指が画面の下のほう（箱のあたり）にあるか（運んでいる間だけ） */
  get atBox(): boolean {
    return this.active && this.nearBox;
  }

  /** 個体 id をカップに入れて上げはじめる。はじめられたら true */
  start(id: number, p: Point): boolean {
    if (!this.app.scoopStart(id)) return false;
    this.active = true;
    this.edge = 0;
    this.nearBox = false;
    this.app.scoopNearBox(false);
    this.source = this.app.scoopDestination;
    const [x, y] = this.toNdc(p);
    this.app.scoopFollow(x, y);
    return true;
  }

  move(p: Point): void {
    if (!this.active) return;
    const [x, y] = this.toNdc(p);
    this.app.scoopFollow(x, y);
    this.nearBox = y < -1 + 2 * BOX.zone;
    this.app.scoopNearBox(this.nearBox);
    const w = this.width();
    const zone = w * HANDLING.edgeZone;
    // 箱のあたりにいる間は、隣の瓶へ移らない
    const edge = this.nearBox ? 0 : p.x < zone ? -1 : p.x > w - zone ? 1 : 0;
    if (edge === this.edge) return;
    this.edge = edge;
    this.clearTimer();
    this.slider.lean(edge * HANDLING.edgeLean);
    if (edge) this.timer = window.setTimeout(() => this.cross(edge), HANDLING.edgeDwellMs);
  }

  /** 指を離した：カップがいる瓶の水の中で放す（箱のあたりなら、箱の上へ運んで送るかを確かめる）。運びはじめた瓶と違えば、そこで状態を移す */
  end(): void {
    this.clearTimer();
    if (!this.active) return;
    this.active = false;
    this.slider.lean(0);
    const id = this.app.scoopId;
    if (id === null) return;
    if (this.nearBox && this.game.canSend(id) === 'sent') {
      this.app.scoopToBox(() =>
        this.confirm.ask(this.boxAnchor(), (send) => {
          if (send && this.game.send(id) === 'sent') this.app.scoopSendToBox();
          else this.putBack(id, () => this.app.scoopBackFromBox());
        }),
      );
      return;
    }
    this.putBack(id, () => this.app.scoopRelease());
  }

  /** カップがいる瓶の水へ放す（release で放しはじめる）。運びはじめた瓶と違えば、そこで状態を移す */
  private putBack(id: number, release: () => void): void {
    this.app.scoopNearBox(false);
    const dest = this.app.scoopDestination;
    if (dest !== this.source && this.game.moveCreature(id, dest) !== 'moved') {
      // その間に移せなくなっていた（上限など）：元の瓶の上へ戻ってから、元の瓶へ放す
      const src = this.source;
      this.app.scoopCross(src, () => this.slider.goTo(src));
    }
    release();
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
