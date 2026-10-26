import { describe, expect, test } from 'vitest';
import { LIFE, SEX, UNCLE } from '../config';
import { migrate } from '../storage/schema';
import { letterLines } from '../ui/letters';
import { rosterPages } from '../ui/journal/pages';
import { FACT_TEXT } from '../ui/journal/facts';
import { advance } from './advance';
import { BOLINOPSIS_FACT_KEYS, checkFacts, factSpecies, hasFact, noteFact, openAllFacts } from './book';
import { BASE_BOLINOPSIS_GENES } from './genes';
import { spawnCreature } from './edit';
import { createInitialState, type GameState } from './state';
import { deliverGiftNow, topicOf } from './uncle';

const T0 = new Date(2026, 9, 26, 10).getTime();
const DAY = 86400;

const kabutoKeys = (s: GameState): string[] => s.book.species.find((r) => r.species === 'bolinopsis')?.facts.map((f) => f.key) ?? [];
const aureliaKeys = (s: GameState): string[] => s.book.species.find((r) => r.species === 'aurelia')!.facts.map((f) => f.key);

describe('カブトクラゲの豆知識', () => {
  test('届く前は何もない。届くと「刺さない」の行がカブトクラゲのページに付く', () => {
    const s = createInitialState(T0);
    checkFacts(s, T0);
    expect(kabutoKeys(s)).toEqual([]);
    deliverGiftNow(s, 'bolinopsis');
    checkFacts(s, T0 + 1000);
    expect(kabutoKeys(s)).toEqual(['bArrive']);
    expect(aureliaKeys(s)).not.toContain('bArrive');
  });

  test('卵を産む → 孵る → 幼生が成体になる → 三代目、の順に増える（見ていた瓶の出来事でも）', () => {
    let s = createInitialState(T0);
    deliverGiftNow(s, 'bolinopsis');
    const jar = s.jars.findIndex((j) => j.creatures.some((c) => c.species === 'bolinopsis'));
    // 見ている瓶として進める（日誌に書かれなくても、個体から分かる）
    s = advance(s, LIFE.lay[1] + 3600, LIFE, jar);
    checkFacts(s, T0 + 1);
    expect(kabutoKeys(s)).toContain('bEggs');
    expect(kabutoKeys(s)).not.toContain('bHatch');
    s = advance(s, LIFE.eggHatch[1] + 120, LIFE, jar);
    checkFacts(s, T0 + 2);
    expect(kabutoKeys(s)).toContain('bHatch');
    expect(kabutoKeys(s)).not.toContain('bAdult');
    s = advance(s, LIFE.larva[1] + 3600, LIFE, jar);
    checkFacts(s, T0 + 3);
    expect(kabutoKeys(s)).toContain('bAdult');
    expect(kabutoKeys(s)).not.toContain('bThird');
    // 三代目
    const k = s.jars[jar]!.creatures.find((c) => c.species === 'bolinopsis')!;
    k.generation = 3;
    checkFacts(s, T0 + 4);
    expect(kabutoKeys(s)).toContain('bThird');
  });

  test('瓶で生まれた子が育ちきった・崩しの大きい子・餌（カブトクラゲのいる瓶に1回・5回）', () => {
    const s = createInitialState(T0);
    deliverGiftNow(s, 'bolinopsis');
    const k = s.jars.flatMap((j) => j.creatures).find((c) => c.species === 'bolinopsis')!;
    // 届いた子は育ちきっているが、それでは出ない
    expect(k.adultGrowth).toBe(1);
    s.book.counts.bolinopsisFeeds = 1;
    checkFacts(s, T0);
    expect(kabutoKeys(s)).toEqual(['bArrive', 'bFeed1']);
    const child = spawnCreature(s, 1, 'adult', LIFE, 'bolinopsis');
    child.parent = k.id;
    child.adultGrowth = 0.5;
    checkFacts(s, T0);
    expect(kabutoKeys(s)).not.toContain('bGrown');
    child.adultGrowth = 1;
    checkFacts(s, T0);
    expect(kabutoKeys(s)).toContain('bGrown');
    expect(kabutoKeys(s)).not.toContain('bFeed5');
    expect(kabutoKeys(s)).not.toContain('bFlawed');
    if (k.species === 'bolinopsis') k.genes = { ...BASE_BOLINOPSIS_GENES, warp: 1, lobeSkew: 1, rowJitter: 1 };
    s.book.counts.bolinopsisFeeds = 5;
    checkFacts(s, T0 + 1);
    expect(kabutoKeys(s)).toEqual(expect.arrayContaining(['bFeed5', 'bFlawed']));
  });

  test('画面の出来事のきっかけは、その種のページに付く。文面は15行そろっている', () => {
    const s = createInitialState(T0);
    deliverGiftNow(s, 'bolinopsis');
    expect(noteFact(s, 'bLamp', T0)).toBe(true);
    expect(hasFact(s, 'bLamp')).toBe(true);
    expect(kabutoKeys(s)).toContain('bLamp');
    expect(aureliaKeys(s)).not.toContain('bLamp');
    expect(BOLINOPSIS_FACT_KEYS).toHaveLength(15);
    for (const key of BOLINOPSIS_FACT_KEYS) {
      expect(factSpecies(key)).toBe('bolinopsis');
      expect(FACT_TEXT[key].length).toBeGreaterThan(5);
    }
    expect(factSpecies('poke')).toBe('aurelia');
  });

  test('確認用に全部開くのは、種のページがある種だけ', () => {
    const s = createInitialState(T0);
    openAllFacts(s, T0);
    expect(s.book.species.map((r) => r.species)).toEqual(['aurelia']);
    deliverGiftNow(s, 'bolinopsis');
    openAllFacts(s, T0);
    expect(kabutoKeys(s)).toHaveLength(15);
  });

  test('カブトクラゲのいる瓶に餌をやった回数は、保存に残る（前のデータは 0）', () => {
    const s = createInitialState(T0);
    s.book.counts.bolinopsisFeeds = 4;
    expect(migrate(JSON.parse(JSON.stringify(s))).book.counts.bolinopsisFeeds).toBe(4);
    const old = JSON.parse(JSON.stringify(s));
    delete old.book.counts.bolinopsisFeeds;
    expect(migrate(old).book.counts.bolinopsisFeeds).toBe(0);
  });
});

