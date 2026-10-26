import { describe, expect, test } from 'vitest';
import { FEED, GROWTH, STIR } from '../config';
import { advance } from './advance';
import { spawnCreature } from './edit';
import { growthRate, stirJar } from './growth';
import { createInitialState, type GameState, type Stage } from './state';

const T0 = new Date(2026, 8, 27, 9).getTime();
const HOUR = 3600;

/** 瓶1に段階 stage の個体を1つだけ置いた状態 */
function only(stage: Stage): GameState {
  const s = createInitialState(T0);
  s.jars[0]!.creatures = [];
  spawnCreature(s, 0, stage);
  return s;
}

describe('揺らしたときの育ちの早まり', () => {
  test('揺らしてから STIR.seconds の間だけ、エフィラが少し早く育つ', () => {
    const s = only('ephyra');
    const c = s.jars[0]!.creatures[0]!;
    s.time = 1000;
    stirJar(s, 0);
    const until = s.jars[0]!.stirredUntil!;
    expect(until).toBe(1000 + STIR.seconds);
    expect(growthRate(c, 1060, until)).toBeCloseTo(1 + STIR.boost);
    expect(growthRate(c, until, until)).toBeCloseTo(1 + STIR.boost);
    expect(growthRate(c, until + 60, until)).toBe(1);
  });

  test('ポリプと成体は変わらない', () => {
    const s = only('polyp');
    const c = s.jars[0]!.creatures[0]!;
    expect(growthRate(c, 60, STIR.seconds)).toBe(1);
    c.stage = 'adult';
    expect(growthRate(c, 60, STIR.seconds)).toBe(1);
  });

  test('何度揺らしても量は増えず、時間が延びるだけ', () => {
    const s = only('ephyra');
    const c = s.jars[0]!.creatures[0]!;
    stirJar(s, 0);
    s.time += 2 * HOUR;
    stirJar(s, 0);
    stirJar(s, 0);
    const until = s.jars[0]!.stirredUntil!;
    expect(until).toBe(s.time + STIR.seconds);
    expect(growthRate(c, s.time + 60, until)).toBeCloseTo(1 + STIR.boost);
  });

  test('餌の早まりと上限を分け合う。餌で上限に届いていれば、揺らしても何も足されない', () => {
    const s = only('ephyra');
    const c = s.jars[0]!.creatures[0]!;
    stirJar(s, 0);
    const until = s.jars[0]!.stirredUntil!;
    c.meal = { at: 0, amount: 1 };
    expect(FEED.growthBoost).toBeGreaterThanOrEqual(GROWTH.cap);
    expect(growthRate(c, 60, until)).toBeCloseTo(1 + GROWTH.cap);
    c.meal = { at: 0, amount: 0.8 };
    expect(growthRate(c, 60, until)).toBeCloseTo(1 + Math.min(FEED.growthBoost * 0.8 + STIR.boost, GROWTH.cap));
    expect(growthRate(c, 60, null)).toBeCloseTo(1 + FEED.growthBoost * 0.8);
  });

  test('揺らした瓶のエフィラだけが早く育つ（ほかの瓶は変わらない）', () => {
    const s = only('ephyra');
    spawnCreature(s, 1, 'ephyra');
    s.jars[1]!.creatures[0]!.stageLength = s.jars[0]!.creatures[0]!.stageLength;
    stirJar(s, 0);
    const n = advance(s, 2 * HOUR);
    const [a, b] = [n.jars[0]!.creatures[0]!, n.jars[1]!.creatures[0]!];
    expect(a.progress / b.progress).toBeCloseTo(1 + STIR.boost, 5);
  });

  test('揺れの記録があっても、分けて進めて同じ結果', () => {
    const s = only('ephyra');
    stirJar(s, 0);
    const once = advance(s, 5 * HOUR);
    let split = s;
    for (const d of [100.5, 3600, 1234, 7000]) split = advance(split, d);
    split = advance(split, 5 * HOUR - (100.5 + 3600 + 1234 + 7000));
    expect(split.jars).toEqual(once.jars);
  });
});

describe('カブトクラゲの幼生の餌', () => {
  test('食べてから1日はエフィラと同じだけ早く育つ。成体は早まらない。揺らしても早まらない', () => {
    const s = createInitialState(T0);
    const l = spawnCreature(s, 1, 'larva', undefined, 'bolinopsis');
    l.meal = { at: 100, amount: 1 };
    const e = spawnCreature(s, 1, 'ephyra');
    e.meal = { at: 100, amount: 1 };
    expect(growthRate(l, 100 + HOUR)).toBeGreaterThan(1);
    expect(growthRate(l, 100 + HOUR)).toBeCloseTo(growthRate(e, 100 + HOUR));
    expect(growthRate(l, 100 + FEED.boostSeconds + 60)).toBe(1);
    const a = spawnCreature(s, 1, 'adult', undefined, 'bolinopsis');
    a.meal = { at: 100, amount: 1 };
    expect(growthRate(a, 100 + HOUR)).toBe(1);
    expect(growthRate({ ...l, meal: null }, 100, 100 + STIR.seconds - 10)).toBe(1);
  });
});
