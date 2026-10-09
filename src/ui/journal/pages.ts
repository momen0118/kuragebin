// 観察日誌のページを作る（DOM に依存しない）。
// 1日1ページ。日は餌と同じく朝4時で区切る（夜が途中で切れない）。ページの中は瓶ごとに小見出しを置いて分ける。
// 同じ日・同じ瓶・同じ時間帯・同じ出来事はまとめる。名前のある個体の出来事は、ほかとまとめずに名前で書く。
// 時間帯は明け方・昼・夕方・夜の四つで、時刻は出さない。数は漢数字。淡々と書き、感嘆符や顔文字は使わない。
import { JOURNAL, SUN } from '../../config';
import { feedDay } from '../../sim/feed';
import { sunTimes, type SunTimes } from '../../sim/sun';
import type { GameState, JournalEntry, JournalKind, Letter, Stage } from '../../sim/state';
import { STAGE_LABELS } from '../labels';

export type Daypart = 'dawn' | 'day' | 'dusk' | 'night';

export interface JarSection {
  /** 瓶の番号。瓶によらない行（おじさんの手紙）は -1 */
  jar: number;
  /** 「一番の瓶」など。瓶によらない行は空 */
  title: string;
  lines: string[];
}

export interface DayPage {
  /** 餌の日（feedDay）。新しい日ほど大きい */
  key: number;
  /** 「9月27日」 */
  title: string;
  sections: JarSection[];
  /** この日に届いた（開いた）手紙の番号。ページにクリップで留める */
  letters: number[];
}

export interface PageOptions {
  /** その日の日の出・日の入り（端末の現地時刻、時）。確かめるときに差し替える */
  sun?: (date: Date) => SunTimes;
  /** 手紙（封を開いたものだけ、届いた日のページに留める） */
  letters?: readonly Letter[];
}

const DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 漢数字（十・百・千を使う書き方。1 → 一、12 → 十二、20 → 二十、105 → 百五） */
export function kanji(n: number): string {
  const v = Math.max(0, Math.floor(n));
  if (v === 0) return DIGITS[0]!;
  let out = '';
  const units: Array<[number, string]> = [
    [1000, '千'],
    [100, '百'],
    [10, '十'],
  ];
  let rest = v % 10000;
  if (v >= 10000) out += `${kanji(Math.floor(v / 10000))}万`;
  for (const [u, mark] of units) {
    const d = Math.floor(rest / u);
    rest %= u;
    if (d === 0) continue;
    out += (d === 1 ? '' : DIGITS[d]!) + mark;
  }
  if (rest > 0) out += DIGITS[rest]!;
  return out;
}

/** 瓶の呼び名（0 → 一番の瓶） */
export function jarTitle(jar: number): string {
  return `${kanji(jar + 1)}番の瓶`;
}

/** 餌の日（feedDay の数）から「9月27日」 */
export function dayTitle(key: number): string {
  const m = Math.floor(key / 100) % 100;
  const d = key % 100;
  return `${m}月${d}日`;
}

function defaultSun(date: Date): SunTimes {
  return sunTimes(date, SUN.latitude, SUN.longitude);
}

/** 端末の時刻（ミリ秒）の時間帯。明け方・昼・夕方は日の出・日の入りから決め、それ以外は夜 */
export function daypartOf(wallMs: number, sun: (date: Date) => SunTimes = defaultSun): Daypart {
  const d = new Date(wallMs);
  const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  const { sunrise, sunset } = sun(d);
  if (h >= sunrise - JOURNAL.dawnBefore / 60 && h < sunrise + JOURNAL.dawnAfter / 60) return 'dawn';
  if (h >= sunrise + JOURNAL.dawnAfter / 60 && h < sunset - JOURNAL.duskBefore / 60) return 'day';
  if (h >= sunset - JOURNAL.duskBefore / 60 && h < sunset + JOURNAL.duskAfter / 60) return 'dusk';
  return 'night';
}

/** 時間帯の書き出し。後ろに名前が続くときは読点を入れる（「夜のうちに、ぽこから…」） */
function lead(part: Daypart, named: boolean): string {
  switch (part) {
    case 'dawn':
      return '明け方、';
    case 'day':
      return named ? '昼のうちに、' : '昼のうちに';
    case 'dusk':
      return '夕方、';
    case 'night':
      return named ? '夜のうちに、' : '夜のうちに';
  }
}

/** 出来事の本文（時間帯を除く） */
function body(kind: JournalKind, count: number, name: string | null): string {
  const n = kanji(count);
  switch (kind) {
    case 'polyp':
      return count > 1 ? `瓶底にポリプが${n}つ付いた` : '瓶底にポリプが付いた';
    case 'strobila':
      if (name) return `${name}がくびれ始めた`;
      return count > 1 ? `ポリプが${n}つくびれ始めた` : 'ポリプがくびれ始めた';
    case 'release':
      return name ? `${name}からエフィラが${n}匹離れた` : `エフィラが${n}匹離れた`;
    case 'adult':
      if (name) return `${name}が成体になった`;
      return count > 1 ? `エフィラが${n}匹、成体になった` : 'エフィラが成体になった';
    case 'rest':
      return name ? `瓶がいっぱいで、${name}が触手を畳んだ` : '瓶がいっぱいで、ポリプが触手を畳んだ';
    case 'wake':
      return name ? `${name}がまた触手を広げた` : 'ポリプがまた触手を広げた';
    case 'water':
      return '水を替えた';
    case 'sent':
      return name ? `${name}を、おじさんのところへ送った` : `${n}匹、おじさんのところへ送った`;
    case 'letter':
      return count > 1 ? `おじさんから手紙が${n}通届いた` : 'おじさんから手紙が届いた';
    case 'firstLetter':
      return '手紙が届いていた';
  }
}

