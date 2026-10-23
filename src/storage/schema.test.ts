import { describe, expect, test } from 'vitest';
import { ADULT_GROWTH, LIFE, SEX } from '../config';
import { layEggsNow, spawnCreature } from '../sim/edit';
import { bodySize } from '../sim/size';
import { advance } from '../sim/advance';
import { BASE_GENES } from '../sim/genes';
import { createInitialState, SCHEMA_VERSION, type GameState } from '../sim/state';
import { exportState, importState } from './io';
import { migrate, SchemaError } from './schema';

const T0 = Date.UTC(2026, 8, 25, 3, 0, 0);

/** 版10（雌雄とプラヌラ）と版11（成体になってからの成長）で足したものを除く。古いデータからは決め直すので、それより前の版の比べ方ではここを見ない */
function withoutSex(state: GameState): GameState {
  const s = structuredClone(state) as unknown as { jars: Array<Record<string, unknown> & { creatures: Array<Record<string, unknown>> }>; sent: Array<Record<string, unknown>> };
  for (const jar of s.jars) {
    delete jar.planulae;
    for (const c of jar.creatures) {
      delete c.sex;
      delete c.adultAge;
      delete c.brood;
      delete c.adultGrowth;
      delete c.fullSize;
    }
  }
  for (const r of s.sent) delete r.sex;
  return s as unknown as GameState;
}

