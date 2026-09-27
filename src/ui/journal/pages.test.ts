import { describe, expect, test } from 'vitest';
import { advance } from '../../sim/advance';
import { spawnCreature } from '../../sim/edit';
import { createInitialState, type JournalEntry, type JournalKind } from '../../sim/state';
import { daypartOf, journalPages, kanji, rosterPages } from './pages';

/** 端末の現地時刻（ミリ秒）。どの時間帯で走らせても同じになるよう、現地時刻で作る */
const local = (day: number, hour: number, minute = 0): number => new Date(2026, 8, day, hour, minute).getTime();
/** 日の出 5:30、日の入り 17:40 の日（端末の時間帯によらない） */
const sun = (): { sunrise: number; sunset: number } => ({ sunrise: 5.5, sunset: 17 + 40 / 60 });

function entry(kind: JournalKind, jar: number, wall: number, count = 1, name: string | null = null): JournalEntry {
  return { kind, jar, count, ids: [], time: 0, wallTime: wall, name };
}

describe('漢数字', () => {
  test('十・百を使って書く', () => {
    expect([1, 2, 3, 9, 10, 11, 12, 20, 21, 99, 100, 105, 110].map(kanji)).toEqual([
      '一',
      '二',
      '三',
      '九',
      '十',
      '十一',
      '十二',
      '二十',
      '二十一',
      '九十九',
      '百',
      '百五',
      '百十',
    ]);
  });
});

describe('時間帯', () => {
  test('明け方・昼・夕方・夜の四つ', () => {
    expect(daypartOf(local(27, 5, 0), sun)).toBe('dawn');
    expect(daypartOf(local(27, 6, 50), sun)).toBe('dawn');
    expect(daypartOf(local(27, 12, 0), sun)).toBe('day');
    expect(daypartOf(local(27, 17, 0), sun)).toBe('dusk');
    expect(daypartOf(local(27, 18, 30), sun)).toBe('night');
    expect(daypartOf(local(27, 23, 0), sun)).toBe('night');
    expect(daypartOf(local(28, 2, 0), sun)).toBe('night');
  });
});

describe('日誌のページ', () => {
  test('1日1ページ、新しい日が先。夜中の出来事は前の日のページ（朝4時で区切る）', () => {
    const pages = journalPages(
      [entry('polyp', 0, local(26, 12)), entry('release', 0, local(27, 22), 2), entry('water', 0, local(28, 3))],
      { sun },
    );
    expect(pages.map((p) => p.title)).toEqual(['9月27日', '9月26日']);
    expect(pages[0]!.sections[0]!.lines).toEqual(['夜のうちにエフィラが二匹離れた', '夜のうちに水を替えた']);
    expect(pages[1]!.sections[0]!.lines).toEqual(['昼のうちに瓶底にポリプが付いた']);
  });

  test('同じ日・同じ瓶・同じ時間帯・同じ出来事はまとめる。時間帯が違えば分ける', () => {
    const pages = journalPages(
      [
        entry('release', 0, local(27, 20), 1),
        entry('release', 0, local(27, 23), 1),
        entry('release', 0, local(28, 1), 1),
        entry('release', 0, local(28, 5, 20), 1),
      ],
      { sun },
    );
    expect(pages).toHaveLength(2);
    expect(pages[1]!.sections[0]!.lines).toEqual(['夜のうちにエフィラが三匹離れた']);
    expect(pages[0]!.sections[0]!.lines).toEqual(['明け方、エフィラが一匹離れた']);
  });

  test('瓶ごとに小見出しを置いて分ける', () => {
    const pages = journalPages([entry('strobila', 2, local(27, 12)), entry('polyp', 0, local(27, 13)), entry('adult', 0, local(27, 17, 10))], { sun });
    const s = pages[0]!.sections;
    expect(s.map((x) => x.title)).toEqual(['一番の瓶', '三番の瓶']);
    expect(s[0]!.lines).toEqual(['昼のうちに瓶底にポリプが付いた', '夕方、エフィラが成体になった']);
    expect(s[1]!.lines).toEqual(['昼のうちにポリプがくびれ始めた']);
  });

  test('名前のある個体は名前で、ほかとまとめずに書く', () => {
    const pages = journalPages(
      [
        entry('adult', 0, local(27, 17, 0), 1, 'ゆら'),
        entry('adult', 0, local(27, 17, 10), 1),
        entry('adult', 0, local(27, 17, 20), 1),
        entry('release', 0, local(27, 22), 2, 'ぽこ'),
        entry('rest', 0, local(27, 23), 1, 'ぽこ'),
        entry('wake', 0, local(28, 1), 2),
      ],
      { sun },
    );
    expect(pages[0]!.sections[0]!.lines).toEqual([
      '夕方、ゆらが成体になった',
      '夕方、エフィラが二匹、成体になった',
      '夜のうちに、ぽこからエフィラが二匹離れた',
      '夜のうちに瓶がいっぱいで、ぽこが触手を畳んだ',
      '夜のうちにポリプがまた触手を広げた',
    ]);
  });

  test('知らない出来事は書かない', () => {
    const odd = { ...entry('polyp', 0, local(27, 12)), kind: 'visitor' as JournalKind };
    expect(journalPages([odd], { sun })).toEqual([]);
  });
});

describe('個体一覧', () => {
  test('瓶ごとに、来た順。名前・種・段階・来た日', () => {
    const t0 = local(20, 12);
    let s = createInitialState(t0);
    s.jars[0]!.creatures[0]!.name = 'しずく';
    s = advance(s, 3 * 86400);
    const e = spawnCreature(s, 0, 'ephyra');
    const rows = rosterPages(s);
    expect(rows.map((r) => r.title)).toEqual(['一番の瓶', '二番の瓶', '三番の瓶']);
    const first = rows[0]!.rows[0]!;
    expect(first).toMatchObject({ name: 'しずく', species: 'ミズクラゲ', stage: '成体', arrived: '9月20日' });
    // 新しく出した個体はいちばん後ろ
    expect(rows[0]!.rows.at(-1)!.id).toBe(e.id);
    expect(rows[0]!.rows.at(-1)!.arrived).toBe('9月23日');
    expect(rows[1]!.rows).toEqual([]);
  });
});
