// 虫眼鏡（道具）。瓶の手前の天板に寝かせて置いてある。ドラッグで持ち上げて瓶のガラスの上へ持っていくと、
// レンズの中が拡大して見える（描くのは描画側）。指を離してもその場に残り、もう一度ドラッグで動かせる。
// 天板（画面の下のほう）へドラッグして離すと、元の所へ戻る。札の「よく見る」で、その個体の上へ動いてしばらくついていく。
// レンズや柄の上のタップは瓶をつつかない（レンズの外はいつもどおり）。瓶を切り替えると天板へ戻る。
// 枠と柄はこの要素（CSS）で描き、レンズの中は描画側が描く。持ち上げている間（lift）だけレンズの中を描く。
import { LOUPE } from '../config';
import { keepToSelf } from './jarActions';

type Mode = 'table' | 'held' | 'placed' | 'follow' | 'returning';

export interface LoupeOptions {
  /** 天板に置いてある所（CSS px、レンズの真ん中）と、近さによる大きさの倍率、見え方の濃さ（瓶を切り替えている間は薄く） */
  rest(): { x: number; y: number; scale: number; alpha: number };
  /** 「よく見る」の個体の見えている位置（CSS px）。いなくなっていれば null */
  target(id: number): { x: number; y: number } | null;
  /** 持ち上げた・置いた（札を消すなど） */
  lifted(): void;
}

const ease = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

/** 柄を持ったときの、指からレンズの真ん中まで（柄は右下へ 45°） */
const GRIP = (LOUPE.radius + LOUPE.frame + LOUPE.handle * 0.55) / Math.SQRT2;

export class Loupe {
  private readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private mode: Mode = 'table';
  /** 起こし具合（0 で天板に寝ている、1 で起きてガラスの上） */
  private lift = 0;
  /** レンズの真ん中（CSS px）と、向かう所 */
  private x = 0;
  private y = 0;
  private tx = 0;
  private ty = 0;
  /** 天板から持ち上げはじめた所（起こしながら指の所へ動く） */
  private fromX = 0;
  private fromY = 0;
  /** 指からレンズの真ん中まで */
  private gx = 0;
  private gy = 0;
  private pointer: number | null = null;
  private moved = false;
  private downX = 0;
  private downY = 0;
  /** 「よく見る」の個体と、ついていく残りの時間 */
  private watching: number | null = null;
  private followLeft = 0;
  private hidden = false;
  /** 拡大の倍率 */
  zoom: number = LOUPE.zoom;

  constructor(private readonly opts: LoupeOptions) {
    const el = document.createElement('div');
    el.className = 'loupe';
    el.innerHTML = `<div class="loupe-body"><div class="loupe-handle"></div><div class="loupe-ring" role="button" aria-label="虫眼鏡"></div></div>`;
    el.style.setProperty('--r', `${LOUPE.radius}px`);
    el.style.setProperty('--frame', `${LOUPE.frame}px`);
    el.style.setProperty('--handle', `${LOUPE.handle}px`);
    el.style.setProperty('--handle-w', `${LOUPE.handleWidth}px`);
    document.body.appendChild(el);
    this.el = el;
    this.body = el.querySelector('.loupe-body')!;
    for (const part of el.querySelectorAll<HTMLElement>('.loupe-ring, .loupe-handle')) {
      keepToSelf(part);
      part.addEventListener('pointerdown', (e) => this.down(e));
      part.addEventListener('pointermove', (e) => this.move(e));
      part.addEventListener('pointerup', (e) => this.up(e));
      part.addEventListener('pointercancel', (e) => this.up(e));
    }
  }

  /** 瓶のガラスの上にあるか（持っている・置いてある・ついていっている） */
  get inUse(): boolean {
    return this.mode !== 'table' && this.mode !== 'returning';
  }

  /** 描画側へ渡すレンズ（起きているときだけ）。null で描かない */
  get lens(): { x: number; y: number; radius: number; zoom: number; alpha: number } | null {
    if (this.lift < 0.5) return null;
    return { x: this.x, y: this.y, radius: LOUPE.radius, zoom: this.zoom, alpha: ease((this.lift - 0.5) / 0.5) };
  }

  /** 確認用：今の様子 */
  get state(): { mode: Mode; x: number; y: number; lift: number; watching: number | null } {
    return { mode: this.mode, x: this.x, y: this.y, lift: this.lift, watching: this.watching };
  }

  /** 天板の元の所へ戻す（瓶を切り替えたときなど） */
  returnToTable(): void {
    if (this.mode === 'table' || this.mode === 'returning') return;
    this.release();
    this.watching = null;
    this.mode = 'returning';
    this.fromX = this.x;
    this.fromY = this.y;
  }

