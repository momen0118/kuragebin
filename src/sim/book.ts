// 種のページ（図鑑ではない）。見たことのある種についてだけ、眺めた分だけ増えていく。
// 豆知識：きっかけを満たした順に一行ずつ増える（見つけた日を残す）。まだ見ていない行は持たない。増えたら未読（付箋「種」と日誌のアイコンに点）。
// 写真：個体の札から撮った写真を種ごとに6枚まで（ここには名前・撮った日だけ。画像は storage/photos.ts に別に保存する）。
// きっかけは、状態から分かるもの（ポリプがいる・日誌に水換えがある・餌をやった回数など）と、画面の出来事（つついた・虫眼鏡を当てた・逆さまから起き直った・プラヌラを抱えた個体を見た）。
// 状態から分かるものは、進めたあとにまとめて確かめる（すでに遊んでいるデータでも、次に開いたときにまとめて増える。日付はその日）。
// 状態をその場で書き換える。
import { BOOK, UNCLE } from '../config';
import type { GameState, Species } from './state';

/** 豆知識のきっかけ（ミズクラゲ） */
export const AURELIA_FACT_KEYS = [
  'open',
  'page',
  'feed1',
  'feed3',
  'feed5',
  'poke',
  'loupe',
  'polyp',
  'polyps3',
  'strobila',
  'release',
  'loupeEphyra',
  'grown',
  'flip',
  'righted5',
  'move',
  'leaves',
  'water',
  'reply',
  'planula',
] as const;

/**
 * 豆知識のきっかけ（カブトクラゲ）：初めて届いた・虫眼鏡を成体に当てた・夜にライトを切り替えた・成体が育ちきった・起き直るのを見た・
 * 餌（1回・5回）・虫眼鏡を幼生に当てた・幼生が成体になった・崩しの大きい子・種のページを開いた・返事が来た・初めて卵を産んだ・初めて孵った・三代目が生まれた
 */
export const BOLINOPSIS_FACT_KEYS = [
  'bArrive',
  'bLoupe',
  'bLamp',
  'bGrown',
  'bRighted',
  'bFeed1',
  'bFeed5',
  'bLoupeLarva',
  'bAdult',
  'bFlawed',
  'bPage',
  'bReply',
  'bEggs',
  'bHatch',
  'bThird',
] as const;

export const FACT_KEYS = [...AURELIA_FACT_KEYS, ...BOLINOPSIS_FACT_KEYS] as const;

export type FactKey = (typeof FACT_KEYS)[number];

const BOLINOPSIS_SET: ReadonlySet<string> = new Set(BOLINOPSIS_FACT_KEYS);

/** その豆知識の載る種のページ */
export function factSpecies(key: FactKey): Species {
  return BOLINOPSIS_SET.has(key) ? 'bolinopsis' : 'aurelia';
}

export interface FactRecord {
  key: FactKey;
  /** 見つけた日（端末のミリ秒） */
  wallTime: number;
}

export interface SpeciesPhoto {
  /** 画像の番号（storage/photos.ts の鍵） */
  id: number;
  /** 写っている個体と、撮ったときのその名前（なければ null。送った子・もういない子の写真もそのまま残る） */
  creature: number | null;
  name: string | null;
  /** 撮った日（端末のミリ秒） */
  wallTime: number;
}

export interface SpeciesRecord {
  species: Species;
  /** 初めて瓶に来た日（端末のミリ秒） */
  since: number;
  facts: FactRecord[];
  /** 写真（BOOK.maxPhotos まで） */
  photos: SpeciesPhoto[];
}

export interface BookState {
  species: SpeciesRecord[];
  /** 読んだ豆知識の数（これより多ければ未読。付箋「種」と日誌のアイコンに点） */
  factsSeen: number;
  /** きっかけに回数が要るもの：餌をやった回数、逆さまから起き直るのを見た回数（ミズクラゲ）、カブトクラゲのいる瓶に餌をやった回数 */
  counts: { feeds: number; righted: number; bolinopsisFeeds: number };
  /** 次に使う写真の番号 */
  nextPhotoId: number;
}

