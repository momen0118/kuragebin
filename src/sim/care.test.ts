import { describe, expect, test } from 'vitest';
import { CARE, LIFE } from '../config';
import { advance } from './advance';
import { waterTime } from './care';
import { setSediment } from './edit';
import { feedJar } from './feed';
import { createInitialState, type GameState } from './state';

/** 端末の現地時刻（ミリ秒）。どの時間帯で走らせても同じになるよう、現地時刻で作る */
const local = (day: number, hour: number, minute = 0): number => new Date(2026, 8, day, hour, minute).getTime();
/** 端末の時刻 from から to まで進めた状態（閉じていた分として、または瓶 watching を見ながら） */
function run(s: GameState, from: number, to: number, watching: number | null = null): GameState {
  return advance(s, (to - from) / 1000, LIFE, watching);
}

const waters = (s: GameState, jar = 0): number[] => s.journal.filter((e) => e.kind === 'water' && e.jar === jar).map((e) => e.wallTime);

describe('水換えの時刻', () => {
  test('夜中の2〜4時のどこか。瓶と夜ごとに決まり、何度求めても同じ', () => {
    for (let day = 1; day <= 20; day++) {
      for (let jar = 0; jar < 3; jar++) {
        const t = waterTime(local(day, 13), jar);
        const d = new Date(t);
        expect(d.getDate()).toBe(day);
        expect(d.getHours()).toBeGreaterThanOrEqual(CARE.startHour);
        expect(d.getHours()).toBeLessThan(CARE.startHour + CARE.windowHours);
        expect(waterTime(local(day, 3), jar)).toBe(t);
      }
    }
    // 瓶ごとに違う時刻になる
    expect(new Set([0, 1, 2].map((j) => waterTime(local(5, 12), j))).size).toBe(3);
  });
});

describe('瓶底の堆積と水換え', () => {
  test('マリンスノーで少しずつ溜まる。一定量に届くまでは水を替えない', () => {
    const s = createInitialState(local(1, 12));
    const n = run(s, local(1, 12), local(4, 12));
    expect(n.jars[0]!.sediment).toBeCloseTo(CARE.after + 3 * CARE.snowPerDay, 6);
    expect(waters(n)).toHaveLength(0);
  });

  test('一定量に届いた瓶だけ、その夜の決まった時刻に水を替え、薄く均されて日誌に一行残る', () => {
    const s = createInitialState(local(1, 12));
    setSediment(s, 0, CARE.threshold);
    const n = run(s, local(1, 12), local(2, 12));
    const w = waters(n);
    expect(w).toHaveLength(1);
    expect(Math.abs(w[0]! - waterTime(local(2, 12), 0))).toBeLessThanOrEqual(60 * 1000);
    expect(n.jars[0]!.sediment).toBeLessThan(CARE.after + 0.1);
    // ほかの瓶はまだ届いていないので替えない
    expect(waters(n, 1)).toHaveLength(0);
    // 毎晩は起きない
    const later = run(n, local(2, 12), local(5, 12));
    expect(waters(later)).toHaveLength(1);
  });

  test('その瓶を表示している間は起きず、次の夜に回す', () => {
    const s = createInitialState(local(1, 12));
    setSediment(s, 0, CARE.threshold);
    // 1日目の夜は瓶1を見たまま（開いたまま）
    const watched = run(s, local(1, 12), local(2, 12), 0);
    expect(waters(watched)).toHaveLength(0);
    // 次の夜は閉じていた
    const next = run(watched, local(2, 12), local(3, 12));
    const w = waters(next);
    expect(w).toHaveLength(1);
    expect(new Date(w[0]!).getDate()).toBe(3);
  });

  test('食べ残しが消えきってから少し間を空けたあとに限る。間に合わない夜は見送る', () => {
    const s = createInitialState(local(1, 12));
    setSediment(s, 0, CARE.threshold);
    // その夜の水換えの少し前に餌をやる（食べ残しが消えきって間もない）
    const at = waterTime(local(2, 12), 0) - 20 * 60 * 1000;
    const before = run(s, local(1, 12), at);
    expect(feedJar(before, 0, at)).toBe('fed');
    const n = run(before, at, local(2, 12));
    expect(waters(n)).toHaveLength(0);
    const next = run(n, local(2, 12), local(3, 12));
    expect(waters(next)).toHaveLength(1);
  });

  test('食べ残しが消えると、そのぶん堆積が増える', () => {
    const s = createInitialState(local(1, 12));
    const fed = structuredClone(s);
    feedJar(fed, 0, local(1, 12));
    expect(fed.jars[0]!.leftover).not.toBeNull();
    const a = run(s, local(1, 12), local(1, 13));
    const b = run(fed, local(1, 12), local(1, 13));
    expect(b.jars[0]!.leftover).toBeNull();
    expect(b.jars[0]!.sediment).toBeGreaterThan(a.jars[0]!.sediment);
    expect(b.jars[0]!.cleanSince).toBeCloseTo(fed.jars[0]!.leftover!.goneAt, 6);
  });

  test('餌をやるほど水換えの間隔が短くなる', () => {
    const days = 20;
    const plain = run(createInitialState(local(1, 12)), local(1, 12), local(1 + days, 12));
    // 毎日お昼に餌をやる
    let fed = createInitialState(local(1, 12));
    let t = local(1, 12);
    for (let d = 1; d <= days; d++) {
      fed = run(fed, t, local(d, 12));
      t = local(d, 12);
      expect(feedJar(fed, 0, t)).toBe('fed');
    }
    fed = run(fed, t, local(1 + days, 12));
    expect(waters(fed).length).toBeGreaterThan(waters(plain).length);
    expect(waters(plain).length).toBeGreaterThanOrEqual(1);
  });

  test('分けて進めても同じ結果', () => {
    const s = createInitialState(local(1, 12));
    setSediment(s, null, 0.9);
    feedJar(s, 0, local(1, 12));
    const once = run(s, local(1, 12), local(9, 12));
    let split = s;
    const cuts = [local(1, 15), local(2, 3), local(4, 2, 30), local(9, 12)];
    let from = local(1, 12);
    for (const to of cuts) {
      split = run(split, from, to);
      from = to;
    }
    expect(split.jars).toEqual(once.jars);
    expect(split.journal).toEqual(once.journal);
  });
});
