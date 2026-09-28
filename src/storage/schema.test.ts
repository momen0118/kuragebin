import { describe, expect, test } from 'vitest';
import { advance } from '../sim/advance';
import { createInitialState, SCHEMA_VERSION } from '../sim/state';
import { exportState, importState } from './io';
import { migrate, SchemaError } from './schema';

const T0 = Date.UTC(2026, 8, 25, 3, 0, 0);

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

describe('版4からのマイグレーション', () => {
  test('3-4 までの保存データを、まだ揺らしていない状態として読める', () => {
    const s = advance(createInitialState(T0), 2 * 86400);
    const v4 = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & { jars: Array<Record<string, unknown>> };
    v4.schema = 4;
    for (const jar of v4.jars) delete jar.stirredUntil;
    const m = migrate(v4);
    expect(m.schema).toBe(SCHEMA_VERSION);
    expect(m.jars.every((j) => j.stirredUntil === null)).toBe(true);
    expect(m).toEqual(s);
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
    expect(m).toEqual(s);
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
    // そのまま進められる（約1日でポリプが付く）
    const n = advance(s, 1.5 * 86400);
    expect(n.jars[0]!.creatures.some((x) => x.stage === 'polyp')).toBe(true);
  });
});
