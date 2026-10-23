import { describe, expect, test } from 'vitest';
import { ADULT_GROWTH, CTENO, LIFE, SEX } from '../config';
import { journalPages } from '../ui/journal/pages';
import { advance } from './advance';
import { hatchNow, layEggsNow, removeCreature, setStage, spawnCreature } from './edit';
import { freeSwimmerSlots } from './lifecycle';
import { bodySize } from './size';
import { createInitialState, type BolinopsisCreature, type GameState } from './state';
import { isLastOfSpecies } from './uncle';

const T0 = new Date(2026, 9, 23, 10).getTime();
const DAY = 86400;

/** 2番の瓶に、成熟したカブトクラゲの成体を一匹（届くのは済んだことにする） */
function withKabuto(): { s: GameState; id: number } {
  const s = createInitialState(T0);
  s.uncle.given.push('bolinopsis');
  const c = spawnCreature(s, 1, 'adult', LIFE, 'bolinopsis');
  c.adultAge = SEX.matureAfter;
  return { s, id: c.id };
}

const larvae = (s: GameState, jar = 1) => s.jars[jar]!.creatures.filter((c) => c.stage === 'larva');
const lines = (s: GameState, jar = 1) => journalPages(s.journal).flatMap((p) => p.sections.filter((x) => x.jar === jar).flatMap((x) => x.lines));

describe('カブトクラゲの卵と幼生', () => {
  test('成熟した成体は3〜4日で卵を産む。孵る数（1〜3）を上限に数え、見せる粒は15〜25。日誌に一行', () => {
    const { s: s0, id } = withKabuto();
    const before = advance(s0, LIFE.lay[0] - 3600);
    expect(before.jars[1]!.eggs).toHaveLength(0);
    const s = advance(before, LIFE.lay[1] - LIFE.lay[0] + 7200);
    const eggs = s.jars[1]!.eggs;
    expect(eggs).toHaveLength(1);
    const e = eggs[0]!;
    expect(e.parent).toBe(id);
    expect(e.count).toBeGreaterThanOrEqual(LIFE.hatchCount[0]);
    expect(e.count).toBeLessThanOrEqual(LIFE.hatchCount[1]);
    expect(e.shown).toBeGreaterThanOrEqual(CTENO.eggs.shown[0]);
    expect(e.shown).toBeLessThanOrEqual(CTENO.eggs.shown[1]);
    expect(e.generation).toBe(2);
    expect(e.hatchAt - e.laidAt).toBeGreaterThanOrEqual(LIFE.eggHatch[0]);
    expect(e.hatchAt - e.laidAt).toBeLessThanOrEqual(LIFE.eggHatch[1]);
    // 孵る予定の数は上限に数える
    expect(freeSwimmerSlots(s.jars[1]!)).toBe(LIFE.maxSwimmers - 1 - e.count);
    expect(lines(s).some((l) => l.endsWith('カブトクラゲが卵を産んだ'))).toBe(true);
  });

  test('卵は半日ほどで孵り、幼生が孵る数だけ出る。親の遺伝子を受け継ぎ、代は親の代＋1、雌雄はない。日誌に一行', () => {
    const { s: s0, id } = withKabuto();
    const laid = advance(s0, LIFE.lay[1] + 3600);
    const e = laid.jars[1]!.eggs[0]!;
    const s = advance(laid, e.hatchAt - laid.time + 120);
    expect(s.jars[1]!.eggs).toHaveLength(0);
    const ls = larvae(s);
    expect(ls).toHaveLength(e.count);
    for (const l of ls) {
      expect(l.species).toBe('bolinopsis');
      expect(l.parent).toBe(id);
      expect(l.generation).toBe(2);
      expect(l.sex).toBeNull();
      expect(l.spot).toBeNull();
    }
    expect(lines(s).some((l) => l.endsWith(`卵から幼生が${['', '一', '二', '三'][e.count]}匹孵った`))).toBe(true);
  });

  test('幼生は5〜7日で成体になる。日誌は「幼生が成体になった」', () => {
    const { s: s0 } = withKabuto();
    const laid = advance(s0, LIFE.lay[1] + 3600);
    const hatched = advance(laid, LIFE.eggHatch[1] + 120);
    const first = larvae(hatched)[0]!;
    const s = advance(hatched, LIFE.larva[1] + 3600);
    const grown = s.jars[1]!.creatures.find((c) => c.id === first.id)!;
    expect(grown.stage).toBe('adult');
    expect(grown.generation).toBe(2);
    expect(grown.adultAge).toBeLessThan(LIFE.larva[1]);
    expect(lines(s).some((l) => l.endsWith('幼生が成体になった') || /幼生が.匹、成体になった$/.test(l))).toBe(true);
  });

  test('瓶がいっぱいなら卵を産まずに待ち（日誌に書かない）、空いたら産む。空きが少なければ孵る数も空きまで', () => {
    const { s: s0, id } = withKabuto();
    const others = [0, 1, 2, 3].map(() => spawnCreature(s0, 1, 'adult').id);
    const full = advance(s0, 8 * DAY);
    expect(full.jars[1]!.eggs).toHaveLength(0);
    expect(full.journal.some((e) => e.kind === 'eggs')).toBe(false);
    expect(full.jars[1]!.creatures.find((c) => c.id === id)!.progress).toBe(1);
    // 一匹空ける：空きは一つなので、孵るのは一匹
    removeCreature(full, others[0]!);
    const s = advance(full, 3600);
    expect(s.jars[1]!.eggs).toHaveLength(1);
    expect(s.jars[1]!.eggs[0]!.count).toBe(1);
    expect(freeSwimmerSlots(s.jars[1]!)).toBe(0);
  });

  test('見ている瓶の出来事は日誌に書かない', () => {
    const { s: s0 } = withKabuto();
    const s = advance(s0, LIFE.lay[1] + LIFE.eggHatch[1] + 7200, LIFE, 1);
    expect(larvae(s).length).toBeGreaterThan(0);
    expect(s.journal.some((e) => e.kind === 'eggs' || e.kind === 'hatch')).toBe(false);
  });

  test('同じ状態と経過からは同じ結果', () => {
    const { s } = withKabuto();
    const a = advance(s, 12 * DAY);
    const b = advance(s, 12 * DAY);
    expect(a.jars[1]).toEqual(b.jars[1]);
  });

  test('孵るのを待つ卵があれば、成体は最後の一匹ではない', () => {
    const { s: s0, id } = withKabuto();
    expect(isLastOfSpecies(s0, s0.jars[1]!.creatures.find((c) => c.id === id)!)).toBe(true);
    const s = advance(s0, LIFE.lay[1] + 3600);
    expect(s.jars[1]!.eggs).toHaveLength(1);
    expect(isLastOfSpecies(s, s.jars[1]!.creatures.find((c) => c.id === id)!)).toBe(false);
  });

  test('幼生は小さな粒から、成体になった直後の大きさへ育つ', () => {
    const { s } = withKabuto();
    const l = spawnCreature(s, 1, 'larva', LIFE, 'bolinopsis');
    expect(bodySize({ ...l, progress: 0 })).toBeCloseTo(CTENO.larva.start);
    expect(bodySize({ ...l, progress: 1 })).toBeCloseTo(l.fullSize * ADULT_GROWTH.start);
    expect(bodySize({ ...l, progress: 0.5 })).toBeLessThan(bodySize({ ...l, progress: 0.6 }));
  });
});

