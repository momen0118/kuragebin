import { describe, expect, test } from 'vitest';
import { BOOK } from '../config';
import { Game } from '../game';
import { exportState, importAll } from '../storage/io';
import { memoryPhotos, memoryStore } from '../storage/db';
import { advance } from './advance';
import { addPhoto, checkFacts, FACT_KEYS, hasNewFacts, markFactsSeen, noteFact, removePhoto, replacePhoto } from './book';
import { Clock } from './clock';
import { spawnCreature } from './edit';
import { createInitialState, type GameState } from './state';

const T0 = new Date(2026, 9, 1, 12).getTime();
const DAY = 86400;
const keys = (s: GameState): string[] => s.book.species[0]!.facts.map((f) => f.key);
const meta = (wallTime = T0) => ({ creature: 1, name: null, wallTime });

describe('豆知識', () => {
  test('始めたばかりは何もない。状態から分かるきっかけは、満たしたときに見つけた日つきで一行ずつ増える', () => {
    const s = createInitialState(T0);
    expect(checkFacts(s, T0)).toBe(false);
    expect(keys(s)).toEqual([]);
    spawnCreature(s, 0, 'polyp');
    expect(checkFacts(s, T0 + 1000)).toBe(true);
    expect(keys(s)).toEqual(['polyp']);
    expect(s.book.species[0]!.facts[0]!.wallTime).toBe(T0 + 1000);
    // 二度目は増えない
    expect(checkFacts(s, T0 + 2000)).toBe(false);
  });

  test('すでに遊んでいるデータからは、分かるものをまとめて足す（日付はその日）', () => {
    const s = advance(createInitialState(T0), 14 * DAY);
    s.book.species[0]!.facts = [];
    checkFacts(s, T0 + 99);
    const k = keys(s);
    for (const key of ['polyp', 'strobila', 'release', 'grown']) expect(k).toContain(key);
    expect(s.book.species[0]!.facts.every((f) => f.wallTime === T0 + 99)).toBe(true);
    // 餌の回数は分からないので、まだ
    expect(k).not.toContain('feed1');
  });

  test('餌の回数（1・3・5回目）と、起き直りを見た回数（5回目）', () => {
    const s = createInitialState(T0);
    for (let n = 1; n <= 5; n++) {
      s.book.counts.feeds = n;
      checkFacts(s, T0);
    }
    expect(keys(s)).toEqual(['feed1', 'feed3', 'feed5']);
    s.book.counts.righted = BOOK.rightedFor - 1;
    checkFacts(s, T0);
    expect(keys(s)).not.toContain('righted5');
    s.book.counts.righted = BOOK.rightedFor;
    checkFacts(s, T0);
    expect(keys(s)).toContain('righted5');
  });

  test('画面の出来事のきっかけは noteFact で一度だけ。未読は種のページを開くと消える', () => {
    const s = createInitialState(T0);
    expect(hasNewFacts(s)).toBe(false);
    expect(noteFact(s, 'poke', T0)).toBe(true);
    expect(noteFact(s, 'poke', T0 + 5)).toBe(false);
    expect(hasNewFacts(s)).toBe(true);
    expect(markFactsSeen(s)).toBe(true);
    expect(hasNewFacts(s)).toBe(false);
  });

  test('文面はどのきっかけにもある', async () => {
    const { FACT_TEXT } = await import('../ui/journal/facts');
    for (const k of FACT_KEYS) expect(FACT_TEXT[k].length).toBeGreaterThan(5);
  });
});

describe('種のページの写真', () => {
  test('6枚まで。いっぱいなら入れ替える（同じ場所に）。はがせる', () => {
    const s = createInitialState(T0);
    const ids: number[] = [];
    for (let i = 0; i < BOOK.maxPhotos; i++) {
      const r = addPhoto(s, 'aurelia', meta());
      expect(r.result).toBe('added');
      ids.push(r.id);
    }
    expect(addPhoto(s, 'aurelia', meta()).result).toBe('full');
    const fresh = replacePhoto(s, ids[2]!, { creature: 9, name: 'ぽこ', wallTime: T0 + 1 });
    const photos = s.book.species[0]!.photos;
    expect(photos[2]).toMatchObject({ id: fresh, creature: 9, name: 'ぽこ' });
    expect(photos).toHaveLength(BOOK.maxPhotos);
    expect(removePhoto(s, ids[0]!)).toBe(true);
    expect(photos).toHaveLength(BOOK.maxPhotos - 1);
    expect(new Set(photos.map((p) => p.id)).size).toBe(photos.length);
  });

  test('Game：写真は状態とは別に保存し、書き出し・読み込みで一緒に運ぶ。開き直しても残る', async () => {
    const store = memoryStore();
    const photos = memoryPhotos();
    const g = await Game.start(new Clock(() => T0), store, photos);
    expect(g.addPhoto('aurelia', 'data:image/jpeg;base64,AAAA', meta())).toBe('added');
    const id = g.state.book.species[0]!.photos[0]!.id;
    expect(g.photo(id)).toBe('data:image/jpeg;base64,AAAA');
    await g.save();
    // 状態には画像を入れない
    expect(JSON.stringify(await store.load())).not.toContain('AAAA');
    const again = await Game.start(new Clock(() => T0), store, photos);
    expect(again.photo(id)).toBe('data:image/jpeg;base64,AAAA');
    // 書き出し → 別の端末で読み込む
    const json = again.exportJson();
    const other = await Game.start(new Clock(() => T0), memoryStore(), memoryPhotos());
    other.importJson(json);
    expect(other.photo(id)).toBe('data:image/jpeg;base64,AAAA');
    expect(other.state.book.species[0]!.photos.map((p) => p.id)).toEqual([id]);
    // はがすと画像も消える
    other.removePhoto(id);
    expect(other.photo(id)).toBeUndefined();
  });

  test('読み込み：画像の data URL でないもの、状態にない番号は捨てる', () => {
    const s = createInitialState(T0);
    addPhoto(s, 'aurelia', meta());
    const json = exportState(s, T0, new Map([
      [1, "x'); background:url('http://example.com/"],
      [99, 'data:image/jpeg;base64,BBBB'],
    ]));
    const { photos } = importAll(json);
    expect(photos.size).toBe(0);
  });

  test('Game を開くと「最初に瓶を開いたとき」が足される', async () => {
    const g = await Game.start(new Clock(() => T0), memoryStore(), memoryPhotos());
    expect(keys(g.state)).toContain('open');
    expect(g.newFacts).toBe(true);
  });
});
