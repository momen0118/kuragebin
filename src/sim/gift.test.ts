import { describe, expect, test } from 'vitest';
import { LIFE, UNCLE } from '../config';
import { journalPages } from '../ui/journal/pages';
import { letterLines } from '../ui/letters';
import { advance } from './advance';
import { fillAdults, spawnCreature } from './edit';
import { createInitialState, type GameState } from './state';
import { giftJar, sendCreature } from './uncle';

const T0 = new Date(2026, 9, 23, 10).getTime();
const DAY = 86400;
const AFTER = UNCLE.giftAfter.bolinopsis;

const kabuto = (s: GameState) => s.jars.flatMap((j, i) => j.creatures.filter((c) => c.species === 'bolinopsis').map((c) => ({ jar: i, c })));

describe('新しい種（カブトクラゲ）が届く', () => {
  test('始めて7日目に、何もいない瓶（2番）へ手紙に添えて一匹届く。1代目の成体で雌雄はない。届くのは一度だけ', () => {
    const before = advance(createInitialState(T0), AFTER - 3600);
    expect(kabuto(before)).toHaveLength(0);
    const s = advance(before, 2 * 3600);
    const got = kabuto(s);
    expect(got).toHaveLength(1);
    expect(got[0]!.jar).toBe(1);
    const c = got[0]!.c;
    expect(c.stage).toBe('adult');
    expect(c.generation).toBe(1);
    expect(c.sex).toBeNull();
    expect(c.parent).toBeNull();
    // 手紙は封筒のまま天板に。日誌は2番の瓶の行に一行。種のページに初めて来た日
    const letter = s.letters.find((l) => l.kind === 'gift')!;
    expect(letter.sealed).toBe(true);
    expect(letter.gift?.id).toBe(c.id);
    expect(letterLines(letter)[0]).toContain('カブトクラゲ');
    const page = journalPages(s.journal)[0]!;
    expect(page.sections.find((x) => x.jar === 1)!.lines.join()).toContain('おじさんの手紙に添えて、カブトクラゲが一匹届いた');
    expect(s.book.species.some((r) => r.species === 'bolinopsis')).toBe(true);
    // ずっと先まで進めても、もう届かない
    const later = advance(s, 30 * DAY);
    expect(later.letters.filter((l) => l.kind === 'gift')).toHaveLength(1);
    expect(later.uncle.given).toEqual(['bolinopsis']);
  });

  test('入る瓶：何もいない瓶が最優先（1→2→3）、なければ空きのある瓶（1→2→3）', () => {
    const s = createInitialState(T0);
    expect(giftJar(s)).toBe(1);
    spawnCreature(s, 1, 'adult');
    expect(giftJar(s)).toBe(2);
    spawnCreature(s, 2, 'polyp');
    // どれにも何かいる：1番の瓶に空きがあればそこ
    expect(giftJar(s)).toBe(0);
    fillAdults(s, 0, LIFE.maxSwimmers);
    expect(giftJar(s)).toBe(1);
  });

  test('どの瓶もいっぱいなら、空きを訊く手紙を一通だけ出し、空いたら届く（手紙の書き出しが変わる）', () => {
    let s = createInitialState(T0);
    for (let j = 0; j < 3; j++) fillAdults(s, j, LIFE.maxSwimmers);
    s = advance(s, AFTER + 2 * DAY);
    expect(kabuto(s)).toHaveLength(0);
    const asks = s.letters.filter((l) => l.kind === 'ask');
    expect(asks).toHaveLength(1);
    expect(asks[0]!.sealed).toBe(false);
    s = advance(s, 3 * DAY);
    expect(s.letters.filter((l) => l.kind === 'ask')).toHaveLength(1);
    // 3番の瓶から一匹送って空ける
    const one = s.jars[2]!.creatures.find((c) => c.stage === 'adult')!;
    sendCreature(s, one.id);
    s = advance(s, 600);
    const got = kabuto(s);
    expect(got).toHaveLength(1);
    expect(got[0]!.jar).toBe(2);
    const letter = s.letters.find((l) => l.kind === 'gift')!;
    expect(letter.pick).toBe(1);
    expect(letterLines(letter)[0]).toContain('空いた頃');
  });

  test('入る瓶を見ている間は届かず、見ていないときに届く', () => {
    let s = advance(createInitialState(T0), AFTER + DAY, LIFE, 1);
    expect(kabuto(s)).toHaveLength(0);
    s = advance(s, 600, LIFE, 0);
    expect(kabuto(s)).toHaveLength(1);
  });
});

describe('何代目か', () => {
  test('最初の一匹は1代目。プラヌラから付いたポリプは親の代＋1、ポリプから出たエフィラはそのポリプと同じ代', () => {
    const s = advance(createInitialState(T0), 9 * DAY);
    const all = s.jars.flatMap((j) => j.creatures).filter((c) => c.species === 'aurelia');
    const byId = new Map(all.map((c) => [c.id, c]));
    expect(byId.get(1)!.generation).toBe(1);
    const polyps = all.filter((c) => c.stage === 'polyp' || c.stage === 'strobila');
    const ephyrae = all.filter((c) => c.stage === 'ephyra' || (c.stage === 'adult' && c.parent !== null));
    expect(polyps.length).toBeGreaterThan(0);
    expect(ephyrae.length).toBeGreaterThan(0);
    for (const p of polyps) {
      const mother = p.parent !== null ? byId.get(p.parent) : undefined;
      if (mother) expect(p.generation).toBe(mother.generation + 1);
    }
    for (const e of ephyrae) {
      const polyp = e.parent !== null ? byId.get(e.parent) : undefined;
      if (polyp) expect(e.generation).toBe(polyp.generation);
    }
  });
});
