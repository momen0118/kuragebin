// 画面（瓶）への指の操作を、タップ・横のスワイプ・長押し（つまんで運ぶ）に分ける。
// 見るのは指1本だけ。縦に動かしたものは何もしない。長押しは泳ぐ個体の上でだけ。
import { HANDLING, SWIPE } from '../config';

/** 画面の上の位置（CSS px、描画の左上が原点） */
export interface Point {
  x: number;
  y: number;
}

export interface GestureHandlers {
  /**
   * 指が触れた。瓶が切り替わる途中なら 'swipe'（そのままつかんで引く）、
   * 泳ぐ個体の上なら 'holdable'（長押しでつまめる）、それ以外は 'plain'
   */
  press(p: Point): 'swipe' | 'holdable' | 'plain';
  tap(p: Point): void;
  swipeStart(): void;
  /** 横に動いた量（CSS px、右が正） */
  swipeMove(dx: number): void;
  /** 離したときの指の横の速さ（CSS px/秒） */
  swipeEnd(velocity: number): void;
  /** 長押しした。つまめたら true */
  holdStart(p: Point): boolean;
  holdMove(p: Point): void;
  holdEnd(): void;
}

type Phase = 'idle' | 'pending' | 'swipe' | 'hold' | 'done';

/** 離したときの速さを測る範囲（ミリ秒） */
const VELOCITY_WINDOW_MS = 100;

export class Gestures {
  private phase: Phase = 'idle';
  private pointer: number | null = null;
  private start: Point = { x: 0, y: 0 };
  private startT = 0;
  private last: Point = { x: 0, y: 0 };
  private samples: Array<{ t: number; x: number }> = [];
  private timer: number | undefined;

  constructor(
    private readonly el: HTMLElement,
    private readonly on: GestureHandlers,
  ) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e, false));
    el.addEventListener('pointercancel', (e) => this.up(e, true));
    // 長押しで出るメニューを出さない
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private point(e: PointerEvent): Point {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    if (this.pointer !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointer = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // 取れなくても、この要素の上の動きは届く
    }
    const p = this.point(e);
    this.start = p;
    this.last = p;
    this.startT = performance.now();
    this.samples = [{ t: this.startT, x: p.x }];
    const kind = this.on.press(p);
    if (kind === 'swipe') {
      this.phase = 'swipe';
      this.on.swipeStart();
      return;
    }
    this.phase = 'pending';
    if (kind === 'holdable') this.timer = window.setTimeout(() => this.long(), HANDLING.longPressMs);
  }

  private long(): void {
    this.timer = undefined;
    if (this.phase !== 'pending') return;
    this.phase = this.on.holdStart(this.last) ? 'hold' : 'done';
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.pointer) return;
    const p = this.point(e);
    this.last = p;
    const now = performance.now();
    this.samples.push({ t: now, x: p.x });
    while (this.samples.length > 2 && this.samples[0]!.t < now - VELOCITY_WINDOW_MS) this.samples.shift();
    switch (this.phase) {
      case 'pending': {
        const dx = p.x - this.start.x;
        const dy = p.y - this.start.y;
        if (Math.hypot(dx, dy) <= SWIPE.startPx) return;
        this.clearTimer();
        if (Math.abs(dx) > Math.abs(dy)) {
          // 動き出したところから指についていく（しきい値の分だけ跳ばない）
          this.phase = 'swipe';
          this.start = p;
          this.on.swipeStart();
        } else {
          this.phase = 'done';
        }
        return;
      }
      case 'swipe':
        this.on.swipeMove(p.x - this.start.x);
        return;
      case 'hold':
        this.on.holdMove(p);
        return;
      default:
        return;
    }
  }

  private up(e: PointerEvent, cancelled: boolean): void {
    if (e.pointerId !== this.pointer) return;
    this.clearTimer();
    const p = this.point(e);
    const now = performance.now();
    switch (this.phase) {
      case 'pending':
        if (!cancelled && now - this.startT < HANDLING.longPressMs) this.on.tap(p);
        break;
      case 'swipe':
        this.samples.push({ t: now, x: p.x });
        this.on.swipeEnd(cancelled ? 0 : this.velocity(now));
        break;
      case 'hold':
        this.on.holdEnd();
        break;
      default:
        break;
    }
    this.phase = 'idle';
    this.pointer = null;
  }

  /** 最後の少しの間の、指の横の速さ（CSS px/秒）。止めてから離したら 0 */
  private velocity(now: number): number {
    const s = this.samples.filter((v) => v.t >= now - VELOCITY_WINDOW_MS);
    if (s.length < 2) return 0;
    const a = s[0]!;
    const b = s[s.length - 1]!;
    const dt = b.t - a.t;
    return dt > 8 ? ((b.x - a.x) / dt) * 1000 : 0;
  }

  private clearTimer(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
