import { describe, expect, test } from 'vitest';
import { PULSE } from '../../config';
import { createRng } from '../../sim/rng';
import { contractCurve, Pulse, relaxCurve } from './pulse';

describe('拍動の曲線', () => {
  test('縮む曲線は0から1へ、なめらかに立ち上がる', () => {
    expect(contractCurve(0)).toBeCloseTo(0);
    expect(contractCurve(1)).toBeCloseTo(1);
    // 立ち上がりは遅く、中ほどで速い
    expect(contractCurve(0.05)).toBeLessThan(0.05);
    expect(contractCurve(0.4)).toBeGreaterThan(0.5);
  });

  test('開く曲線は1から0へ戻り、わずかに開きすぎる', () => {
    expect(relaxCurve(0)).toBeCloseTo(1);
    let min = 1;
    for (let u = 0; u <= 2; u += 0.01) min = Math.min(min, relaxCurve(u));
    expect(min).toBeLessThan(0);
    expect(min).toBeGreaterThan(-PULSE.overshoot * 1.5);
    expect(Math.abs(relaxCurve(2))).toBeLessThan(0.02);
  });
});

describe('Pulse', () => {
  test('縮みは開きより速い', () => {
    const p = new Pulse(createRng(3));
    let maxUp = 0;
    let maxDown = 0;
    let prev = p.value();
    for (let i = 0; i < 120 * 30; i++) {
      p.update(1 / 120);
      const v = p.value();
      const d = (v - prev) * 120;
      maxUp = Math.max(maxUp, d);
      maxDown = Math.max(maxDown, -d);
      prev = v;
    }
    expect(maxUp).toBeGreaterThan(maxDown * 2);
  });

  test('値は途切れずにつながる', () => {
    const p = new Pulse(createRng(4));
    let prev = p.value();
    for (let i = 0; i < 120 * 60; i++) {
      p.update(1 / 120);
      const v = p.value();
      expect(Math.abs(v - prev)).toBeLessThan(0.1);
      prev = v;
    }
  });

  test('テンポは揺らぐが、極端には外れない', () => {
    const p = new Pulse(createRng(5));
    const starts: number[] = [];
    let was = false;
    for (let i = 0; i < 120 * 120; i++) {
      p.update(1 / 120);
      if (p.contracting && !was) starts.push(p.now);
      was = p.contracting;
    }
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
    const base = PULSE.contract + PULSE.relax;
    for (const g of gaps) {
      expect(g).toBeGreaterThan(base * 0.8);
      expect(g).toBeLessThan(base + PULSE.restMax + 0.8);
    }
    // 毎回まったく同じ間隔ではない
    expect(new Set(gaps.map((g) => g.toFixed(3))).size).toBeGreaterThan(gaps.length / 2);
  });

  test('同じシードからは同じ拍動', () => {
    const a = new Pulse(createRng(9));
    const b = new Pulse(createRng(9));
    for (let i = 0; i < 1000; i++) {
      a.update(1 / 120);
      b.update(1 / 120);
    }
    expect(a.value()).toBe(b.value());
  });
});
