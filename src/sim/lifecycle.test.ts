import { describe, expect, test } from 'vitest';
import { JOURNAL, LIFE, type LifeRules } from '../config';
import { advance, catchUp } from './advance';
import { fillAdults, spawnCreature } from './edit';
import { freeSwimmerSlots, jarCounts, record } from './lifecycle';
import { createInitialState, isSwimmer, type GameState } from './state';

const T0 = Date.UTC(2026, 8, 25, 3, 0, 0);
const DAY = 86400;

/** hours 時間ずつ days 日進めて、途中の状態をすべて返す */
function run(state: GameState, days: number, rules: LifeRules = LIFE, hours = 6): GameState[] {
  const out: GameState[] = [];
  let s = state;
  for (let t = 0; t < days * 24; t += hours) {
    s = advance(s, hours * 3600, rules);
    out.push(s);
  }
  return out;
}

describe('生活環', () => {
  test('成体がいると、約1日で瓶底にポリプが付く', () => {
    const s = createInitialState(T0);
    expect(jarCounts(advance(s, 0.75 * DAY).jars[0]!).polyps).toBe(0);
    const n = advance(s, 1.25 * DAY);
    const polyps = n.jars[0]!.creatures.filter((c) => c.stage === 'polyp');
    expect(polyps).toHaveLength(1);
    const p = polyps[0]!;
    expect(p.parent).toBe(1);
    expect(p.spot).not.toBeNull();
    expect(Math.abs(p.spot![0])).toBeLessThanOrEqual(LIFE.spotMaxX);
    expect(Math.hypot(...p.spot!)).toBeLessThanOrEqual(LIFE.spotRadius + 1e-9);
    expect(n.journal.map((e) => e.kind)).toEqual(['polyp']);
  });

  test('ポリプ → ストロビラ → エフィラ → 成体と進み、ストロビラはポリプに戻る', () => {
    const states = run(createInitialState(T0), 16);
    const kinds = new Set(states.at(-1)!.journal.map((e) => e.kind));
    for (const k of ['polyp', 'strobila', 'release', 'adult'] as const) expect(kinds.has(k)).toBe(true);
    // 最初のポリプは、エフィラを放したあともポリプとして残っている
    const first = states.at(-1)!.journal.find((e) => e.kind === 'polyp')!.ids[0]!;
    const released = states.at(-1)!.journal.filter((e) => e.kind === 'release');
    const fromFirst = states.at(-1)!.jars[0]!.creatures.filter((c) => c.parent === first && c.stage !== 'polyp');
    expect(released.length).toBeGreaterThan(0);
    expect(fromFirst.length).toBeGreaterThan(0);
    const survivor = states.at(-1)!.jars[0]!.creatures.find((c) => c.id === first)!;
    expect(['polyp', 'strobila']).toContain(survivor.stage);
    // 放すのは1〜3匹
    for (const e of released) {
      expect(e.count).toBeGreaterThanOrEqual(LIFE.ephyraCount[0]);
      expect(e.count).toBeLessThanOrEqual(LIFE.ephyraCount[1]);
    }
  });

  test('上限を越えない。泳ぐ個体が上限になるとポリプは休み、日誌に書く', () => {
    for (const max of [4, 6]) {
      const rules = { ...LIFE, maxSwimmers: max };
      const states = run(createInitialState(T0, 7), 30, rules);
      for (const s of states) {
        for (const jar of s.jars) {
          const c = jarCounts(jar);
          expect(c.swimmers + c.pending).toBeLessThanOrEqual(max);
          expect(c.polyps).toBeLessThanOrEqual(LIFE.maxPolyps);
        }
      }
      const last = states.at(-1)!;
      expect(jarCounts(last.jars[0]!).swimmers).toBe(max);
      expect(last.jars[0]!.resting).toBe(true);
      expect(last.journal.some((e) => e.kind === 'rest')).toBe(true);
      // 休んでいる間は進まない
      const waiting = last.jars[0]!.creatures.filter((c) => c.stage === 'polyp');
      const later = advance(last, 3 * DAY, rules);
      for (const p of waiting) {
        const q = later.jars[0]!.creatures.find((c) => c.id === p.id)!;
        expect(q.stage).toBe('polyp');
        expect(q.progress).toBe(p.progress);
      }
    }
  });

  test('空きができると休みが明け、また進む', () => {
    const rules = { ...LIFE, maxSwimmers: 4 };
    let s = run(createInitialState(T0, 7), 30, rules).at(-1)!;
    expect(s.jars[0]!.resting).toBe(true);
    // 泳ぐ個体を2匹、隣の瓶へ移す（3-2 の操作と同じこと）
    s = structuredClone(s);
    const moved = s.jars[0]!.creatures.filter((c) => isSwimmer(c.stage)).slice(0, 2);
    s.jars[0]!.creatures = s.jars[0]!.creatures.filter((c) => !moved.includes(c));
    s.jars[1]!.creatures.push(...moved);
    s = advance(s, 60, rules);
    expect(s.jars[0]!.resting).toBe(false);
    expect(s.journal.some((e) => e.kind === 'wake' && e.jar === 0 && e.time === s.time)).toBe(true);
    const after = advance(s, 4 * DAY, rules);
    expect(after.journal.some((e) => e.kind === 'strobila' && e.time > s.time)).toBe(true);
  });

  test('くびれ始めるときに、放す数は空きの分までに減らす', () => {
    const rules = { ...LIFE, maxSwimmers: 3, ephyraCount: [3, 3] as const };
    let s = createInitialState(T0);
    s = structuredClone(s);
    fillAdults(s, 0, 2, rules);
    const p = spawnCreature(s, 0, 'polyp', rules);
    s.jars[0]!.creatures.find((c) => c.id === p.id)!.progress = 0.999;
    s = advance(s, 3600, rules);
    const strobila = s.jars[0]!.creatures.find((c) => c.id === p.id)!;
    expect(strobila.stage).toBe('strobila');
    expect(strobila.discs).toBe(1);
    expect(freeSwimmerSlots(s.jars[0]!, rules)).toBe(0);
  });

  test('何回に分けて進めても、同じ状態と経過からは同じ結果', () => {
    const s = createInitialState(T0, 42);
    const once = advance(s, 12 * DAY + 1234);
    let split = s;
    for (const d of [3600.5, 4 * DAY, 0.3 * DAY, 90, 6 * DAY]) split = advance(split, d);
    split = advance(split, 12 * DAY + 1234 - (3600.5 + 4 * DAY + 0.3 * DAY + 90 + 6 * DAY));
    expect(split.jars).toEqual(once.jars);
    expect(split.journal.map((e) => [e.kind, e.time, e.count])).toEqual(once.journal.map((e) => [e.kind, e.time, e.count]));
    expect(split.nextId).toBe(once.nextId);
    expect(split.rng).toBe(once.rng);
  });

  test('出来事の端末の時刻は、その出来事の時点に合う', () => {
    const s = createInitialState(T0);
    const r = catchUp(s, T0 + 3 * DAY * 1000);
    for (const e of r.state.journal) expect(e.wallTime).toBeCloseTo(T0 + e.time * 1000, 3);
    // 30日を越えて離れていたときは、今から30日さかのぼった所から進めたことにする
    const far = T0 + 100 * DAY * 1000;
    const r2 = catchUp(s, far);
    const last = r2.state.journal.at(-1)!;
    expect(last.wallTime).toBeLessThanOrEqual(far);
    expect(last.wallTime).toBeGreaterThan(far - 30 * DAY * 1000);
  });

  test('日誌は多すぎると古いものから消える', () => {
    const s = createInitialState(T0);
    for (let i = 0; i < JOURNAL.maxEntries + 50; i++) {
      s.time = i;
      record(s, 'polyp', 0, 1, [i], T0 + i);
    }
    expect(s.journal).toHaveLength(JOURNAL.maxEntries);
    expect(s.journal[0]!.time).toBe(50);
  });
});