describe('保存データの版', () => {
  test('新しく始めたデータは研究室から', () => {
    expect(createInitialState(T0).settings.room).toBe('lab');
    expect(migrate(JSON.parse(JSON.stringify(createInitialState(T0)))).settings.room).toBe('lab');
  });

  test('今の版のデータはそのまま読める', () => {
    const s = advance(createInitialState(T0), 12345);
    expect(migrate(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  test('設定に足りない項目があれば初期値で埋める', () => {
    const s = createInitialState(T0) as unknown as Record<string, unknown>;
    const raw = { ...s, settings: { lamp: false } };
    const m = migrate(raw);
    expect(m.settings.lamp).toBe(false);
    expect(m.settings.sound).toBe(false);
    expect(m.settings.quality).toBe('high');
    // 部屋を持っていないデータ（部屋を選べるようになる前から遊んでいた）は家のまま。読めない値も家に。固定の印は捨てる
    expect(m.settings.room).toBe('home');
    expect(migrate({ ...s, settings: { room: 'kitchen' } }).settings.room).toBe('home');
    const locked = migrate({ ...s, settings: { room: 'lab', roomLocked: true } }).settings;
    expect(locked.room).toBe('lab');
    expect('roomLocked' in locked).toBe(false);
  });

  test('形の違うデータや新しい版のデータは読まない', () => {
    expect(() => migrate(null)).toThrow(SchemaError);
    expect(() => migrate({ schema: 1 })).toThrow(SchemaError);
    expect(() => migrate({ ...createInitialState(T0), schema: SCHEMA_VERSION + 1 })).toThrow(/新しい版/);
  });
});

describe('書き出し・読み込み', () => {
  test('書き出したものをそのまま読み込める', () => {
    const s = advance(createInitialState(T0), 86400);
    const text = exportState(s, T0);
    expect(importState(text)).toEqual(s);
  });

  test('ほかのデータは読み込まない', () => {
    expect(() => importState('not json')).toThrow(SchemaError);
    expect(() => importState(JSON.stringify({ app: 'other', state: {} }))).toThrow(SchemaError);
  });
});

describe('版5からのマイグレーション', () => {
  test('3-5 までの保存データを、個体がみな基準の遺伝子（今の見た目）として読める', () => {
    const s = advance(createInitialState(T0), 3 * 86400);
    const v5 = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & { jars: Array<{ creatures: Array<Record<string, unknown>> }> };
    v5.schema = 5;
    for (const jar of v5.jars) for (const c of jar.creatures) delete c.genes;
    const m = migrate(v5);
    expect(m.schema).toBe(SCHEMA_VERSION);
    for (const jar of m.jars) for (const c of jar.creatures) expect(c.genes).toEqual(BASE_GENES);
  });
});

describe('版4からのマイグレーション', () => {
  test('3-4 までの保存データを、まだ揺らしていない状態として読める', () => {
    const s = advance(createInitialState(T0), 2 * 86400);
    const v4 = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & { jars: Array<Record<string, unknown>> };
    v4.schema = 4;
    for (const jar of v4.jars) delete jar.stirredUntil;
    const m = migrate(v4);
    expect(m.schema).toBe(SCHEMA_VERSION);
    expect(m.jars.every((j) => j.stirredUntil === null)).toBe(true);
    // 版6より前のデータには、版7で最初の手紙と日誌の一行が足される。版8で標本は空から（それ以外はそのまま）
    expect(withoutSex({ ...m, letters: s.letters, journal: s.journal, specimens: s.specimens })).toEqual(withoutSex(s));
    expect(m.specimens).toEqual([]);
    expect(m.journal.slice(0, s.journal.length)).toEqual(s.journal);
  });

  test('読めない揺れの記録は、揺らしていないことにする', () => {
    const s = JSON.parse(JSON.stringify(createInitialState(T0)));
    s.jars[1].stirredUntil = 'x';
    expect(migrate(s).jars[1]!.stirredUntil).toBeNull();
  });
});

describe('版3からのマイグレーション', () => {
  test('3-3 までの保存データに、未読・行の名前・来た日・瓶底の堆積を足す', () => {
    const s = advance(createInitialState(T0), 3 * 86400 + 123);
    const v3 = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & {
      jars: Array<Record<string, unknown> & { creatures: Array<Record<string, unknown>> }>;
      journal: Array<Record<string, unknown>>;
    };
    v3.schema = 3;
    delete v3.journalSeen;
    for (const e of v3.journal) delete e.name;
    for (const jar of v3.jars) {
      delete jar.sediment;
      delete jar.leftover;
      delete jar.cleanSince;
      for (const c of jar.creatures) delete c.arrivedWallTime;
    }
    const m = migrate(v3);
    expect(m.schema).toBe(SCHEMA_VERSION);
    // それまでの日誌は未読
    expect(m.journalSeen).toBe(0);
    expect(m.journal.length).toBeGreaterThan(0);
    expect(m.journal.every((e) => e.name === null)).toBe(true);
    // 来た日は今の時刻からさかのぼって求める（進めていた間の時刻と合う）
    for (const [i, jar] of m.jars.entries()) {
      for (const [k, c] of jar.creatures.entries()) expect(c.arrivedWallTime).toBeCloseTo(s.jars[i]!.creatures[k]!.arrivedWallTime, 3);
    }
    // 堆積は始めてからの日数の分だけ溜まっている
    expect(m.jars[0]!.sediment).toBeGreaterThan(0.2);
    expect(m.jars[0]!.leftover).toBeNull();
  });
});

describe('版2からのマイグレーション', () => {
  test('3-2 までの保存データを、餌を食べていない状態として読める', () => {
    const s = advance(createInitialState(T0), 2 * 86400);
    const v2 = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & { jars: Array<Record<string, unknown> & { creatures: Array<Record<string, unknown>> }> };
    v2.schema = 2;
    for (const jar of v2.jars) {
      delete jar.fedWallTime;
      for (const c of jar.creatures) delete c.meal;
    }
    const m = migrate(v2);
    expect(m.schema).toBe(SCHEMA_VERSION);
    expect(m.jars.every((j) => j.fedWallTime === null)).toBe(true);
    expect(m.jars[0]!.creatures.every((c) => c.meal === null)).toBe(true);
    // 版6より前のデータには、版7で最初の手紙と日誌の一行が足される。版8で標本は空から（それ以外はそのまま）
    expect(withoutSex({ ...m, letters: s.letters, journal: s.journal, specimens: s.specimens })).toEqual(withoutSex(s));
    expect(m.specimens).toEqual([]);
    expect(m.journal.slice(0, s.journal.length)).toEqual(s.journal);
  });

  test('読めない餌の記録は、食べていないことにする', () => {
    const s = JSON.parse(JSON.stringify(createInitialState(T0)));
    s.jars[0].creatures[0].meal = { at: 'x' };
    s.jars[0].fedWallTime = 'y';
    const m = migrate(s);
    expect(m.jars[0]!.creatures[0]!.meal).toBeNull();
    expect(m.jars[0]!.fedWallTime).toBeNull();
  });
});

describe('版10からのマイグレーション', () => {
  test('成体になってからの成長：すでにいる成体は育ちきった今の大きさのまま。エフィラは個体の種から育ちきった大きさを決める', () => {
    const s = advance(createInitialState(T0), 2 * 86400);
    spawnCreature(s, 0, 'adult');
    spawnCreature(s, 0, 'ephyra');
    const v10 = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & { jars: Array<Record<string, unknown> & { creatures: Array<Record<string, unknown>> }> };
    v10.schema = 10;
    for (const j of v10.jars) {
      for (const c of j.creatures) {
        delete c.adultGrowth;
        delete c.fullSize;
      }
    }
    const m = migrate(v10);
    expect(m.schema).toBe(SCHEMA_VERSION);
    for (const c of m.jars[0]!.creatures) {
      if (c.stage === 'adult') {
        expect(c).toMatchObject({ adultGrowth: 1, fullSize: 1 });
        expect(bodySize(c)).toBe(1);
      } else {
        expect(c.adultGrowth).toBe(0);
        expect(c.fullSize).toBeGreaterThanOrEqual(ADULT_GROWTH.fullSize[0]);
        expect(c.fullSize).toBeLessThanOrEqual(ADULT_GROWTH.fullSize[1]);
      }
    }
    expect(migrate(JSON.parse(JSON.stringify(v10)))).toEqual(m);
  });
});

describe('版9からのマイグレーション', () => {
  test('雌雄とプラヌラ：最初の一匹はメス、ほかの成体・エフィラは半々。送った子のエフィラは雌雄を残さない', () => {
    const s = advance(createInitialState(T0), 2 * 86400);
    const jar = s.jars[0]!;
    // 版9のデータ：成体を何匹か（成体になってから長いもの・なったばかりのもの）とエフィラ、送った子
    for (let i = 0; i < 12; i++) {
      jar.creatures.push({ ...structuredClone(jar.creatures[0]!), id: 100 + i, seed: 1000 + i * 7919, parent: 1, age: (i % 2 ? 20 : 7) * 86400 });
    }
    jar.creatures.push({ ...structuredClone(jar.creatures[0]!), id: 200, stage: 'ephyra', parent: 5 });
    s.sent.push({ id: 300, name: null, species: 'aurelia', stage: 'adult', genes: { ...BASE_GENES }, generation: 1, sex: null, jar: 0, sentAt: 0, sentWallTime: T0 });
    s.sent.push({ id: 301, name: null, species: 'aurelia', stage: 'ephyra', genes: { ...BASE_GENES }, generation: 1, sex: null, jar: 0, sentAt: 0, sentWallTime: T0 });
    const v9 = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & {
      jars: Array<Record<string, unknown> & { creatures: Array<Record<string, unknown>> }>;
      sent: Array<Record<string, unknown>>;
    };
    v9.schema = 9;
    for (const j of v9.jars) {
      delete j.planulae;
      for (const c of j.creatures) {
        delete c.sex;
        delete c.adultAge;
        delete c.brood;
      }
    }
    for (const r of v9.sent) delete r.sex;
    const m = migrate(v9);
    expect(m.schema).toBe(SCHEMA_VERSION);
    expect(m.jars.every((j) => Array.isArray(j.planulae) && j.planulae.length === 0)).toBe(true);
    const cs = m.jars[0]!.creatures;
    const first = cs.find((c) => c.id === 1)!;
    expect(first.sex).toBe('female');
    expect(first.brood).toBeNull();
    expect(first.adultAge).toBeGreaterThan(0);
    const adults = cs.filter((c) => c.id >= 100 && c.id < 200);
    const females = adults.filter((c) => c.sex === 'female').length;
    expect(females).toBeGreaterThan(0);
    expect(females).toBeLessThan(adults.length);
    // 成体になってからの時間は、年齢からエフィラの期間を引いて見積もる（7日ではまだ成熟前、20日では成熟）
    for (const c of adults) expect(c.adultAge > SEX.matureAfter).toBe(c.age > 10 * 86400);
    expect(cs.find((c) => c.id === 200)!).toMatchObject({ adultAge: 0, brood: null });
    expect(['male', 'female']).toContain(cs.find((c) => c.id === 200)!.sex);
    for (const c of cs.filter((x) => x.stage === 'polyp' || x.stage === 'strobila')) expect(c.sex).toBeNull();
    expect(['male', 'female']).toContain(m.sent.find((r) => r.id === 300)!.sex);
    expect(m.sent.find((r) => r.id === 301)!.sex).toBeNull();
    // 同じデータからは同じ結果
    expect(migrate(JSON.parse(JSON.stringify(v9)))).toEqual(m);
  });

  test('読めない雌雄・プラヌラは、決め直すか除く', () => {
    const s = JSON.parse(JSON.stringify(createInitialState(T0)));
    s.jars[0].creatures[0].sex = 'x';
    s.jars[0].creatures[0].brood = { from: 'a' };
    s.jars[0].creatures[0].adultAge = -1;
    s.jars[1].planulae = [{ at: 5, parent: 1, genes: { hue: 9 } }, { at: 'x' }];
    const m = migrate(s);
    expect(['male', 'female']).toContain(m.jars[0]!.creatures[0]!.sex);
    expect(m.jars[0]!.creatures[0]!.brood).toBeNull();
    expect(m.jars[0]!.creatures[0]!.adultAge).toBe(0);
    expect(m.jars[1]!.planulae).toEqual([{ at: 5, parent: 1, genes: { ...BASE_GENES, hue: 1 }, generation: 1 }]);
  });
});

describe('版1からのマイグレーション', () => {
  test('フェーズ2の保存データ（成体1匹）を、今の形で読める', () => {
    const v1 = {
      schema: 1,
      rng: 123456,
      time: 5 * 86400,
      pending: 12.5,
      lastTick: T0,
      createdAt: T0 - 5 * 86400 * 1000,
      nextId: 2,
      jars: [
        { creatures: [{ id: 1, species: 'aurelia', stage: 'adult', seed: 42, age: 5 * 86400, stageAge: 5 * 86400, arrivedAt: 0, name: null }] },
        { creatures: [] },
        { creatures: [] },
      ],
      journal: [],
      specimens: [],
      settings: { lamp: false, sound: false, motion: true, quality: 'high' },
    };
    const s = migrate(v1);
    expect(s.schema).toBe(SCHEMA_VERSION);
    const c = s.jars[0]!.creatures[0]!;
    expect(c).toMatchObject({ id: 1, stage: 'adult', seed: 42, progress: 0, parent: null, spot: null, discs: 0 });
    expect(c.stageLength).toBeGreaterThan(0);
    expect(s.jars.every((j) => j.resting === false)).toBe(true);
    expect(s.settings.lamp).toBe(false);
    // そのまま進められる（最初の一匹はメスなので、約1日でプラヌラを抱え、粒がなくなってしばらくするとポリプが付く）
    expect(c.sex).toBe('female');
    const n = advance(s, 3 * 86400);
    expect(n.jars[0]!.creatures.some((x) => x.stage === 'polyp')).toBe(true);
  });
});

describe('版11からのマイグレーション', () => {
  test('何代目か：親をたどれる所までたどって数える（成体から付いたポリプは＋1、ポリプから出たエフィラは同じ）。たどれなければ1代目', () => {
    const s = createInitialState(T0);
    const jar = s.jars[0]!;
    const first = jar.creatures[0]!;
    const make = (id: number, stage: 'polyp' | 'ephyra' | 'adult', parent: number | null) => ({ ...structuredClone(first), id, stage, parent, sex: null, brood: null });
    // 最初の成体 → ポリプ 10 → エフィラ 11（成体に育った）→ ポリプ 12 → エフィラ 13。親を送ってしまったポリプ 20 とそのエフィラ 21
    jar.creatures.push(make(10, 'polyp', 1), make(11, 'adult', 10), make(12, 'polyp', 11), make(13, 'ephyra', 12), make(20, 'polyp', 99), make(21, 'ephyra', 20));
    jar.planulae.push({ at: 10, parent: 11, genes: { ...BASE_GENES }, generation: 1 });
    s.sent.push({ id: 99, name: null, species: 'aurelia', stage: 'adult', genes: { ...BASE_GENES }, generation: 1, sex: null, jar: 0, sentAt: 0, sentWallTime: T0 });
    const v11 = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & {
      jars: Array<Record<string, unknown> & { creatures: Array<Record<string, unknown>>; planulae: Array<Record<string, unknown>> }>;
      sent: Array<Record<string, unknown>>;
      uncle: Record<string, unknown>;
    };
    v11.schema = 11;
    for (const j of v11.jars) {
      for (const c of j.creatures) delete c.generation;
      for (const p of j.planulae) delete p.generation;
    }
    for (const r of v11.sent) delete r.generation;
    delete v11.uncle.asked;
    delete v11.uncle.given;
    const m = migrate(v11);
    const gen = (id: number) => m.jars[0]!.creatures.find((c) => c.id === id)!.generation;
    expect([1, 10, 11, 12, 13, 20, 21].map(gen)).toEqual([1, 2, 2, 3, 3, 1, 1]);
    expect(m.jars[0]!.planulae[0]!.generation).toBe(3);
    expect(m.sent[0]!.generation).toBe(1);
    expect(m.uncle.asked).toEqual([]);
    expect(m.uncle.given).toEqual([]);
    expect(m.schema).toBe(SCHEMA_VERSION);
  });

  test('カブトクラゲ：遺伝子は種の形で読み、雌雄は持たない。読めない種はミズクラゲ', () => {
    const s = createInitialState(T0);
    const k = spawnCreature(s, 1, 'adult', undefined, 'bolinopsis');
    const raw = JSON.parse(JSON.stringify(s));
    const rk = raw.jars[1].creatures.find((c: { id: number }) => c.id === k.id);
    rk.sex = 'female';
    rk.genes = { lobe: 5, hue: 1 };
    raw.jars[0].creatures[0].species = 'nope';
    const m = migrate(raw);
    const mk = m.jars[1]!.creatures.find((c) => c.id === k.id)!;
    expect(mk.species).toBe('bolinopsis');
    expect(mk.sex).toBeNull();
    expect(mk.genes).toEqual({ clarity: 0, tempo: 0, lobe: 1, build: 0, warp: 0, lobeSkew: 0, rowJitter: 0 });
    expect(m.jars[0]!.creatures[0]!.species).toBe('aurelia');
  });
});

describe('版12からのマイグレーション', () => {
  test('卵はなし。いたカブトクラゲの成体は、次に卵を産むまでを数えはじめる', () => {
    const s = createInitialState(T0);
    const k = spawnCreature(s, 1, 'adult', undefined, 'bolinopsis');
    const v12 = JSON.parse(JSON.stringify(s));
    v12.schema = 12;
    for (const j of v12.jars) delete j.eggs;
    const rk = v12.jars[1].creatures.find((c: { id: number }) => c.id === k.id);
    rk.progress = 0.8;
    rk.stageLength = 1;
    const m = migrate(v12);
    expect(m.schema).toBe(SCHEMA_VERSION);
    expect(m.jars.map((j) => j.eggs)).toEqual([[], [], []]);
    const mk = m.jars[1]!.creatures.find((c) => c.id === k.id)!;
    expect(mk.progress).toBe(0);
    expect(mk.stageLength).toBe((LIFE.lay[0] + LIFE.lay[1]) / 2);
    // ミズクラゲの成体はそのまま
    expect(m.jars[0]!.creatures[0]!.stageLength).toBe(s.jars[0]!.creatures[0]!.stageLength);
  });

  test('その種にない段階（確認用に変えたカブトクラゲのポリプ）は、その種の成体にする', () => {
    const s = createInitialState(T0);
    const k = spawnCreature(s, 1, 'adult', undefined, 'bolinopsis');
    const raw = JSON.parse(JSON.stringify(s));
    const rk = raw.jars[1].creatures.find((c: { id: number }) => c.id === k.id);
    rk.stage = 'polyp';
    rk.spot = [0.1, 0.1];
    raw.jars[0].creatures[0].stage = 'larva';
    const m = migrate(raw);
    const mk = m.jars[1]!.creatures.find((c) => c.id === k.id)!;
    expect(mk.stage).toBe('adult');
    expect(mk.spot).toBeNull();
    expect(m.jars[0]!.creatures[0]!.stage).toBe('adult');
  });

  test('卵と幼生を書き出して読み込める。読めない卵だけ除く', () => {
    const s = createInitialState(T0);
    const k = spawnCreature(s, 1, 'adult', undefined, 'bolinopsis');
    layEggsNow(s, k.id);
    spawnCreature(s, 1, 'larva', undefined, 'bolinopsis');
    expect(importState(exportState(s, T0))).toEqual(s);
    const raw = JSON.parse(JSON.stringify(s));
    raw.jars[1].eggs.push({ laidAt: 'x' }, { laidAt: 0, hatchAt: 10, count: 0 });
    raw.jars[1].eggs[0].genes = { lobe: 9 };
    raw.jars[1].eggs[0].shown = 0;
    const m = migrate(raw);
    expect(m.jars[1]!.eggs).toHaveLength(1);
    const e = m.jars[1]!.eggs[0]!;
    expect(e.genes.lobe).toBe(1);
    expect(e.shown).toBe(e.count);
  });
});
