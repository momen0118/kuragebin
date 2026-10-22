import { describe, expect, test } from 'vitest';
import { advance } from '../sim/advance';
import { addPhoto, openAllFacts } from '../sim/book';
import { broodNow, editGenes, editSex, spawnCreature, spawnFind } from '../sim/edit';
import { feedJar } from '../sim/feed';
import { pickFind, placeFind } from '../sim/finds';
import { createInitialState, gameNow, wallAt } from '../sim/state';
import { deliverReplyNow, openLetter, sendCreature } from '../sim/uncle';
import { exportState, importAll } from './io';

const T0 = Date.UTC(2026, 9, 1, 3, 0, 0);
const PHOTO = 'data:image/jpeg;base64,AAAA';

/** 瓶・個体・日誌・手紙・送った子・標本・種のページ・設定まで中身の詰まった状態 */
function richState() {
  let s = advance(createInitialState(T0), 9 * 86400);
  const a = spawnCreature(s, 0, 'adult');
  a.name = 'ぽこ';
  editGenes(s, a.id, { set: { hue: 0.8, leaves: 5, warp: 0.6 } });
  editSex(s, a.id, 'female');
  broodNow(s, a.id);
  spawnCreature(s, 1, 'ephyra').progress = 0.6;
  spawnCreature(s, 2, 'strobila');
  s.jars[2]!.planulae.push({ at: s.time + 7200, parent: a.id, genes: { ...a.genes, leaves: 4 } });
  feedJar(s, 0, wallAt(s, gameNow(s)));
  const swimmer = s.jars[1]!.creatures.find((c) => c.stage === 'ephyra')!;
  sendCreature(s, swimmer.id);
  deliverReplyNow(s);
  openLetter(s, s.letters[0]!.id);
  const f = spawnFind(s, 1, 'glass-blue');
  spawnFind(s, 2, 'shell-pink');
  pickFind(s, f, wallAt(s, gameNow(s)));
  s.specimens.find((x) => x.id === f)!.photo = PHOTO;
  placeFind(s, f, 0);
  addPhoto(s, 'aurelia', { creature: a.id, name: 'ぽこ', wallTime: T0 + 1000 });
  openAllFacts(s, T0 + 2000);
  s.book.factsSeen = 3;
  s.journalSeen = 2;
  s.settings = { ...s.settings, lamp: false, sound: true, motion: false, quality: 'medium', room: 'home', jar: 2 };
  s = advance(s, 3600);
  return s;
}

describe('書き出し・読み込み', () => {
  test('瓶・個体・日誌・手紙・送った子・写真・標本・豆知識・設定が、すべて元どおりになる', () => {
    const s = richState();
    // 確かめの前提：中身が本当に入っている
    expect(s.sent).toHaveLength(1);
    expect(s.letters.length).toBeGreaterThanOrEqual(2);
    expect(s.specimens.some((x) => x.photo && x.at?.placed)).toBe(true);
    expect(s.jars.flatMap((j) => j.creatures).some((c) => c.brood)).toBe(true);
    expect(s.jars[2]!.planulae).toHaveLength(1);
    expect(s.journal.length).toBeGreaterThan(0);
    const photos = new Map([[s.book.species[0]!.photos[0]!.id, PHOTO]]);
    const back = importAll(exportState(s, T0, photos));
    expect(back.state).toEqual(s);
    expect(back.photos).toEqual(photos);
  });
});
