// おじさん（最初のミズクラゲをくれた研究者）とのやりとり。海月は逃がさない（海にも放さない）。育ったら、頼まれて送る。
// 送ると、その子は瓶からいなくなり「送った子」として残る。返事は送るたびに必ずではなく、数日後にたまに届く。
// 珍しい子を送ったときほど届きやすく、返事どうしは最短でも数日あける。届いたら日誌に一行、手紙はその日のページに留まる。
// 新しい種（カブトクラゲ）は、始めてから決まった日数で、手紙に添えて一度だけ届く（送らない人にも届くように）。
// 状態をその場で書き換える。
import { LIFE, SEX, UNCLE, type LifeRules } from '../config';
import { speciesRecord } from './book';
import { findCreature } from './edit';
import { record } from './journal';
import { createBolinopsis, freeSwimmerSlots, updateResting } from './lifecycle';
import { withStateRng, type Rng } from './rng';
import { shownSex } from './sex';
import { gameNow, isSwimmer, wallAt, type Creature, type GameState, type Letter, type LetterTopic, type SentRecord, type Species, type SpeciesGenes } from './state';

export type SendResult = 'sent' | 'fixed' | 'missing' | 'last';

/**
 * 送れるか。送れるのは泳ぐ個体（成体・エフィラ）だけ。ポリプとストロビラは瓶底に付いているので送れない。
 * その種の最後の一匹も送れない（送るとその種が瓶からいなくなり、もう戻らないので）
 */
export function canSend(state: GameState, id: number): SendResult {
  const found = findCreature(state, id);
  if (!found) return 'missing';
  if (!isSwimmer(found.creature.stage)) return 'fixed';
  return isLastOfSpecies(state, found.creature) ? 'last' : 'sent';
}

/**
 * その種の最後の一匹か：同じ種がほかに、どの瓶にもどの段階でもいない（瓶底のポリプ・ストロビラも数える）。
 * ミズクラゲは瓶底に付くのを待っているプラヌラ、カブトクラゲは孵るのを待つ卵があれば最後ではない
 */
export function isLastOfSpecies(state: GameState, c: Creature): boolean {
  for (const jar of state.jars) {
    if (jar.creatures.some((x) => x.id !== c.id && x.species === c.species)) return false;
    if (c.species === 'aurelia' && jar.planulae.length > 0) return false;
    // カブトクラゲは、孵るのを待つ卵があれば最後ではない（孵る数は上限に数えてあるので、必ず孵る）
    if (c.species === 'bolinopsis' && jar.eggs.length > 0) return false;
  }
  return true;
}

/**
 * 珍しさ（0〜1）。ミズクラゲ：三つ葉・五つ葉、色味の偏った子、崩しの大きい子ほど。
 * カブトクラゲ：瓶の中で代を重ねた子ほど（見た目より続いたことを珍しがる）。崩しの大きさも少し足す
 */
export function rarity(c: SpeciesGenes & Pick<Creature, 'stage' | 'generation'>): number {
  if (c.species === 'bolinopsis') {
    const g = c.genes;
    const flaw = (g.warp + g.lobeSkew + g.rowJitter) / 3;
    return Math.min(1, (c.generation - 1) * UNCLE.rareGeneration + flaw * UNCLE.rareFlawWeight);
  }
  const genes = c.genes;
  const stage = c.stage;
  let r = 0;
  if (genes.leaves !== 4) r = 1;
  const hue = Math.abs(genes.hue);
  if (hue >= UNCLE.rareHue) r = Math.max(r, 0.5 + 0.5 * Math.min((hue - UNCLE.rareHue) / (1 - UNCLE.rareHue), 1));
  const flaw = (genes.warp + genes.ragged + genes.leafJitter) / 3;
  if (flaw >= UNCLE.rareFlaw) r = Math.max(r, 0.3);
  if (stage === 'ephyra') r = Math.max(r, 0.15);
  return r;
}

/** 返事で触れる特徴：いちばん目立つもの。カブトクラゲの返事はまだ作っていない（送る流れを作る段階で） */
export function topicOf(sent: SpeciesGenes & Pick<SentRecord, 'stage'>): LetterTopic {
  if (sent.species !== 'aurelia') return 'plain';
  const g = sent.genes;
  if (g.leaves === 5) return 'five';
  if (g.leaves === 3) return 'three';
  if (g.hue >= UNCLE.rareHue) return 'pink';
  if (g.hue <= -UNCLE.rareHue) return 'blue';
  if ((g.warp + g.ragged + g.leafJitter) / 3 >= UNCLE.rareFlaw) return 'flawed';
  if (sent.stage === 'ephyra') return 'ephyra';
  return 'plain';
}


