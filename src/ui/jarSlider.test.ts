import { describe, expect, test } from 'vitest';
import { SWIPE } from '../config';
import { JarSlider } from './jarSlider';

const STEP = 400;

function slider(start = 0): { s: JarSlider; settled: number[] } {
  const settled: number[] = [];
  const s = new JarSlider(3, start, () => STEP);
  s.onSettle = (i) => settled.push(i);
  return { s, settled };
}

function run(s: JarSlider, seconds = 2): void {
  for (let t = 0; t < seconds; t += 1 / 60) s.update(1 / 60);
}

describe('瓶の切り替え', () => {
  test('半分より手前で離すと元の瓶へ戻り、半分を越えると隣の瓶へ', () => {
    const { s, settled } = slider();
    s.grab();
    s.drag(-0.4 * STEP);
    expect(s.position).toBeCloseTo(0.4);
    s.release(0);
    run(s);
    expect(s.position).toBe(0);
    expect(settled).toEqual([]);

    s.grab();
    s.drag(-0.6 * STEP);
    s.release(0);
    run(s);
    expect(s.position).toBe(1);
    expect(settled).toEqual([1]);
  });

  test('速く払えば少しの動きでも隣の瓶へ。1回で動くのは隣まで', () => {
    const { s } = slider(1);
    s.grab();
    s.drag(0.1 * STEP);
    s.release((SWIPE.flickSpeed + 0.5) * STEP);
    run(s);
    expect(s.index).toBe(0);

    const b = slider(0).s;
    b.grab();
    b.drag(-1.9 * STEP);
    b.release(-5 * STEP);
    run(b);
    expect(b.index).toBe(1);
  });

  test('端の瓶の外へは少しだけ引っ張れて、離すと戻る', () => {
    const { s } = slider(0);
    s.grab();
    s.drag(2 * STEP);
    expect(s.position).toBeLessThan(0);
    expect(s.position).toBeGreaterThan(-SWIPE.edgeMax);
    s.release(3 * STEP);
    run(s);
    expect(s.position).toBe(0);

    const e = slider(2).s;
    e.grab();
    e.drag(-0.5 * STEP);
    expect(e.position).toBeGreaterThan(2);
    expect(e.position).toBeLessThan(2 + SWIPE.edgeMax);
  });

  test('動いている途中でつかむと、その場で止まる（跳ばない）', () => {
    const { s } = slider(0);
    s.goTo(1);
    s.update(0.05);
    const p = s.position;
    expect(p).toBeGreaterThan(0);
    expect(s.moving).toBe(true);
    s.grab();
    s.drag(0);
    expect(s.position).toBeCloseTo(p, 6);
  });

  test('隣をのぞいて戻る。寄る・戻るでは知らせない', () => {
    const { s, settled } = slider(1);
    s.peek(1, 0.4, 0.3);
    run(s, 0.25);
    expect(s.position).toBeGreaterThan(1.2);
    run(s, 2);
    expect(s.position).toBe(1);
    s.lean(-0.08);
    run(s, 1);
    expect(s.position).toBeCloseTo(0.92, 3);
    s.lean(0);
    run(s, 1);
    expect(s.position).toBe(1);
    expect(settled).toEqual([]);
  });
});
