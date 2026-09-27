import { describe, expect, test } from 'vitest';
import { Game } from './game';
import { Clock } from './sim/clock';
import { createInitialState, SCHEMA_VERSION } from './sim/state';
import { memoryStore } from './storage/db';

const T0 = Date.UTC(2026, 8, 25, 3, 0, 0);

describe('Game', () => {
  test('保存がなければ最初の状態から始め、すぐ保存する', async () => {
    const store = memoryStore();
    const g = await Game.start(new Clock(() => T0), store);
    expect(g.state.jars[0]!.creatures).toHaveLength(1);
    expect(g.state.jars[1]!.creatures).toHaveLength(0);
    expect(await store.load()).toEqual(g.state);
  });

  test('閉じていた分を進めてから始める。設定は保存される', async () => {
    const store = memoryStore();
    let wall = T0;
    const g = await Game.start(new Clock(() => wall), store);
    g.updateSettings({ lamp: false });
    await g.save();
    wall = T0 + 5 * 86400 * 1000;
    const again = await Game.start(new Clock(() => wall), store);
    expect(again.state.settings.lamp).toBe(false);
    expect(again.state.time).toBe(5 * 86400);
    expect(again.info.lastCatchUp).toBe(5 * 86400);
  });

  test('読めない保存データは消さずに取っておき、新しく始める', async () => {
    const store = memoryStore();
    await store.save({ schema: 1, broken: true });
    const g = await Game.start(new Clock(() => T0), store);
    expect(g.state.time).toBe(0);
  });

  test('餌は1日1回。やった記録は保存される', async () => {
    const store = memoryStore();
    let wall = new Date(2026, 8, 27, 20, 0).getTime();
    const g = await Game.start(new Clock(() => wall), store);
    expect(g.canFeed(0)).toBe('fed');
    expect(g.feed(0)).toBe('fed');
    expect(g.feed(0)).toBe('already');
    expect(g.feed(1)).toBe('empty');
    await g.save();
    const saved = (await store.load()) as ReturnType<typeof createInitialState>;
    expect(saved.jars[0]!.fedWallTime).toBe(wall);
    expect(saved.jars[0]!.creatures[0]!.meal).not.toBeNull();
    // 次の日の朝4時を過ぎたら、またやれる
    wall = new Date(2026, 8, 28, 4, 30).getTime();
    expect(g.canFeed(0)).toBe('fed');
  });

  test('新しい版の保存データは上書きしない', async () => {
    const store = memoryStore();
    const newer = { ...createInitialState(T0), schema: SCHEMA_VERSION + 1 };
    await store.save(newer);
    const g = await Game.start(new Clock(() => T0 + 1000), store);
    g.updateSettings({ lamp: false });
    await g.save();
    expect(await store.load()).toEqual(newer);
    expect(g.info.persistent).toBe(false);
  });
});
