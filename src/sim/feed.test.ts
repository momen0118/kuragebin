import { describe, expect, test } from 'vitest';
import { FEED } from '../config';
import { advance } from './advance';
import { clearFed, spawnCreature } from './edit';
import { canFeed, feedDay, feedJar, growthRate } from './feed';
import { createInitialState, type GameState, type Stage } from './state';

/** 端末の現地時刻（ミリ秒）。どの時間帯で走らせても同じになるよう、現地時刻で作る */
const local = (day: number, hour: number, minute = 0): number => new Date(2026, 8, day, hour, minute).getTime();
const DAY = 86400;

/** 瓶1に段階 stage の個体を1つだけ置いた状態 */
function only(stage: Stage): GameState {
  const s = createInitialState(local(27, 9));
  s.jars[0]!.creatures = [];
  spawnCreature(s, 0, stage);
  return s;
}

describe('餌の日', () => {
  test('朝4時で日を区切る。夜ふかしで0時をまたいでも同じ日', () => {
    expect(feedDay(local(27, 4))).toBe(feedDay(local(27, 23, 59)));
    expect(feedDay(local(27, 23))).toBe(feedDay(local(28, 1)));
    expect(feedDay(local(28, 3, 59))).toBe(feedDay(local(27, 12)));
    expect(feedDay(local(28, 4))).not.toBe(feedDay(local(28, 3, 59)));
  });
});

describe('餌をやる', () => {
  test('1瓶につき1日1回。次の日（朝4時から）はまたやれる', () => {
    const s = createInitialState(local(27, 9));
    expect(canFeed(s, 0, local(27, 9))).toBe('fed');
    expect(feedJar(s, 0, local(27, 9))).toBe('fed');
    expect(canFeed(s, 0, local(27, 21))).toBe('already');
    expect(feedJar(s, 0, local(28, 2))).toBe('already');
    expect(canFeed(s, 0, local(28, 4))).toBe('fed');
    // 確認用に記録を消せば、同じ日にまたやれる
    clearFed(s, 0);
    expect(canFeed(s, 0, local(27, 21))).toBe('fed');
  });

  test('瓶ごとに数える。食べる個体のいない瓶にはやれない（ストロビラは食べない）', () => {
    const s = createInitialState(local(27, 9));
    feedJar(s, 0, local(27, 9));
    expect(canFeed(s, 1, local(27, 9))).toBe('empty');
    spawnCreature(s, 1, 'strobila');
    expect(canFeed(s, 1, local(27, 9))).toBe('empty');
    spawnCreature(s, 1, 'polyp');
    expect(canFeed(s, 1, local(27, 9))).toBe('fed');
    expect(canFeed(s, 5, local(27, 9))).toBe('missing');
  });

  test('瓶にいる全員が食べる。量は決まった範囲で、同じ状態からは同じ結果', () => {
    const make = (): GameState => {
      const s = advance(createInitialState(local(27, 9)), 1234.5);
      for (const st of ['ephyra', 'polyp', 'strobila', 'adult'] as const) spawnCreature(s, 0, st);
      return s;
    };
    const a = make();
    const b = make();
    feedJar(a, 0, local(27, 10));
    feedJar(b, 0, local(27, 10));
    expect(a).toEqual(b);
    expect(a.jars[0]!.fedWallTime).toBe(local(27, 10));
    for (const c of a.jars[0]!.creatures) {
      if (c.stage === 'strobila') {
        expect(c.meal).toBeNull();
        continue;
      }
      // やった時刻そのもの（刻みに満たない端数も入れる）
      expect(c.meal!.at).toBe(a.time + a.pending);
      expect(c.meal!.amount).toBeGreaterThanOrEqual(FEED.amount[0]);
      expect(c.meal!.amount).toBeLessThanOrEqual(FEED.amount[1]);
    }
  });
});

describe('成長の早まり', () => {
  test('食べてから1日だけ、エフィラの育ちが 1 + 0.2 × 食べた量 倍になる', () => {
    const base = only('ephyra');
    const fed = structuredClone(base);
    feedJar(fed, 0, local(27, 9));
    const { amount } = fed.jars[0]!.creatures[0]!.meal!;
    const L = base.jars[0]!.creatures[0]!.stageLength;
    const plain = advance(base, 2 * DAY).jars[0]!.creatures[0]!.progress;
    const boosted = advance(fed, 2 * DAY).jars[0]!.creatures[0]!.progress;
    expect(plain).toBeCloseTo((2 * DAY) / L, 9);
    expect(boosted - plain).toBeCloseTo((FEED.growthBoost * amount * FEED.boostSeconds) / L, 9);
  });

  test('ポリプも、くびれ始めるまでが少し速くなる', () => {
    const base = only('polyp');
    const fed = structuredClone(base);
    feedJar(fed, 0, local(27, 9));
    const { amount } = fed.jars[0]!.creatures[0]!.meal!;
    const L = base.jars[0]!.creatures[0]!.stageLength;
    const plain = advance(base, 1.5 * DAY).jars[0]!.creatures[0]!.progress;
    const boosted = advance(fed, 1.5 * DAY).jars[0]!.creatures[0]!.progress;
    expect(boosted - plain).toBeCloseTo((FEED.growthBoost * amount * FEED.boostSeconds) / L, 9);
  });

  test('成体の「次のポリプまで」は変わらない', () => {
    const s = createInitialState(local(27, 9));
    const fed = structuredClone(s);
    feedJar(fed, 0, local(27, 9));
    const a = advance(s, 0.5 * DAY).jars[0]!.creatures[0]!;
    const b = advance(fed, 0.5 * DAY).jars[0]!.creatures[0]!;
    expect(b.progress).toBe(a.progress);
  });

  test('効くのは食べてから1日の間だけ', () => {
    const s = only('ephyra');
    const c = s.jars[0]!.creatures[0]!;
    expect(growthRate(c, 100)).toBe(1);
    c.meal = { at: 1000, amount: 0.8 };
    expect(growthRate(c, 1000)).toBe(1);
    expect(growthRate(c, 1060)).toBeCloseTo(1 + FEED.growthBoost * 0.8);
    expect(growthRate(c, 1000 + FEED.boostSeconds)).toBeCloseTo(1 + FEED.growthBoost * 0.8);
    expect(growthRate(c, 1060 + FEED.boostSeconds)).toBe(1);
    c.stage = 'strobila';
    expect(growthRate(c, 1060)).toBe(1);
  });

  test('分けて進めても同じ結果', () => {
    const s = only('ephyra');
    spawnCreature(s, 0, 'polyp');
    feedJar(s, 0, local(27, 9));
    const once = advance(s, 1.7 * DAY);
    let split = s;
    for (const d of [100.5, 3600, 0.3 * DAY, 12345, 0.9 * DAY]) split = advance(split, d);
    split = advance(split, 1.7 * DAY - (100.5 + 3600 + 0.3 * DAY + 12345 + 0.9 * DAY));
    expect(split.jars).toEqual(once.jars);
  });
});
