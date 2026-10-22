// 桜の季節に天板に落ちている花びら（一枚）。置いてあるだけで、触っても何も起きない（指の操作は下の画面へ通す）。
// 封筒・虫眼鏡と同じく部屋の側に一つで、瓶を切り替えても動かない
import { SAKURA } from '../config';

export class PetalView {
  private readonly el: HTMLDivElement;
  private shown = false;

  constructor() {
    const el = document.createElement('div');
    el.className = 'petal';
    el.setAttribute('aria-hidden', 'true');
    el.style.setProperty('--size', `${SAKURA.petalSize}px`);
    // 先に切れ込みのある、桜の花びら。根元ほど少し濃い桃色
    el.innerHTML = `<svg class="leaf" viewBox="0 0 20 24">
      <defs><linearGradient id="petal-shade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fbf0f2"/><stop offset="0.7" stop-color="#f3d6dd"/><stop offset="1" stop-color="#e7b2c1"/>
      </linearGradient></defs>
      <path d="M10 23.5C3.5 19.5 0.6 12.5 2.2 5.6 3 2.4 6 1 8.2 2.2L10 4.6 11.8 2.2C14 1 17 2.4 17.8 5.6 19.4 12.5 16.5 19.5 10 23.5Z" fill="url(#petal-shade)"/>
    </svg>`;
    document.body.appendChild(el);
    this.el = el;
  }

  /** 画面の上の位置（CSS px）・大きさの倍率・向き（ラジアン）。null なら出さない */
  place(at: { x: number; y: number; scale: number } | null, angle = 0): void {
    const show = at !== null;
    if (show !== this.shown) {
      this.shown = show;
      this.el.classList.toggle('shown', show);
    }
    if (!at) return;
    this.el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%) scale(${at.scale.toFixed(3)})`;
    this.el.style.setProperty('--angle', `${angle.toFixed(3)}rad`);
  }

  /** 部屋の明るさ（1 で昼） */
  setLum(lum: number): void {
    this.el.style.setProperty('--lum', lum.toFixed(3));
  }
}
