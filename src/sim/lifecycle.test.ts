import { describe, expect, test } from 'vitest';
import { LIFE, SEX, type LifeRules } from '../config';
import { advance, catchUp } from './advance';
import { fillAdults, spawnCreature } from './edit';
import { record } from './journal';
import { freeSwimmerSlots, jarCounts } from './lifecycle';
import { isMature } from './sex';
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
  test('成体がいると、約1日で瓶底にポリプが付く（メスのいない瓶）', () => {
    const s = createInitialState(T0);
    // 最初の一匹をオスにして、プラヌラを抱えていないことにする
    const first = s.jars[0]!.creatures[0]!;
    first.sex = 'male';
    first.brood = null;
    first.stageLength = DAY;
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

  test('最初の一匹は成熟したメスで、プラヌラを抱えている。粒がなくなってしばらくすると、最初のポリプが付く', () => {
    const s = createInitialState(T0);
    const first = s.jars[0]!.creatures[0]!;
    expect(first.sex).toBe('female');
    expect(isMature(first)).toBe(true);
    const until = first.brood!.until;
    expect(until).toBeGreaterThanOrEqual(SEX.brood[0]);
    expect(until).toBeLessThanOrEqual(SEX.brood[1]);
    // 抱えている間は、瓶底の数に入っている（まだ付いていない）
    const holding = advance(s, until - 120);
    expect(holding.jars[0]!.creatures[0]!.brood).not.toBeNull();
    expect(holding.jars[0]!.creatures.some((c) => c.stage === 'polyp')).toBe(false);
    expect(jarCounts(holding.jars[0]!).polyps).toBe(1);
    // 粒がなくなると、付くのを待つ
    const released = advance(s, until + 120);
    expect(released.jars[0]!.creatures[0]!.brood).toBeNull();
    expect(released.jars[0]!.planulae).toHaveLength(1);
    // しばらくして付く（自分の「次のポリプまで」はそのあと）
    const n = advance(s, until + SEX.settle[1] + 120);
    const polyps = n.jars[0]!.creatures.filter((c) => c.stage === 'polyp');
    expect(polyps).toHaveLength(1);
    expect(polyps[0]!.parent).toBe(1);
    expect(n.jars[0]!.planulae).toHaveLength(0);
    // 最初から抱えていたので、日誌には「抱えていた」は書かない。ポリプが付いたことだけ
    expect(n.journal.map((e) => e.kind)).toEqual(['polyp']);
  });

  test('ポリプが付くとき、成熟したメスがいれば先にそのメスがプラヌラを抱え、日誌に名前で書く', () => {
    const s = createInitialState(T0);
    const female = s.jars[0]!.creatures[0]!;
    female.brood = null;
    female.name = 'ぽこ';
    female.stageLength = 10 * DAY;
    // オスの成体を足す（こちらが先にポリプを付けることになる）
    fillAdults(s, 0, 2);
    const male = s.jars[0]!.creatures.find((c) => c.id !== 1)!;
    male.sex = 'male';
    male.stageLength = DAY;
    male.progress = 0;
    const n = advance(s, 1.1 * DAY);
    const f = n.jars[0]!.creatures.find((c) => c.id === 1)!;
    expect(f.brood).not.toBeNull();
    expect(n.jars[0]!.creatures.some((c) => c.stage === 'polyp')).toBe(false);
    const e = n.journal.find((x) => x.kind === 'planula')!;
    expect(e.ids).toEqual([1]);
    expect(e.name).toBe('ぽこ');
    // 粒がなくなってしばらくすると付く（親は抱えていたメス）
    // （抱えている間にオスの次の番が来たら、そちらは今まで通りそのまま付く）
    const later = advance(n, SEX.brood[1] + SEX.settle[1]);
    expect(later.jars[0]!.creatures.some((c) => c.stage === 'polyp' && c.parent === 1)).toBe(true);
  });

  test('成熟前のメスと、瓶がいっぱいで休んでいる間は抱えない（今まで通りそのまま付く）', () => {
    for (const kind of ['young', 'resting'] as const) {
      const s = createInitialState(T0);
      const c = s.jars[0]!.creatures[0]!;
      c.brood = null;
      c.stageLength = DAY;
      // 休ませるには、泳ぐ個体の上限を1にして、くびれを待つポリプを置く
      const rules = kind === 'resting' ? { ...LIFE, maxSwimmers: 1 } : LIFE;
      if (kind === 'young') c.adultAge = 0;
      else spawnCreature(s, 0, 'polyp', rules);
      const n = advance(s, 1.1 * DAY, rules);
      if (kind === 'resting') expect(n.jars[0]!.resting).toBe(true);
      expect(n.jars[0]!.creatures.filter((x) => x.stage === 'polyp')).toHaveLength(kind === 'resting' ? 2 : 1);
      expect(n.jars[0]!.creatures[0]!.brood).toBeNull();
      expect(n.journal.some((e) => e.kind === 'planula')).toBe(false);
    }
  });

  test('成体・エフィラは生まれたときに雌雄が決まり、成体になってしばらくすると成熟する。ポリプは雌雄を持たない', () => {
    const states = run(createInitialState(T0), 20);
    const all = states.flatMap((st) => st.jars.flatMap((j) => j.creatures));
    for (const c of all) {
      // 7日目に届くカブトクラゲは雌雄同体なので持たない
      if (c.species !== 'aurelia') expect(c.sex).toBeNull();
      else if (isSwimmer(c.stage)) expect(['male', 'female']).toContain(c.sex);
      else expect(c.sex).toBeNull();
      if (c.stage !== 'adult') expect(c.adultAge).toBe(0);
    }
    const last = states.at(-1)!;
    const grown = last.jars[0]!.creatures.filter((c) => c.stage === 'adult' && c.parent !== null);
    expect(grown.length).toBeGreaterThan(0);
    for (const c of grown) expect(c.adultAge).toBeLessThan(20 * DAY);
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

  test('日誌の記録は消さずに全部残す', () => {
    const s = createInitialState(T0);
    for (let i = 0; i < 2000; i++) {
      s.time = i;
      record(s, 'polyp', 0, 1, [i], T0 + i);
    }
    expect(s.journal).toHaveLength(2000);
    expect(s.journal[0]!.time).toBe(0);
  });

  test('見ている瓶の出来事は日誌に書かない（ほかの瓶の出来事は書く）', () => {
    const make = (): ReturnType<typeof createInitialState> => {
      const s = createInitialState(T0, 3);
      // 瓶2にも成体を入れて、どちらの瓶でもポリプが付くようにする
      fillAdults(s, 1, 1);
      return s;
    };
    const closed = advance(make(), 2 * DAY);
    const watched = advance(make(), 2 * DAY, LIFE, 0);
    // 状態の進み方は同じ（書くかどうかだけが違う）
    expect(watched.jars).toEqual(closed.jars);
    expect(closed.journal.some((e) => e.jar === 0)).toBe(true);
    expect(watched.journal.some((e) => e.jar === 0)).toBe(false);
    expect(watched.journal.filter((e) => e.jar === 1)).toEqual(closed.journal.filter((e) => e.jar === 1));
  });

  test('名前のある個体の出来事には、その名前を残す', () => {
    const s = createInitialState(T0);
    s.jars[0]!.creatures = [];
    const e = spawnCreature(s, 0, 'ephyra');
    e.name = 'ゆら';
    e.progress = 0.9999;
    const n = advance(s, 3600);
    const entry = n.journal.find((x) => x.kind === 'adult')!;
    expect(entry.name).toBe('ゆら');
    expect(entry.ids).toEqual([e.id]);
  });
});