export function createBook(since: number): BookState {
  return { species: [{ species: 'aurelia', since, facts: [], photos: [] }], factsSeen: 0, counts: { feeds: 0, righted: 0, bolinopsisFeeds: 0 }, nextPhotoId: 1 };
}

/** 種の記録（なければ作る。初めて瓶に来た日は since） */
export function speciesRecord(state: GameState, species: Species, since: number): SpeciesRecord {
  let r = state.book.species.find((x) => x.species === species);
  if (!r) {
    r = { species, since, facts: [], photos: [] };
    state.book.species.push(r);
  }
  return r;
}

/** 豆知識をもう見つけているか */
export function hasFact(state: GameState, key: FactKey): boolean {
  const species = factSpecies(key);
  return state.book.species.some((r) => r.species === species && r.facts.some((f) => f.key === key));
}

/** 確認用：すべての豆知識を開く（見つけた日は wall。種のページがある種だけ）、すべて閉じる */
export function openAllFacts(state: GameState, wall: number): void {
  for (const k of FACT_KEYS) if (state.book.species.some((r) => r.species === factSpecies(k))) noteFact(state, k, wall);
}

export function closeAllFacts(state: GameState): void {
  for (const r of state.book.species) r.facts = [];
  state.book.factsSeen = 0;
}

/** 豆知識を、その種のページに足す（もうあれば何もしない）。足したら true */
export function noteFact(state: GameState, key: FactKey, wall: number): boolean {
  const r = speciesRecord(state, factSpecies(key), wall);
  if (r.facts.some((f) => f.key === key)) return false;
  r.facts.push({ key, wallTime: wall });
  return true;
}

/** 見つけた豆知識の数（すべての種） */
export function factCount(state: GameState): number {
  return state.book.species.reduce((n, r) => n + r.facts.length, 0);
}

/** 未読の豆知識があるか */
export function hasNewFacts(state: GameState): boolean {
  return factCount(state) > state.book.factsSeen;
}

/** 状態から分かるきっかけ（すでに満たしていれば、まとめて足す）。何か足したら true */
export function checkFacts(state: GameState, wall: number): boolean {
  const r = speciesRecord(state, 'aurelia', state.createdAt);
  const has = new Set(r.facts.map((f) => f.key));
  const want: FactKey[] = [];
  const need = (k: FactKey, ok: () => boolean): void => {
    if (!has.has(k) && ok()) want.push(k);
  };
  const creatures = state.jars.flatMap((j) => j.creatures);
  const journal = (kind: string): boolean => state.journal.some((e) => e.kind === kind);
  const c = state.book.counts;
  const [f1, f3, f5] = BOOK.feedsFor;
  need('feed1', () => c.feeds >= f1);
  need('feed3', () => c.feeds >= f3);
  need('feed5', () => c.feeds >= f5);
  need('polyp', () => creatures.some((x) => x.stage === 'polyp' || x.stage === 'strobila') || journal('polyp'));
  need('polyps3', () => state.jars.some((j) => j.creatures.filter((x) => x.stage === 'polyp' || x.stage === 'strobila').length >= BOOK.polypsFor));
  need('strobila', () => creatures.some((x) => x.stage === 'strobila') || journal('strobila'));
  need('release', () => creatures.some((x) => x.stage === 'ephyra') || journal('release'));
  // 成体のうち親のいる子は、エフィラから育った子
  need('grown', () => creatures.some((x) => x.stage === 'adult' && x.parent !== null) || journal('adult'));
  need('righted5', () => c.righted >= BOOK.rightedFor);
  need('leaves', () => creatures.some((x) => x.species === 'aurelia' && x.genes.leaves !== 4) || state.sent.some((x) => x.species === 'aurelia' && x.genes.leaves !== 4));
  need('water', () => journal('water'));
  need('reply', () => state.letters.some((l) => l.kind === 'reply'));
  for (const k of want) noteFact(state, k, wall);
  return checkBolinopsisFacts(state, wall) || want.length > 0;
}

