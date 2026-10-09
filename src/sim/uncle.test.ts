import { describe, expect, test } from 'vitest';
import { UNCLE } from '../config';
import { journalPages, rosterPages } from '../ui/journal/pages';
import { letterLines } from '../ui/letters';
import { migrate } from '../storage/schema';
import { advance } from './advance';
import { spawnCreature } from './edit';
import { BASE_GENES } from './genes';
import { createInitialState, SCHEMA_VERSION, type GameState } from './state';
import { canSend, deliverReplyNow, openLetter, rarity, resetFirstLetter, sendCreature, topicOf } from './uncle';

const T0 = new Date(2026, 9, 9, 10).getTime();
const DAY = 86400;

function withAdults(n: number, seed = 1): GameState {
  const s = createInitialState(T0, seed);
  for (let i = 1; i < n; i++) spawnCreature(s, 0, 'adult');
  return s;
}

describe('おじさん：最初の手紙', () => {
  test('新しく始めると、最初の成体と一緒に封筒が瓶の横に置いてある（日誌には書かない）', () => {
    const s = createInitialState(T0);
    expect(s.letters).toHaveLength(1);
    expect(s.letters[0]).toMatchObject({ kind: 'first', sealed: true, jar: 0 });
    expect(s.journal).toHaveLength(0);
    expect(letterLines(s.letters[0]!).join('')).toContain('海には放さないでください');
  });

  test('読むと、その日のページに留まる', () => {
    const s = createInitialState(T0);
    expect(journalPages(s.journal, { letters: s.letters })).toHaveLength(0);
    openLetter(s, s.letters[0]!.id);
    const pages = journalPages(s.journal, { letters: s.letters });
    expect(pages).toHaveLength(1);
    expect(pages[0]!.letters).toEqual([s.letters[0]!.id]);
  });

  test('すでに始めていた人（版6）にも、次に開いたとき封筒が置いてあり、日誌に「手紙が届いていた」', () => {
    const s = advance(createInitialState(T0), 2 * DAY);
    const v6 = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    v6.schema = 6;
    delete v6.letters;
    delete v6.sent;
    delete v6.uncle;
    v6.journalSeen = (v6.journal as unknown[]).length;
    const m = migrate(v6);
    expect(m.schema).toBe(SCHEMA_VERSION);
    expect(m.letters).toHaveLength(1);
    expect(m.letters[0]!.sealed).toBe(true);
    const last = m.journal[m.journal.length - 1]!;
    expect(last.kind).toBe('firstLetter');
    expect(m.journal.length).toBeGreaterThan(m.journalSeen);
    const lines = journalPages(m.journal, { letters: m.letters }).flatMap((p) => p.sections.flatMap((x) => x.lines));
    expect(lines).toContain('手紙が届いていた');
  });
});

