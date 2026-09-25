import { describe, expect, test } from 'vitest';
import { SIM } from '../config';
import { advance, catchUp } from './advance';
import { Clock } from './clock';
import { createInitialState } from './state';

const T0 = Date.UTC(2026, 8, 25, 3, 0, 0);

describe('advance', () => {
  test('元の状態は変えず、進めた新しい状態を返す', () => {
    const s = createInitialState(T0);
    const n = advance(s, 3600);
    expect(s.time).toBe(0);
    expect(n.time).toBe(3600);
    expect(n.jars[0]!.creatures[0]!.age).toBe(3600);
  });

  test('固定刻みに満たない端数は持ち越し、分けて進めても同じ結果', () => {
    const s = createInitialState(T0);
    const once = advance(s, 1000);
    let split = s;
    for (const d of [10, 25.5, 300, 64.5, 600]) split = advance(split, d);
    expect(split).toEqual(once);
    expect(once.time).toBe(Math.floor(1000 / SIM.stepSeconds) * SIM.stepSeconds);
    expect(once.pending).toBeCloseTo(1000 % SIM.stepSeconds);
  });

  test('同じ状態と経過からは同じ結果（乱数も含めて）', () => {
    const a = advance(createInitialState(T0, 42), 86400 * 3);
    const b = advance(createInitialState(T0, 42), 86400 * 3);
    expect(a).toEqual(b);
  });

  test('0 や負の経過では何も進まない', () => {
    const s = createInitialState(T0);
    expect(advance(s, 0)).toEqual(s);
    expect(advance(s, -5)).toEqual(s);
    expect(advance(s, Number.NaN)).toEqual(s);
  });
});

describe('catchUp', () => {
  test('閉じていた分を進める', () => {
    const s = createInitialState(T0);
    const r = catchUp(s, T0 + 2 * 3600 * 1000);
    expect(r.elapsed).toBe(7200);
    expect(r.state.time).toBe(7200);
    expect(r.state.lastTick).toBe(T0 + 7200 * 1000);
    expect(r.rewound).toBe(false);
  });

  test('30日を越えて離れていても、30日分だけ進める', () => {
    const s = createInitialState(T0);
    const r = catchUp(s, T0 + 100 * 86400 * 1000);
    expect(r.elapsed).toBe(SIM.maxElapsedDays * 86400);
    expect(r.state.time).toBe(SIM.maxElapsedDays * 86400);
    // 次はいまの時刻から数える
    expect(r.state.lastTick).toBe(T0 + 100 * 86400 * 1000);
  });

  test('端末の時計が巻き戻っていたら経過0で、何も壊さない', () => {
    const s = advance(createInitialState(T0), 5000);
    const r = catchUp(s, T0 - 3600 * 1000);
    expect(r.rewound).toBe(true);
    expect(r.elapsed).toBe(0);
    expect(r.state.time).toBe(s.time);
    expect(r.state.jars).toEqual(s.jars);
    // 巻き戻った時刻から、また普通に進む
    expect(r.state.lastTick).toBe(T0 - 3600 * 1000);
    expect(catchUp(r.state, T0).elapsed).toBe(3600);
  });
});

describe('Clock', () => {
  test('早送りとずらし', () => {
    let wall = 1000;
    const c = new Clock(() => wall);
    expect(c.now()).toBe(1000);
    wall = 2000;
    expect(c.now()).toBe(2000);
    c.setSpeed(60);
    wall = 3000;
    expect(c.now()).toBe(2000 + 1000 * 60);
    c.jump(5000);
    expect(c.now()).toBe(2000 + 60000 + 5000);
    c.reset();
    expect(c.now()).toBe(3000);
    expect(c.drift).toBe(0);
  });
});