/** カブトクラゲの、状態から分かるきっかけ（カブトクラゲが届いていれば） */
function checkBolinopsisFacts(state: GameState, wall: number): boolean {
  const r = state.book.species.find((x) => x.species === 'bolinopsis');
  if (!r) return false;
  const has = new Set<string>(r.facts.map((f) => f.key));
  const want: FactKey[] = [];
  const need = (k: FactKey, ok: () => boolean): void => {
    if (!has.has(k) && ok()) want.push(k);
  };
  const kabuto = state.jars.flatMap((j) => j.creatures).filter((x) => x.species === 'bolinopsis');
  const sent = state.sent.filter((x) => x.species === 'bolinopsis');
  const journal = (kind: string): boolean => state.journal.some((e) => e.kind === kind && e.species === 'bolinopsis');
  // 瓶で生まれた子がいれば、卵を産んで孵ったことがある（見ていた瓶の出来事は日誌に書かないので、個体からも確かめる）
  const born = kabuto.some((x) => x.parent !== null) || sent.some((x) => x.generation > 1);
  const flaw = (g: { warp: number; lobeSkew: number; rowJitter: number }): number => (g.warp + g.lobeSkew + g.rowJitter) / 3;
  const [f1, f5] = BOOK.bolinopsisFeedsFor;
  const c = state.book.counts;
  need('bArrive', () => state.uncle.given.includes('bolinopsis') || kabuto.length > 0);
  // 届いた子は育ちきって届くので、瓶で生まれた子が育ちきったとき
  need('bGrown', () => kabuto.some((x) => x.stage === 'adult' && x.parent !== null && x.adultGrowth >= 1));
  need('bFeed1', () => c.bolinopsisFeeds >= f1);
  need('bFeed5', () => c.bolinopsisFeeds >= f5);
  need('bAdult', () => kabuto.some((x) => x.stage === 'adult' && x.parent !== null) || journal('adult'));
  need('bFlawed', () => [...kabuto, ...sent].some((x) => x.species === 'bolinopsis' && flaw(x.genes) >= UNCLE.rareFlaw));
  need('bReply', () => state.letters.some((l) => l.kind === 'reply' && sent.some((x) => x.id === l.about)));
  need('bEggs', () => state.jars.some((j) => j.eggs.length > 0) || journal('eggs') || born);
  need('bHatch', () => journal('hatch') || born);
  need('bThird', () => [...kabuto, ...sent].some((x) => x.generation >= BOOK.bolinopsisGeneration));
  for (const k of want) noteFact(state, k, wall);
  return want.length > 0;
}

/** すべての豆知識を読んだことにする（種のページを開いたとき） */
export function markFactsSeen(state: GameState): boolean {
  const n = factCount(state);
  if (state.book.factsSeen === n) return false;
  state.book.factsSeen = n;
  return true;
}

export type PhotoResult = 'added' | 'full';

/** 種のページに写真を貼る（いっぱいなら 'full'。そのときは replace で入れ替える） */
export function addPhoto(state: GameState, species: Species, photo: Omit<SpeciesPhoto, 'id'>): { result: PhotoResult; id: number } {
  const r = speciesRecord(state, species, photo.wallTime);
  if (r.photos.length >= BOOK.maxPhotos) return { result: 'full', id: -1 };
  const id = state.book.nextPhotoId++;
  r.photos.push({ id, ...photo });
  return { result: 'added', id };
}

/** 写真 oldId を新しい写真と入れ替える（同じ場所に）。入れ替えた新しい番号（なければ -1） */
export function replacePhoto(state: GameState, oldId: number, photo: Omit<SpeciesPhoto, 'id'>): number {
  for (const r of state.book.species) {
    const i = r.photos.findIndex((p) => p.id === oldId);
    if (i < 0) continue;
    const id = state.book.nextPhotoId++;
    r.photos[i] = { id, ...photo };
    return id;
  }
  return -1;
}

/** 写真をはがす。はがしたら true */
export function removePhoto(state: GameState, id: number): boolean {
  for (const r of state.book.species) {
    const i = r.photos.findIndex((p) => p.id === id);
    if (i < 0) continue;
    r.photos.splice(i, 1);
    return true;
  }
  return false;
}

/** 状態が持っている写真の番号（保存した画像のうち、これにないものは消す） */
export function photoIds(state: GameState): Set<number> {
  return new Set(state.book.species.flatMap((r) => r.photos.map((p) => p.id)));
}
