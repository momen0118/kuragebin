import { describe, expect, test } from 'vitest';
import { FIND_VARIANTS, FINDS, LIFE } from '../config';
import { migrate } from '../storage/schema';
import { advance } from './advance';
import { spawnCreature, spawnFind } from './edit';
import { bookSpecimens, canPlace, findsIn, pickFind, pickVariant, placeFind, setFindPhoto, settleSpot } from './finds';
import { createRng } from './rng';
import { createInitialState, type GameState } from './state';

const T0 = new Date(2026, 9, 1, 12).getTime();
const DAY = 86400;

/** 状態 s を days 日進める（閉じていた分として、または瓶 watching を見ながら） */
const run = (s: GameState, days: number, watching: number | null = null): GameState => advance(s, days * DAY, LIFE, watching);

/** 瓶が空のまま（生活環の個体なし）で始める。拾いものだけを数えやすいように */
function empty(seedOffset = 0): GameState {
  const s = createInitialState(T0 + seedOffset * 1000);
  s.jars[0]!.creatures = [];
  return s;
}

describe('拾いものが現れる', () => {
  test('1瓶あたり平均7日に1つくらい（多くの始め方で数えて）', () => {
    let total = 0;
    let span = 0;
    for (let k = 0; k < 40; k++) {
      let s = empty(k * 7919);
      // 上限で止まらないよう、現れたらすぐ拾って数える
      for (let d = 0; d < 28; d++) {
        s = run(s, 1);
        for (const f of s.specimens.filter((x) => x.at)) {
          pickFind(s, f.id, T0);
          total++;
        }
      }
      span += 28 * 3;
    }
    const meanDays = span / total;
    expect(meanDays).toBeGreaterThan(FINDS.meanDays * 0.8);
    expect(meanDays).toBeLessThan(FINDS.meanDays * 1.25);
  });

  test('見ている瓶には現れない（ほかの瓶には現れる）', () => {
    let s = empty();
    s = run(s, 60, 1);
    expect(findsIn(s, 1)).toHaveLength(0);
    expect(findsIn(s, 0).length + findsIn(s, 2).length).toBeGreaterThan(0);
  });

  test('1瓶に3つまで', () => {
    const s = run(empty(), 120);
    for (let j = 0; j < 3; j++) expect(findsIn(s, j)).toHaveLength(FINDS.maxPerJar);
  });

  test('同じ状態と経過から同じ結果。何回に分けて進めても同じ', () => {
    const a = run(empty(), 30);
    let b = empty();
    for (let i = 0; i < 30; i++) b = run(b, 1);
    expect(b.specimens).toEqual(a.specimens);
    expect(run(empty(), 30).specimens).toEqual(a.specimens);
  });

  test('ポリプと物は離れた所に付く', () => {
    const s = createInitialState(T0);
    for (let i = 0; i < 3; i++) spawnFind(s, 0);
    const n = run(s, 4);
    const polyps = n.jars[0]!.creatures.filter((c) => c.spot);
    expect(polyps.length).toBeGreaterThan(0);
    for (const p of polyps) {
      for (const f of findsIn(n, 0)) {
        const [x, z] = f.at!.spot;
        expect(Math.hypot(p.spot![0] - x, (p.spot![1] - z) * FINDS.depthWeight)).toBeGreaterThan(0.1);
      }
    }
  });

  test('種類と色は重みどおりに選ばれ、シーグラスの色は幅広い', () => {
    const rng = createRng(7);
    const seen = new Map<string, number>();
    for (let i = 0; i < 20000; i++) {
      const v = pickVariant(rng);
      expect(FIND_VARIANTS[v.variant]!.kind).toBe(v.kind);
      seen.set(v.variant, (seen.get(v.variant) ?? 0) + 1);
    }
    // どの色も出る（ごくまれな赤も）
    for (const k of Object.keys(FIND_VARIANTS)) expect(seen.get(k) ?? 0).toBeGreaterThan(0);
    const glass = [...seen].filter(([k]) => k.startsWith('glass')).reduce((a, [, n]) => a + n, 0);
    expect(glass / 20000).toBeCloseTo(FINDS.kinds.glass, 1);
    expect(seen.get('glass-red')!).toBeLessThan(seen.get('glass-blue')!);
  });
});

