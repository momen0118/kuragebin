import { describe, expect, test } from 'vitest';
import { LIFE } from '../config';
import { advance } from './advance';
import { canMove, moveCreature, NAME_MAX, renameCreature } from './actions';
import { fillAdults, spawnCreature } from './edit';
import { createInitialState } from './state';
import { migrate } from '../storage/schema';

const T0 = Date.UTC(2026, 8, 26, 3, 0, 0);

describe('隣の瓶へ移す', () => {
  test('泳ぐ個体は移せる。来た時刻は今になり、成体の「次のポリプまで」は数えなおす', () => {
    const s = advance(createInitialState(T0), 0.7 * 86400);
    const adult = s.jars[0]!.creatures[0]!;
    expect(adult.progress).toBeGreaterThan(0.3);
    expect(moveCreature(s, adult.id, 1)).toBe('moved');
    expect(s.jars[0]!.creatures).toHaveLength(0);
    const moved = s.jars[1]!.creatures[0]!;
    expect(moved.id).toBe(adult.id);
    expect(moved.arrivedAt).toBe(s.time);
    expect(moved.progress).toBe(0);
    // 移した直後に移し先の瓶底へポリプは付かない
    const later = advance(s, 3600);
    expect(later.jars[1]!.creatures.some((c) => c.stage === 'polyp')).toBe(false);
  });

  test('ポリプとストロビラは動かさない', () => {
    const s = createInitialState(T0);
    const p = spawnCreature(s, 0, 'polyp');
    const st = spawnCreature(s, 0, 'strobila');
    expect(moveCreature(s, p.id, 1)).toBe('fixed');
    expect(moveCreature(s, st.id, 1)).toBe('fixed');
    expect(s.jars[0]!.creatures.map((c) => c.id)).toContain(p.id);
  });

  test('移し先が上限なら移さない（ストロビラが放す予定の数も数える）', () => {
    const s = createInitialState(T0);
    fillAdults(s, 1, LIFE.maxSwimmers - 1);
    const e = spawnCreature(s, 0, 'ephyra');
    expect(canMove(s, e.id, 1)).toBe('moved');
    // 移し先にストロビラ（皿3枚）がいると、空きが足りない
    spawnCreature(s, 1, 'strobila');
    expect(canMove(s, e.id, 1)).toBe('full');
    expect(moveCreature(s, e.id, 1)).toBe('full');
    expect(s.jars[0]!.creatures.map((c) => c.id)).toContain(e.id);
  });

  test('同じ瓶や、ない個体・瓶には何もしない', () => {
    const s = createInitialState(T0);
    const id = s.jars[0]!.creatures[0]!.id;
    expect(moveCreature(s, id, 0)).toBe('same');
    expect(moveCreature(s, 999, 1)).toBe('missing');
    expect(moveCreature(s, id, 7)).toBe('missing');
  });
});

describe('名前', () => {
  test('前後の空白を除き、長すぎれば切る。空なら名無しに戻す', () => {
    const s = createInitialState(T0);
    const id = s.jars[0]!.creatures[0]!.id;
    renameCreature(s, id, '  しずく ');
    expect(s.jars[0]!.creatures[0]!.name).toBe('しずく');
    renameCreature(s, id, 'あ'.repeat(NAME_MAX + 5));
    expect([...s.jars[0]!.creatures[0]!.name!]).toHaveLength(NAME_MAX);
    renameCreature(s, id, '   ');
    expect(s.jars[0]!.creatures[0]!.name).toBeNull();
  });
});

describe('前回見ていた瓶', () => {
  test('保存データに無いか、瓶の数を越えていれば 1番の瓶', () => {
    const s = createInitialState(T0) as unknown as Record<string, unknown>;
    expect(migrate({ ...s, settings: { lamp: true } }).settings.jar).toBe(0);
    expect(migrate({ ...s, settings: { jar: 2 } }).settings.jar).toBe(2);
    expect(migrate({ ...s, settings: { jar: 5 } }).settings.jar).toBe(0);
  });
});
