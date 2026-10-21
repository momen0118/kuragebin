import { describe, expect, test } from 'vitest';
import { ADULT_GROWTH, SEX } from '../config';
import { spawnCreature } from '../sim/edit';
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
    // 部屋は家、固定なし。読めない値も家に
    expect(m.settings).toMatchObject({ room: 'home', roomLocked: false });
    expect(migrate({ ...s, settings: { room: 'kitchen', roomLocked: 'yes' } }).settings).toMatchObject({ room: 'home', roomLocked: false });
    expect(migrate({ ...s, settings: { room: 'lab', roomLocked: true } }).settings).toMatchObject({ room: 'lab', roomLocked: true });
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
    s.sent.push({ id: 300, name: null, species: 'aurelia', stage: 'adult', genes: { ...BASE_GENES }, sex: null, jar: 0, sentAt: 0, sentWallTime: T0 });
    s.sent.push({ id: 301, name: null, species: 'aurelia', stage: 'ephyra', genes: { ...BASE_GENES }, sex: null, jar: 0, sentAt: 0, sentWallTime: T0 });
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
    expect(m.jars[1]!.planulae).toEqual([{ at: 5, parent: 1, genes: { ...BASE_GENES, hue: 1 } }]);
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
