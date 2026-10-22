// 季節（桜）。状態には持たず、端末の現地の日付だけで決まる。描画・DOM に依存しない
import { SAKURA, SIM } from '../config';
import { createRng } from './rng';

/** 天板に落ちている花びら：止まっている瓶の座標の天板の上の x・z と、向き（ラジアン） */
export interface Petal {
  x: number;
  z: number;
  angle: number;
}

const monthDay = (d: Date): number => (d.getMonth() + 1) * 100 + d.getDate();

/** 桜の季節か（端末の現地の日付。両端を含む） */
export function inSakuraSeason(wallMs: number): boolean {
  const md = monthDay(new Date(wallMs));
  return md >= SAKURA.start[0] * 100 + SAKURA.start[1] && md <= SAKURA.end[0] * 100 + SAKURA.end[1];
}

/** その日に天板に落ちている花びら。季節の外か、落ちていない日は null。同じ日なら同じ所 */
export function petalOf(wallMs: number): Petal | null {
  if (!inSakuraSeason(wallMs)) return null;
  const d = new Date(wallMs);
  const day = d.getFullYear() * 10000 + monthDay(d);
  const rng = createRng((SIM.seed ^ Math.imul(day, 0x9e3779b1)) >>> 0);
  if (rng.next() >= SAKURA.petalChance) return null;
  const side = rng.next() < 0.5 ? -1 : 1;
  return {
    x: side * rng.range(SAKURA.petalX[0], SAKURA.petalX[1]),
    z: rng.range(SAKURA.petalZ[0], SAKURA.petalZ[1]),
    angle: rng.range(0, Math.PI * 2),
  };
}