describe('拾う・置く', () => {
  test('拾うと標本へ移り、初めて拾った日と写真が残る。置き直して拾っても、日と写真は最初のまま', () => {
    const s = empty();
    const id = spawnFind(s, 0, 'glass-blue');
    expect(bookSpecimens(s)).toHaveLength(0);
    expect(pickFind(s, id, T0 + 1000)).toBe(true);
    expect(setFindPhoto(s, id, 'data:a')).toBe(true);
    expect(bookSpecimens(s).map((x) => x.id)).toEqual([id]);
    const first = { ...bookSpecimens(s)[0]! };
    expect(first.foundWallTime).toBe(T0 + 1000);
    // 別の瓶に置き直して、また拾う
    expect(placeFind(s, id, 2, [0.2, 0.1], 1)).toBe('placed');
    expect(bookSpecimens(s)).toHaveLength(0);
    expect(findsIn(s, 2)[0]!.at!.placed).toBe(true);
    expect(pickFind(s, id, T0 + 99999)).toBe(true);
    expect(setFindPhoto(s, id, 'data:b')).toBe(false);
    expect(bookSpecimens(s)[0]).toMatchObject({ foundWallTime: first.foundWallTime, photo: 'data:a' });
    // 標本にある物は拾えない
    expect(pickFind(s, id, T0)).toBe(false);
  });

  test('自分で置けるのは1瓶に1つまで。置いた瓶では、現れる物は2つまで', () => {
    let s = empty();
    const a = spawnFind(s, 0);
    const b = spawnFind(s, 0);
    pickFind(s, a, T0);
    pickFind(s, b, T0);
    expect(placeFind(s, a, 0, [0, 0], 0)).toBe('placed');
    expect(canPlace(s, b, 0)).toBe('full');
    expect(placeFind(s, b, 0, [0.3, 0], 0)).toBe('full');
    expect(canPlace(s, b, 1)).toBe('placed');
    s = run(s, 120, null);
    const here = findsIn(s, 0);
    expect(here).toHaveLength(FINDS.maxPerJar);
    expect(here.filter((x) => x.at!.placed)).toHaveLength(1);
  });

  test('ポリプやほかの物に近すぎる所に置くと、近くの空いた所へずれる', () => {
    const s = empty();
    const p = spawnCreature(s, 0, 'polyp');
    p.spot = [0, 0];
    const id = spawnFind(s, 1);
    pickFind(s, id, T0);
    expect(placeFind(s, id, 0, [0.02, 0.01], 0)).toBe('placed');
    const [x, z] = findsIn(s, 0)[0]!.at!.spot;
    expect(Math.hypot(x, z * FINDS.depthWeight)).toBeGreaterThanOrEqual(FINDS.placeSpacing - 1e-9);
    expect(Math.hypot(x - 0.02, z - 0.01)).toBeLessThan(0.6);
    // 空いていればそのまま
    expect(settleSpot([[0, 0]], [0.5, 0.2])).toEqual([0.5, 0.2]);
    // 置ける範囲の外は内側へ
    const far = settleSpot([], [2, 0], FINDS.placeRadius);
    expect(Math.hypot(far[0], far[1])).toBeCloseTo(FINDS.placeRadius, 6);
  });

  test('日誌には書かない', () => {
    const s = empty();
    const id = spawnFind(s, 0);
    const n = run(s, 30);
    expect(n.journal.filter((e) => !['water'].includes(e.kind))).toHaveLength(0);
    pickFind(n, id, T0);
    expect(n.journal.filter((e) => !['water'].includes(e.kind))).toHaveLength(0);
  });
});

describe('保存', () => {
  test('版7のデータは標本が空のまま読める。拾いものは書き出して読み直しても同じ', () => {
    const s = createInitialState(T0);
    const v7 = JSON.parse(JSON.stringify({ ...s, schema: 7, specimens: [] }));
    expect(migrate(v7).specimens).toEqual([]);
    const n = run(empty(), 40);
    const id = n.specimens.find((x) => x.at)!.id;
    pickFind(n, id, T0);
    setFindPhoto(n, id, 'data:image/jpeg;base64,xx');
    expect(migrate(JSON.parse(JSON.stringify(n))).specimens).toEqual(n.specimens);
    // 画像の data URL でない写真は捨てる
    const bad = JSON.parse(JSON.stringify(n));
    bad.specimens.find((x: { id: number }) => x.id === id).photo = "x'); background: url('http://example.com/";
    expect(migrate(bad).specimens.find((x) => x.id === id)!.photo).toBeNull();
  });

  test('読めない物だけを除く', () => {
    const n = run(empty(), 40);
    const raw = JSON.parse(JSON.stringify(n));
    const count = raw.specimens.length;
    raw.specimens.push({ id: 99, variant: 'glass-gold', seed: 1 }, { id: 98, variant: 'glass-blue', seed: 2, at: { jar: 7 } }, 'x');
    const m = migrate(raw);
    expect(m.specimens).toHaveLength(count);
  });
});