describe('おじさん：送る', () => {
  test('送れるのは泳ぐ個体だけ。送ると瓶からいなくなり、送った子として残り、日誌に一行', () => {
    const s = withAdults(1);
    const polyp = spawnCreature(s, 0, 'polyp');
    expect(canSend(s, polyp.id)).toBe('fixed');
    const c = s.jars[0]!.creatures[0]!;
    c.name = 'ぽこ';
    expect(sendCreature(s, c.id)).toBe('sent');
    expect(s.jars[0]!.creatures.some((x) => x.id === c.id)).toBe(false);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ id: c.id, name: 'ぽこ', jar: 0 });
    const lines = journalPages(s.journal).flatMap((p) => p.sections.flatMap((x) => x.lines));
    expect(lines).toContain('ぽこを、おじさんのところへ送った');
    const roster = rosterPages(s);
    expect(roster[roster.length - 1]).toMatchObject({ jar: -1, title: '送った子' });
  });

  test('名無しの子は「一匹、おじさんのところへ送った」。同じ日はまとめる', () => {
    const s = withAdults(3);
    const [a, b] = s.jars[0]!.creatures;
    sendCreature(s, a!.id);
    sendCreature(s, b!.id);
    const lines = journalPages(s.journal).flatMap((p) => p.sections.flatMap((x) => x.lines));
    expect(lines).toContain('二匹、おじさんのところへ送った');
  });

  test('珍しい子ほど返事が届きやすい', () => {
    const count = (genes: typeof BASE_GENES): number => {
      let n = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const s = createInitialState(T0, seed);
        const c = s.jars[0]!.creatures[0]!;
        c.genes = { ...genes };
        sendCreature(s, c.id);
        if (s.uncle.reply) n++;
      }
      return n / 400;
    };
    const plain = count(BASE_GENES);
    const five = count({ ...BASE_GENES, leaves: 5 });
    expect(plain).toBeGreaterThan(UNCLE.replyBase - 0.08);
    expect(plain).toBeLessThan(UNCLE.replyBase + 0.08);
    expect(five).toBeGreaterThan(plain + 0.4);
    expect(rarity({ ...BASE_GENES, hue: 0.9 })).toBeGreaterThan(rarity({ ...BASE_GENES, hue: 0.2 }));
    expect(topicOf({ genes: { ...BASE_GENES, leaves: 5 }, stage: 'adult' })).toBe('five');
    expect(topicOf({ genes: { ...BASE_GENES, hue: 0.8 }, stage: 'adult' })).toBe('pink');
  });

  test('返事は数日後に届き、日誌に一行。手紙は届いた日のページに留まる。返事どうしは数日あける', () => {
    // 五つ葉なら返事はほぼ届く
    let s = withAdults(3, 5);
    for (const c of s.jars[0]!.creatures) c.genes = { ...BASE_GENES, leaves: 5 };
    const ids = s.jars[0]!.creatures.map((c) => c.id);
    sendCreature(s, ids[0]!);
    let tries = 0;
    while (!s.uncle.reply && tries++ < 20) {
      s = withAdults(3, 100 + tries);
      for (const c of s.jars[0]!.creatures) c.genes = { ...BASE_GENES, leaves: 5 };
      sendCreature(s, s.jars[0]!.creatures[0]!.id);
    }
    const due = s.uncle.reply!.dueAt;
    expect(due).toBeGreaterThanOrEqual(UNCLE.replyDelay[0]);
    expect(due).toBeLessThanOrEqual(UNCLE.replyDelay[1]);
    s = advance(s, due + 120);
    const replies = s.letters.filter((l) => l.kind === 'reply');
    expect(replies).toHaveLength(1);
    expect(replies[0]!.topic).toBe('five');
    expect(s.journal.some((e) => e.kind === 'letter')).toBe(true);
    const page = journalPages(s.journal, { letters: s.letters })[0]!;
    expect(page.letters).toContain(replies[0]!.id);
    expect(page.sections[0]!.title).toBe('');
    expect(page.sections[0]!.lines).toContain('おじさんから手紙が届いた');
    // すぐにまた送っても、次の返事は最短の間をあける
    const next = s.jars[0]!.creatures.find((c) => c.stage === 'adult')!;
    sendCreature(s, next.id);
    if (s.uncle.reply) expect(s.uncle.reply.dueAt).toBeGreaterThanOrEqual(s.uncle.lastReplyAt! + UNCLE.minGap);
  });

  test('確認用：最初の手紙を出し直す、返事を今すぐ届ける', () => {
    const s = createInitialState(T0);
    openLetter(s, s.letters[0]!.id);
    resetFirstLetter(s, 1);
    expect(s.letters.filter((l) => l.kind === 'first')).toHaveLength(1);
    expect(s.letters[0]).toMatchObject({ kind: 'first', sealed: true, jar: 1 });
    deliverReplyNow(s);
    expect(s.letters.some((l) => l.kind === 'reply')).toBe(true);
  });

  test('送った記録・手紙があっても、分けて進めて同じ結果', () => {
    const s = withAdults(3, 9);
    for (const c of s.jars[0]!.creatures) c.genes = { ...BASE_GENES, leaves: 3 };
    sendCreature(s, s.jars[0]!.creatures[0]!.id);
    const once = advance(s, 7 * DAY);
    let split = s;
    for (const d of [1234.5, DAY, 3 * DAY, 77]) split = advance(split, d);
    split = advance(split, 7 * DAY - (1234.5 + DAY + 3 * DAY + 77));
    expect(split.letters).toEqual(once.letters);
    expect(split.uncle).toEqual(once.uncle);
  });
});