describe('カブトクラゲの返事', () => {
  const kabuto = (stage: 'adult' | 'larva', generation: number, flaw = 0) => ({
    species: 'bolinopsis' as const,
    genes: { ...BASE_BOLINOPSIS_GENES, warp: flaw, lobeSkew: flaw, rowJitter: flaw },
    stage,
    generation,
  });

  test('代を重ねた子（三代目以上）→ 幼生 → 崩しの大きい子 → ほか', () => {
    expect(topicOf(kabuto('adult', UNCLE.generationTopic))).toBe('bGeneration');
    expect(topicOf(kabuto('larva', UNCLE.generationTopic))).toBe('bGeneration');
    expect(topicOf(kabuto('larva', 2))).toBe('bLarva');
    expect(topicOf(kabuto('adult', 2, 1))).toBe('bFlawed');
    expect(topicOf(kabuto('adult', 1))).toBe('bPlain');
  });

  test('代の数は漢数字で文面に入る', () => {
    const l = { kind: 'reply' as const, topic: 'bGeneration' as const, pick: 0, gift: null };
    expect(letterLines(l, 3).join('')).toBe('瓶の中で三代目の子が届きました。こちらでは、なかなかそこまで続きません。');
    expect(letterLines({ ...l, pick: 2 }, 12)[0]).toBe('送ってくれた十二代目、元気です。');
  });
});

describe('一覧の代', () => {
  test('二代目からは代を書く（一代目は書かない）。送った子も。カブトクラゲは雌雄を書かない', () => {
    const s = createInitialState(T0);
    const a = spawnCreature(s, 0, 'adult');
    a.generation = 2;
    const k = spawnCreature(s, 1, 'adult', LIFE, 'bolinopsis');
    k.adultAge = SEX.matureAfter;
    const rows = rosterPages(s).flatMap((p) => p.rows);
    expect(rows.find((r) => r.id === 1)!.generation).toBeNull();
    expect(rows.find((r) => r.id === a.id)!.generation).toBe('二代目');
    expect(rows.find((r) => r.id === k.id)!.sex).toBeNull();
    s.sent.push({ id: 99, name: null, species: 'aurelia', stage: 'adult', genes: { ...a.genes } as never, generation: 4, sex: null, jar: 0, sentAt: 0, sentWallTime: T0 + DAY });
    expect(rosterPages(s).at(-1)!.rows[0]!.generation).toBe('四代目');
  });
});