describe('確認用の書き換え（カブトクラゲ）', () => {
  test('幼生を出せる。その種にない段階は成体で出し、段階もその種にないものには変えない', () => {
    const s = createInitialState(T0);
    expect(spawnCreature(s, 1, 'larva', LIFE, 'bolinopsis').stage).toBe('larva');
    const k = spawnCreature(s, 1, 'polyp', LIFE, 'bolinopsis');
    expect(k.stage).toBe('adult');
    setStage(s, k.id, 'strobila');
    expect(k.stage).toBe('adult');
    setStage(s, k.id, 'larva');
    expect(k.stage).toBe('larva');
    const a = spawnCreature(s, 0, 'larva');
    expect(a.stage).toBe('adult');
    setStage(s, a.id, 'larva');
    expect(a.stage).toBe('adult');
  });

  test('今すぐ卵を産ませる（孵る数はいちばん多いとき）、今すぐ孵す（上限は見ない）', () => {
    const s = createInitialState(T0);
    const k = spawnCreature(s, 1, 'adult', LIFE, 'bolinopsis') as BolinopsisCreature;
    layEggsNow(s, k.id);
    expect(s.jars[1]!.eggs).toHaveLength(1);
    expect(s.jars[1]!.eggs[0]!.count).toBe(LIFE.hatchCount[1]);
    expect(k.adultAge).toBeGreaterThanOrEqual(SEX.matureAfter);
    hatchNow(s, 1);
    expect(s.jars[1]!.eggs).toHaveLength(0);
    expect(larvae(s)).toHaveLength(LIFE.hatchCount[1]);
    expect(s.journal.some((e) => e.kind === 'eggs' || e.kind === 'hatch')).toBe(false);
  });
});