  /** 「よく見る」：個体 id の上へ動いて、しばらくついていく */
  lookAt(id: number): void {
    const t = this.opts.target(id);
    if (!t) return;
    this.release();
    if (this.mode === 'table' || this.mode === 'returning') {
      this.fromX = this.x;
      this.fromY = this.y;
      this.opts.lifted();
    }
    this.mode = 'follow';
    this.watching = id;
    this.followLeft = LOUPE.followSeconds;
    this.tx = t.x;
    this.ty = t.y;
  }

  /** 出さない（カップやスポイトを使っている間の、天板に置いてある虫眼鏡） */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
  }

  /** 部屋の明るさに合わせた枠と柄の明るさ（1 で昼） */
  setLum(lum: number): void {
    this.el.style.setProperty('--lum', lum.toFixed(3));
  }

  update(dt: number): void {
    const rest = this.opts.rest();
    const up = this.mode !== 'table' && this.mode !== 'returning';
    const step = dt / (this.mode === 'returning' ? LOUPE.returnSeconds : LOUPE.liftSeconds);
    this.lift = up ? Math.min(1, this.lift + step) : Math.max(0, this.lift - step);
    if (this.mode === 'follow') {
      const id = this.watching;
      const t = id !== null ? this.opts.target(id) : null;
      this.followLeft -= dt;
      if (!t || this.followLeft <= 0) {
        this.mode = 'placed';
        this.watching = null;
      } else {
        const k = 1 - Math.exp(-LOUPE.followRate * dt);
        this.tx += (t.x - this.tx) * k;
        this.ty += (t.y - this.ty) * k;
      }
    }
    const e = ease(this.lift);
    if (this.mode === 'table') {
      this.x = rest.x;
      this.y = rest.y;
    } else if (this.mode === 'returning') {
      // 起こした所から、寝かせながら天板の元の所へ
      const k = 1 - e;
      this.x = this.fromX + (rest.x - this.fromX) * k;
      this.y = this.fromY + (rest.y - this.fromY) * k;
      if (this.lift <= 0) this.mode = 'table';
    } else if (this.lift < 1) {
      // 天板から起こしながら、持つ所へ
      this.x = this.fromX + (this.tx - this.fromX) * e;
      this.y = this.fromY + (this.ty - this.fromY) * e;
    } else {
      const k = this.mode === 'held' ? 1 - Math.exp(-30 * dt) : this.mode === 'follow' ? 1 : 1 - Math.exp(-12 * dt);
      this.x += (this.tx - this.x) * k;
      this.y += (this.ty - this.y) * k;
    }
    this.draw(rest, e);
  }

  private draw(rest: { scale: number; alpha: number }, e: number): void {
    // 寝かせて置いたとき：小さく、奥へ倒し、柄は少し横へ向ける
    const scale = rest.scale * LOUPE.restScale + (1 - rest.scale * LOUPE.restScale) * e;
    const tilt = 62 * (1 - e);
    const turn = -28 * (1 - e);
    const alpha = this.mode === 'table' || this.mode === 'returning' ? rest.alpha + (1 - rest.alpha) * e : 1;
    this.el.style.transform = `translate(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px)`;
    this.body.style.transform = `perspective(500px) rotateX(${tilt.toFixed(1)}deg) rotate(${turn.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
    this.el.style.opacity = this.hidden && this.lift < 0.5 ? '0' : alpha.toFixed(3);
    this.el.classList.toggle('up', this.lift >= 0.5);
    this.el.classList.toggle('off', (this.hidden && this.lift < 0.5) || alpha < 0.05);
  }

  private down(e: PointerEvent): void {
    if (this.pointer !== null || (this.hidden && !this.inUse)) return;
    e.preventDefault();
    this.pointer = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.moved = false;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.watching = null;
    if (this.mode === 'table' || this.mode === 'returning') {
      // 天板から持ち上げる：柄を持ったつもりで、レンズは指の左上に
      this.fromX = this.x;
      this.fromY = this.y;
      this.gx = -GRIP;
      this.gy = -GRIP;
      this.opts.lifted();
    } else {
      this.gx = this.x - e.clientX;
      this.gy = this.y - e.clientY;
    }
    this.mode = 'held';
    this.tx = e.clientX + this.gx;
    this.ty = e.clientY + this.gy;
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.pointer) return;
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 6) this.moved = true;
    this.tx = e.clientX + this.gx;
    this.ty = e.clientY + this.gy;
  }

  private up(e: PointerEvent): void {
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    // 天板（画面の下のほう）で離したら元の所へ。それ以外はその場に置く
    if (this.moved && this.ty > window.innerHeight * LOUPE.tableY) {
      this.mode = 'held';
      this.returnToTable();
    } else {
      this.mode = 'placed';
    }
  }

  /** 指を離したことにする（持っている途中で戻すとき） */
  private release(): void {
    this.pointer = null;
  }
}
