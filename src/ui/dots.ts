// 下端の中央の点3つ。今どの瓶を見ているか。スワイプの途中は、近いほうの瓶の点ほど明るい。
import { DOTS } from '../config';

export class JarDots {
  private readonly dots: HTMLSpanElement[];
  private shown = Number.NaN;

  constructor(count: number) {
    const box = document.createElement('div');
    box.className = 'jar-dots';
    box.setAttribute('aria-hidden', 'true');
    this.dots = Array.from({ length: count }, () => box.appendChild(document.createElement('span')));
    document.body.appendChild(box);
  }

  /** 見ている位置（0 が1番の瓶、スワイプの途中は小数） */
  set(position: number): void {
    if (Math.abs(position - this.shown) < 1e-3) return;
    this.shown = position;
    this.dots.forEach((d, i) => {
      const near = Math.max(0, 1 - Math.abs(i - position));
      d.style.opacity = (DOTS.dim + (DOTS.bright - DOTS.dim) * near).toFixed(3);
    });
  }
}