/** 時間帯を書かない出来事（おじさんとのやりとり） */
const NO_LEAD: ReadonlySet<JournalKind> = new Set(['sent', 'letter', 'firstLetter']);

/** 1行の文（時間帯・出来事・数・名前から） */
export function lineText(part: Daypart, kind: JournalKind, count: number, name: string | null): string {
  if (NO_LEAD.has(kind)) return body(kind, count, name);
  // 休み・再開の行は「瓶がいっぱいで」から始まるので、名前が前に来ない
  const named = name !== null && kind !== 'rest';
  return lead(part, named) + body(kind, count, name);
}

/** 数を足してまとめる出来事（休み・再開・水換えは、まとめても一行のまま数えない） */
const COUNTED: ReadonlySet<JournalKind> = new Set(['polyp', 'strobila', 'release', 'adult', 'sent', 'letter']);
const KINDS: ReadonlySet<string> = new Set(['polyp', 'strobila', 'release', 'adult', 'rest', 'wake', 'water', 'sent', 'letter', 'firstLetter']);

interface Group {
  part: Daypart;
  kind: JournalKind;
  name: string | null;
  count: number;
}

/** 日誌の出来事からページを作る。新しい日が先 */
export function journalPages(entries: readonly JournalEntry[], opts: PageOptions = {}): DayPage[] {
  const sun = opts.sun ?? defaultSun;
  const days = new Map<number, Map<number, Map<string, Group>>>();
  for (const e of entries) {
    if (!KINDS.has(e.kind)) continue;
    const key = feedDay(e.wallTime);
    const part = daypartOf(e.wallTime, sun);
    let jars = days.get(key);
    if (!jars) days.set(key, (jars = new Map()));
    let groups = jars.get(e.jar);
    if (!groups) jars.set(e.jar, (groups = new Map()));
    // 時間帯を書かない出来事は、時間帯によらずまとめる
    const id = `${NO_LEAD.has(e.kind) ? '' : part}|${e.kind}|${e.name ?? ''}`;
    const g = groups.get(id);
    if (g) {
      if (COUNTED.has(e.kind)) g.count += e.count;
    } else {
      groups.set(id, { part, kind: e.kind, name: e.name, count: COUNTED.has(e.kind) ? e.count : 1 });
    }
  }
  // 手紙は届いた日のページに留める（封を開いたものだけ）。出来事のない日でもページを作る
  const letters = new Map<number, number[]>();
  for (const l of opts.letters ?? []) {
    if (l.sealed) continue;
    const key = feedDay(l.wallTime);
    if (!days.has(key)) days.set(key, new Map());
    let list = letters.get(key);
    if (!list) letters.set(key, (list = []));
    list.push(l.id);
  }
  return [...days.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([key, jars]) => ({
      key,
      title: dayTitle(key),
      // 瓶によらない行（おじさん）が先
      sections: [...jars.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([jar, groups]) => ({
          jar,
          title: jar < 0 ? '' : jarTitle(jar),
          // まとめた行は、はじめに起きた順
          lines: [...groups.values()].map((g) => lineText(g.part, g.kind, g.count, g.name)),
        })),
      letters: letters.get(key) ?? [],
    }));
}

export interface RosterRow {
  id: number;
  name: string | null;
  /** 種の名前と段階の名前 */
  species: string;
  stage: string;
  /** この瓶に来た日（「9月27日」。日は朝4時で区切る） */
  arrived: string;
}

export interface RosterPage {
  /** 瓶の番号。送った子のページは -1 */
  jar: number;
  title: string;
  rows: RosterRow[];
}

const SPECIES: Record<string, string> = { aurelia: 'ミズクラゲ' };

/** 個体一覧：瓶ごとに、来た順。おじさんへ送った子がいれば、最後に「送った子」（送った順、日は送った日） */
export function rosterPages(state: GameState): RosterPage[] {
  const jars = rosterJars(state);
  if (!state.sent.length) return jars;
  const sent: RosterPage = {
    jar: -1,
    title: '送った子',
    rows: [...state.sent]
      .sort((a, b) => a.sentAt - b.sentAt || a.id - b.id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        species: SPECIES[r.species] ?? r.species,
        stage: STAGE_LABELS[r.stage as Stage],
        arrived: dayTitle(feedDay(r.sentWallTime)),
      })),
  };
  return [...jars, sent];
}

function rosterJars(state: GameState): RosterPage[] {
  return state.jars.map((jar, i) => ({
    jar: i,
    title: jarTitle(i),
    rows: [...jar.creatures]
      .sort((a, b) => a.arrivedAt - b.arrivedAt || a.id - b.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        species: SPECIES[c.species] ?? c.species,
        stage: STAGE_LABELS[c.stage as Stage],
        arrived: dayTitle(feedDay(c.arrivedWallTime)),
      })),
  }));
}