/**
 * 個体 id をおじさんのところへ送る。瓶からいなくなり、「送った子」として残る。日誌に一行（名前があれば名前で）。
 * 返事が届くかはここで決める（珍しい子ほど届きやすい）。もう届くことになっている返事があれば、より珍しい子のほうに触れる
 */
export function sendCreature(state: GameState, id: number, rules: LifeRules = LIFE): SendResult {
  const result = canSend(state, id);
  if (result !== 'sent') return result;
  const { jar, creature: c } = findCreature(state, id)!;
  const j = state.jars[jar]!;
  j.creatures = j.creatures.filter((x) => x.id !== id);
  const now = gameNow(state);
  const wall = wallAt(state, now);
  // 雌雄は成体なら残す（エフィラは出さないので null）
  const base = { id: c.id, name: c.name, stage: c.stage, generation: c.generation, sex: shownSex(c), jar, sentAt: now, sentWallTime: wall };
  state.sent.push(c.species === 'aurelia' ? { ...base, species: 'aurelia', genes: { ...c.genes } } : { ...base, species: 'bolinopsis', genes: { ...c.genes } });
  record(state, 'sent', jar, 1, [c.id], wall, c.name);
  updateResting(state, j, jar, rules, null);
  const rare = rarity(c);
  withStateRng(state, (rng) => {
    const u = state.uncle;
    if (u.reply) {
      // もう届くことになっている：より珍しい子のほうに触れる（届く日はそのまま）
      if (rare > u.reply.rarity) u.reply = { ...u.reply, about: c.id, rarity: rare };
      return;
    }
    if (rng.next() >= UNCLE.replyBase + UNCLE.replyRare * rare) return;
    const [lo, hi] = UNCLE.replyDelay;
    let due = now + rng.range(lo, hi);
    if (u.lastReplyAt !== null) due = Math.max(due, u.lastReplyAt + UNCLE.minGap);
    u.reply = { dueAt: due, about: c.id, rarity: rare };
  });
  return 'sent';
}

/** 新しい手紙を足す。gift は手紙に添える個体（新しい種のため。今は使わない） */
export function addLetter(state: GameState, letter: Omit<Letter, 'id'>): Letter {
  const l: Letter = { ...letter, id: state.uncle.nextLetterId++ };
  state.letters.push(l);
  if (l.gift) placeGift(state, l.gift, l.jar);
  return l;
}

/** 手紙に添えられた個体を瓶に入れる（その瓶がいっぱいなら、空きのある瓶へ。どこもいっぱいなら入れない） */
export function placeGift(state: GameState, c: Creature, prefer: number, rules: LifeRules = LIFE): boolean {
  const order = [prefer, ...state.jars.map((_, i) => i).filter((i) => i !== prefer)];
  for (const i of order) {
    const jar = state.jars[i];
    if (!jar) continue;
    const swimmers = jar.creatures.filter((x) => isSwimmer(x.stage)).length;
    if (isSwimmer(c.stage) && swimmers >= rules.maxSwimmers) continue;
    c.arrivedAt = state.time;
    c.arrivedWallTime = wallAt(state, state.time);
    jar.creatures.push(c);
    return true;
  }
  return false;
}

/** 返事を届ける（日誌に一行。手紙は届いた日のページに留まる） */
function deliverReply(state: GameState, wall: number, rng: Rng): void {
  const u = state.uncle;
  if (!u.reply) return;
  const about = state.sent.find((s) => s.id === u.reply!.about) ?? null;
  const topic = about ? topicOf(about) : 'plain';
  addLetter(state, {
    kind: 'reply',
    topic,
    pick: Math.floor(rng.next() * 1000),
    about: about?.id ?? null,
    arrivedAt: state.time,
    wallTime: wall,
    sealed: false,
    jar: state.settings.jar,
    gift: null,
  });
  record(state, 'letter', -1, 1, about ? [about.id] : [], wall);
  u.lastReplyAt = state.time;
  u.reply = null;
}

/** 1刻み：届く時刻になった返事を届ける。新しい種の届く日が来ていれば届ける（advance の刻みごと） */
export function stepUncle(state: GameState, ctx: { rng: Rng; wall: number; rules: LifeRules; watching: number | null }): void {
  const r = state.uncle.reply;
  if (r && state.time >= r.dueAt) deliverReply(state, ctx.wall, ctx.rng);
  for (const species of GIFTS) {
    if (state.uncle.given.includes(species) || state.time < UNCLE.giftAfter[species]) continue;
    stepGift(state, species, ctx);
  }
}

/** おじさんから届く種（届く順） */
const GIFTS = ['bolinopsis'] as const satisfies readonly Species[];

