import { describe, expect, test } from 'vitest';
import { ADULT_GROWTH } from '../config';
import { advance } from './advance';
import { spawnCreature } from './edit';
import { bodySize } from './size';
import { createInitialState } from './state';

const T0 = Date.UTC(2026, 9, 20, 3, 0, 0);
const DAY = 86400;

describe('成体になってからの成長', () => {
  test('エフィラから成体になった直後は小さめで、大きさがつながる', () => {
    const s = createInitialState(T0);
    const e = spawnCreature(s, 0, 'ephyra');
    e.progress = 0;
    expect(bodySize(e)).toBe(1);
    e.progress = 1;
    const end = bodySize(e);
    expect(end).toBeCloseTo(e.fullSize * ADULT_GROWTH.start, 6);
    // 成体になると、成体になった直後の大きさから
    e.progress = 0.999;
    const n = advance(s, DAY);
    const a = n.jars[0]!.creatures.find((c) => c.id === e.id)!;
    expect(a.stage).toBe('adult');
    expect(a.adultGrowth).toBeLessThan(1);
    expect(bodySize({ ...a, adultGrowth: 0 })).toBeCloseTo(end, 6);
  });

  test('数日かけて毎日少しずつ、育ちきった大きさに近づく（急に大きくならず、だんだんゆっくり）', () => {
    let s = createInitialState(T0);
    const c = spawnCreature(s, 0, 'adult');
    c.adultGrowth = 0;
    const sizes: number[] = [];
    for (let d = 0; d <= 8; d++) {
      sizes.push(bodySize(s.jars[0]!.creatures.find((x) => x.id === c.id)!));
      s = advance(s, DAY);
    }
    const gains = sizes.slice(1).map((v, i) => v - sizes[i]!);
    // 毎日大きくなる（育ちきるまで）。どの日も、その前の日より大きく伸びない
    for (let i = 0; i < 6; i++) expect(gains[i]!).toBeGreaterThan(0);
    for (let i = 1; i < gains.length; i++) expect(gains[i]!).toBeLessThanOrEqual(gains[i - 1]! + 1e-9);
    // いちばん伸びる日でも、育ちきった大きさの一割ほど
    expect(Math.max(...gains)).toBeLessThan(0.12 * c.fullSize);
    expect(sizes.at(-1)).toBeCloseTo(c.fullSize, 6);
  });

  test('育ちきった大きさは個体ごとに少し違い、上限を越えない。最初の一匹は今までの大きさ', () => {
    const s = createInitialState(T0);
    expect(bodySize(s.jars[0]!.creatures[0]!)).toBe(1);
    const sizes = Array.from({ length: 40 }, () => spawnCreature(s, 1, 'adult').fullSize);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(ADULT_GROWTH.fullSize[0]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(ADULT_GROWTH.fullSize[1]);
    expect(new Set(sizes.map((v) => v.toFixed(3))).size).toBeGreaterThan(10);
  });
});
