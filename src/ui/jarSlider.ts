// 3つの瓶の並びの上の、見ている位置（0 が1番の瓶、スワイプの途中は小数）。
// 指で引いている間は指についていき、端の瓶の外へは少しだけ引っ張れる。離すと近いほうの瓶へばねで落ち着く
// （速く払ったときは、払った向きの隣の瓶へ）。1回のスワイプで動くのは隣の瓶まで。3と1はつながっていない。
import { SWIPE } from '../config';

type Mode = 'rest' | 'drag' | 'spring';

export class JarSlider {
  private pos: number;
  private vel = 0;
  private mode: Mode = 'rest';
  /** 向かっている先。ふだんは瓶の番号で、隣をのぞく・寄るときは小数 */
  private target: number;
  /** 今いる瓶（落ち着いた瓶、または向かっている瓶） */
  private home: number;
  /** 最後に知らせた瓶 */
  private settled: number;
  /** 引きはじめたときの位置（端の手応えを外した値）と、そのときにいた瓶 */
  private dragFrom = 0;
  private dragHome = 0;
  /** 隣をのぞいている残りの時間（秒） */
  private peekLeft = 0;
  /** 瓶に落ち着いた（前に落ち着いた瓶と違うときだけ） */
  onSettle: ((index: number) => void) | null = null;

  constructor(
    private readonly count: number,
    start: number,
    /** 瓶1つ分の画面上の長さ（CSS px） */
    private readonly stepPx: () => number,
  ) {
    this.pos = this.target = this.home = this.settled = this.clampIndex(start);
  }

  /** 見ている位置（0 が1番の瓶） */
  get position(): number {
    return this.pos;
  }

  /** 今いる瓶 */
  get index(): number {
    return this.home;
  }

  /** 指で引いている途中か、瓶が大きく動いている途中か（指が触れたら、つかんで止める） */
  get moving(): boolean {
    return this.mode === 'drag' || (this.mode === 'spring' && (Math.abs(this.target - this.pos) > 0.01 || Math.abs(this.vel) > 0.05));
  }

  private clampIndex(i: number): number {
    return Math.min(Math.max(Math.round(i), 0), this.count - 1);
  }

  /** 端の瓶の外へ引いた量 o（瓶の数）を、手応えのある量にする。edgeMax より先へは行かない */
  private band(o: number): number {
    return SWIPE.edgeMax * (1 - Math.exp((-o * SWIPE.edgeResist) / SWIPE.edgeMax));
  }

  private unband(b: number): number {
    const k = Math.min(b / SWIPE.edgeMax, 0.999);
    return (-Math.log(1 - k) * SWIPE.edgeMax) / SWIPE.edgeResist;
  }

  /** 引いた位置（手応えなし）→ 見える位置 */
  private rubber(raw: number): number {
    const hi = this.count - 1;
    if (raw < 0) return -this.band(-raw);
    if (raw > hi) return hi + this.band(raw - hi);
    return raw;
  }

  private unrubber(pos: number): number {
    const hi = this.count - 1;
    if (pos < 0) return -this.unband(-pos);
    if (pos > hi) return hi + this.unband(pos - hi);
    return pos;
  }

  /** 指でつかむ（動いている途中なら、その場で止める） */
  grab(): void {
    this.mode = 'drag';
    this.vel = 0;
    this.peekLeft = 0;
    this.dragFrom = this.unrubber(this.pos);
    this.dragHome = this.clampIndex(this.pos);
  }

  /** つかんでから横に dx（CSS px、右が正）動いた。指を右へ動かすと、左の瓶が見えてくる */
  drag(dx: number): void {
    if (this.mode !== 'drag') return;
    this.pos = this.rubber(this.dragFrom - dx / Math.max(this.stepPx(), 1));
  }

  /** 離した。velocity は指の横の速さ（CSS px/秒） */
  release(velocity: number): void {
    if (this.mode !== 'drag') return;
    const v = Math.min(Math.max(-velocity / Math.max(this.stepPx(), 1), -SWIPE.maxSpeed), SWIPE.maxSpeed);
    let t: number;
    if (Math.abs(v) > SWIPE.flickSpeed) t = v > 0 ? Math.floor(this.pos) + 1 : Math.ceil(this.pos) - 1;
    else t = Math.round(this.pos);
    t = this.clampIndex(Math.min(Math.max(t, this.dragHome - 1), this.dragHome + 1));
    this.home = this.target = t;
    this.vel = v;
    this.mode = 'spring';
  }

  /** 瓶 i へ動く */
  goTo(i: number): void {
    this.home = this.target = this.clampIndex(i);
    this.peekLeft = 0;
    this.mode = 'spring';
  }

  /** 今の瓶から、隣の瓶のほうへ offset（瓶の数）だけ寄る。0 で戻る */
  lean(offset: number): void {
    this.target = this.home + offset;
    this.peekLeft = 0;
    this.mode = 'spring';
  }

  /** 隣の瓶（dir が 1 なら右、-1 なら左）を amount だけのぞいて、seconds 後に戻る */
  peek(dir: number, amount: number, seconds: number): void {
    this.target = this.home + dir * amount;
    this.peekLeft = seconds;
    this.mode = 'spring';
  }

  /** ほとんど落ち着いているなら、落ち着いたことにする（タップをすぐ受けられるように） */
  finish(): void {
    if (this.mode === 'spring' && !this.moving && this.peekLeft <= 0) this.arrive();
  }

  /** すぐに瓶 i にする（読み込んだ状態など）。知らせない */
  set(i: number): void {
    this.pos = this.target = this.home = this.settled = this.clampIndex(i);
    this.vel = 0;
    this.peekLeft = 0;
    this.mode = 'rest';
  }

  /** 確認用：決めた位置で止めておく（スワイプの途中の見た目）。release(0) で近いほうへ落ち着く */
  pin(position: number): void {
    this.grab();
    this.pos = position;
  }

  update(dt: number): void {
    if (this.mode !== 'spring') return;
    const w = SWIPE.settle;
    let left = Math.min(Math.max(dt, 0), 0.1);
    while (left > 0) {
      const h = Math.min(left, 1 / 240);
      const acc = w * w * (this.target - this.pos) - 2 * w * this.vel;
      this.vel += acc * h;
      this.pos += this.vel * h;
      left -= h;
    }
    if (this.peekLeft > 0) {
      this.peekLeft -= dt;
      if (this.peekLeft <= 0) this.target = this.home;
    }
    if (this.peekLeft <= 0 && Math.abs(this.target - this.pos) < 5e-4 && Math.abs(this.vel) < 5e-3) {
      if (this.target === this.home) this.arrive();
      else {
        this.pos = this.target;
        this.vel = 0;
      }
    }
  }

  private arrive(): void {
    this.pos = this.target = this.home;
    this.vel = 0;
    this.mode = 'rest';
    if (this.home !== this.settled) {
      this.settled = this.home;
      this.onSettle?.(this.home);
    }
  }
}
