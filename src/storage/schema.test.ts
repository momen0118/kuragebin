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