/**
 * 新しい種の入る瓶：何もいない瓶（瓶底のプラヌラもない）が最優先で 1→2→3、なければ泳ぐ個体に空きのある瓶を 1→2→3。どこもなければ null
 */
export function giftJar(state: GameState, rules: LifeRules = LIFE): number | null {
  const empty = state.jars.findIndex((j) => j.creatures.length === 0 && j.planulae.length === 0 && j.eggs.length === 0);
  if (empty >= 0) return empty;
  const free = state.jars.findIndex((j) => freeSwimmerSlots(j, rules) > 0);
  return free >= 0 ? free : null;
}

/**
 * 届く日が来た新しい種：入る瓶があれば、手紙に添えて届ける（その瓶を見ている間は待つ）。
 * どの瓶もいっぱいなら、空きを訊く手紙を一度だけ出して、空くのを待つ
 */
function stepGift(state: GameState, species: (typeof GIFTS)[number], ctx: { rng: Rng; wall: number; rules: LifeRules; watching: number | null }): void {
  const u = state.uncle;
  const jar = giftJar(state, ctx.rules);
  if (jar === null) {
    if (u.asked.includes(species)) return;
    u.asked.push(species);
    addLetter(state, { kind: 'ask', topic: null, pick: 0, about: null, arrivedAt: state.time, wallTime: ctx.wall, sealed: false, jar: state.settings.jar, gift: null });
    record(state, 'letter', -1, 1, [], ctx.wall);
    return;
  }
  if (jar === ctx.watching) return;
  deliverGift(state, species, jar, ctx.wall, ctx.rng, ctx.rules);
}

/** 新しい種を瓶 jar に、手紙（封筒のまま天板に置く）に添えて届ける。届いたのは成熟した成体で、1代目 */
function deliverGift(state: GameState, species: (typeof GIFTS)[number], jar: number, wall: number, rng: Rng, rules: LifeRules): Creature {
  const c = createBolinopsis(state, 'adult', rng, rules, { arrivedWallTime: wall, adultGrowth: 1, adultAge: SEX.matureAfter });
  state.jars[jar]!.creatures.push(c);
  const letter = addLetter(state, {
    kind: 'gift',
    topic: null,
    pick: 0,
    about: null,
    arrivedAt: state.time,
    wallTime: wall,
    sealed: true,
    jar,
    gift: null,
  });
  // 添えた個体は記録として手紙に残す（瓶に入れるのはここで済ませたので、addLetter には渡さない）
  letter.gift = structuredClone(c);
  if (!state.uncle.given.includes(species)) state.uncle.given.push(species);
  // 種のページに、初めて瓶に来た日が付く
  speciesRecord(state, species, wall);
  record(state, 'gift', jar, 1, [c.id], wall, null, species);
  updateResting(state, state.jars[jar]!, jar, rules, null);
  return c;
}

/** 確認用：新しい種を今すぐ届ける（日数を待たない。入る瓶がなければ空きを訊く手紙。見ている瓶でも届ける）。届いた個体の番号か null */
export function deliverGiftNow(state: GameState, species: (typeof GIFTS)[number] = 'bolinopsis', rules: LifeRules = LIFE): number | null {
  const now = gameNow(state);
  const wall = wallAt(state, now);
  return withStateRng(state, (rng) => {
    const jar = giftJar(state, rules);
    if (jar === null) {
      stepGift(state, species, { rng, wall, rules, watching: null });
      return null;
    }
    return deliverGift(state, species, jar, wall, rng, rules).id;
  });
}

/** 封筒を開いた（最初の手紙）。日誌のその日のページに留まる */
export function openLetter(state: GameState, id: number): boolean {
  const l = state.letters.find((x) => x.id === id);
  if (!l || !l.sealed) return false;
  l.sealed = false;
  return true;
}

/** 確認用：最初の手紙を、封筒のまま瓶 jar の横に置き直す（前の最初の手紙は消す） */
export function resetFirstLetter(state: GameState, jar: number): void {
  state.letters = state.letters.filter((l) => l.kind !== 'first');
  const now = gameNow(state);
  addLetter(state, { kind: 'first', topic: null, pick: 0, about: null, arrivedAt: now, wallTime: wallAt(state, now), sealed: true, jar, gift: null });
}

/**
 * 確認用：返事を今すぐ届ける。届くことになっている返事がなければ、いちばん最後に送った子（いなければ誰にも触れない）への返事にする
 */
export function deliverReplyNow(state: GameState): void {
  const now = gameNow(state);
  if (!state.uncle.reply) {
    const last = state.sent[state.sent.length - 1];
    state.uncle.reply = { dueAt: now, about: last?.id ?? -1, rarity: 0 };
  }
  withStateRng(state, (rng) => deliverReply(state, wallAt(state, now), rng));
}
