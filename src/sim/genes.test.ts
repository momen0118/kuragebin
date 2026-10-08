import { describe, expect, test } from 'vitest';
import { GENES } from '../config';
import { advance } from './advance';
import { BASE_GENES, inheritGenes, sanitizeGenes, type Genes } from './genes';
import { createRng } from './rng';
import { createInitialState } from './state';

const T0 = new Date(2026, 9, 8, 9).getTime();

describe('個体差と変異', () => {
  test('最初の1匹は基準の遺伝子（今の見た目）', () => {
    const s = createInitialState(T0);
    expect(s.jars[0]!.creatures[0]!.genes).toEqual(BASE_GENES);
  });

  test('受け継ぐと少しずれ、範囲の外へは出ない', () => {
    const rng = createRng(1);
    let g: Genes = { ...BASE_GENES };
    for (let i = 0; i < 200; i++) {
      g = inheritGenes(g, rng, true);
      for (const k of ['hue', 'clarity', 'tentacle', 'tempo', 'glow'] as const) expect(Math.abs(g[k])).toBeLessThanOrEqual(1);
      for (const k of ['warp', 'ragged', 'leafJitter'] as const) expect(g[k]).toBeGreaterThanOrEqual(0);
    }
    const child = inheritGenes(BASE_GENES, createRng(2), false);
    expect(Math.abs(child.hue)).toBeLessThan(GENES.drift.hue * 4);
    expect(child.leaves).toBe(4);
  });

  test('何世代か経つと、系統ごとに色味が偏る（同じ親の子どうしは近い）', () => {
    const rng = createRng(7);
    const lineage = (): number => {
      let g: Genes = { ...BASE_GENES };
      for (let i = 0; i < 6; i++) g = inheritGenes(g, rng, false);
      return g.hue;
    };
    const ends = Array.from({ length: 40 }, lineage);
    const spread = Math.sqrt(ends.reduce((a, h) => a + h * h, 0) / ends.length);
    expect(spread).toBeGreaterThan(0.15);
    expect(spread).toBeLessThan(0.6);
  });

  test('三つ葉・五つ葉は合わせて10匹に1匹くらい（受け継がない）', () => {
    const rng = createRng(3);
    let odd = 0;
    const n = 4000;
    const five: Genes = { ...BASE_GENES, leaves: 5 };
    for (let i = 0; i < n; i++) if (inheritGenes(five, rng, true).leaves !== 4) odd++;
    expect(odd / n).toBeGreaterThan(0.07);
    expect(odd / n).toBeLessThan(0.13);
  });

  test('読めない値は基準にする', () => {
    expect(sanitizeGenes(null)).toEqual(BASE_GENES);
    expect(sanitizeGenes({ hue: 3, leaves: 7, warp: 'x' })).toEqual({ ...BASE_GENES, hue: 1 });
  });

  test('生まれた個体は親から受け継ぐ（進めて確かめる）', () => {
    const s = createInitialState(T0);
    s.jars[0]!.creatures[0]!.genes = { ...BASE_GENES, hue: 0.8 };
    const n = advance(s, 6 * 86400);
    const born = n.jars[0]!.creatures.filter((c) => c.id !== 1);
    expect(born.length).toBeGreaterThan(0);
    for (const c of born) expect(c.genes.hue).toBeGreaterThan(0.3);
  });
});
