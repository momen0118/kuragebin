// 拾いものの手触り。拾った物は小さな光になって左下の日誌のアイコンへ吸い込まれる（文字は出さない）。
import { FIND_FLIGHT } from '../config';

const ease = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

/** 光が from から to（画面の CSS px）へ、少し上へふくらむ弧を描いて飛び、着いたら onArrive */
export function flyLight(from: { x: number; y: number }, to: { x: number; y: number }, onArrive: () => void = () => {}): void {
  const el = document.createElement('div');
  el.className = 'find-spark';
  document.body.appendChild(el);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const ms = reduced ? 1 : FIND_FLIGHT.seconds * 1000;
  const [s0, s1] = FIND_FLIGHT.size;
  const t0 = performance.now();
  const step = (now: number): void => {
    const k = Math.min((now - t0) / ms, 1);
    const e = ease(k);
    // 2次のベジエ（真ん中の制御点を上へ持ち上げる）
    const cx = (from.x + to.x) / 2;
    const cy = Math.min(from.y, to.y) - FIND_FLIGHT.arc;
    const x = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * cx + e * e * to.x;
    const y = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * cy + e * e * to.y;
    const size = s0 + (s1 - s0) * e;
    el.style.transform = `translate(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px)`;
    el.style.width = el.style.height = `${size.toFixed(1)}px`;
    // はじめにふっと明るくなり、着くころに消える
    el.style.opacity = (Math.min(k / 0.12, 1) * (1 - ease((k - 0.8) / 0.2))).toFixed(3);
    if (k < 1) requestAnimationFrame(step);
    else {
      el.remove();
      onArrive();
    }
  };
  requestAnimationFrame(step);
}
