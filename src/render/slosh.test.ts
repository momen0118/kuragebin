import { describe, expect, test } from 'vitest';
import { KICK } from '../config';
import { WaterMotion } from './slosh';

describe('振った一回ぶんの勢い', () => {
  test('振った向きの側の水面が下がり、何度か往復して静まる。端末の傾きには追従しない', () => {
    const w = new WaterMotion();
    w.kick({ dir: [1, 0, 0], size: 0.6, spin: false });
    const xs: number[] = [];
    for (let t = 0; t < 12; t += 1 / 60) {
      w.update(1 / 60);
      xs.push(w.slope.x);
    }
    // はじめは右（振った向き）が下がる
    const first = xs.find((x) => Math.abs(x) > 1e-3)!;
    expect(first).toBeLessThan(0);
    // 何度か往復する
    let flips = 0;
    for (let i = 1; i < xs.length; i++) if (Math.sign(xs[i]!) !== Math.sign(xs[i - 1]!) && Math.abs(xs[i]!) > 1e-3) flips++;
    expect(flips).toBeGreaterThanOrEqual(3);
    // 静まる
    expect(Math.abs(xs[xs.length - 1]!)).toBeLessThan(1e-3);
    expect(w.field.stir).toBeLessThan(0.05);
  });

  test('いきなり傾かず、ゆっくり立ち上がってから大きくなる', () => {
    const w = new WaterMotion();
    w.kick({ dir: [1, 0, 0], size: 1, spin: false });
    let max = 0;
    let early = 0;
    for (let t = 0; t < 1; t += 1 / 120) {
      w.update(1 / 120);
      if (t < KICK.spread * 0.2) early = Math.max(early, Math.abs(w.slope.x));
      max = Math.max(max, Math.abs(w.slope.x));
    }
    expect(early).toBeLessThan(max * 0.05);
  });

  test('続けて振ると、往復しても同じ向きに回り続ける', () => {
    const w = new WaterMotion();
    for (let i = 0; i < 4; i++) {
      w.kick({ dir: [i % 2 ? -1 : 1, 0, 0], size: 0.7, spin: false });
      for (let t = 0; t < 0.4; t += 1 / 60) w.update(1 / 60);
    }
    expect(Math.abs(w.field.omega.z)).toBeGreaterThan(1);
    expect(w.field.stir).toBeGreaterThan(0.5);
  });

  test('回すと、回した向きと逆に水が回る', () => {
    const w = new WaterMotion();
    w.kick({ dir: [0, 0, 1], size: 0.8, spin: true });
    for (let t = 0; t < 0.5; t += 1 / 60) w.update(1 / 60);
    expect(w.field.omega.z).toBeLessThan(-0.3);
  });
});
