// おじさん（最初のミズクラゲをくれた研究者）とのやりとり。海月は逃がさない（海にも放さない）。育ったら、頼まれて送る。
// 送ると、その子は瓶からいなくなり「送った子」として残る。返事は送るたびに必ずではなく、数日後にたまに届く。
// 珍しい子を送ったときほど届きやすく、返事どうしは最短でも数日あける。届いたら日誌に一行、手紙はその日のページに留まる。
// 状態をその場で書き換える。
import { LIFE, UNCLE, type LifeRules } from '../config';
import { findCreature } from './edit';
import type { Genes } from './genes';
import { record } from './journal';
import { updateResting } from './lifecycle';
import { createRng, type Rng } from './rng';
import { isSwimmer, wallAt, type Creature, type GameState, type Letter, type LetterTopic, type SentRecord, type Stage } from './state';

export type SendResult = 'sent' | 'fixed' | 'missing';

/** 送れるか。送れるのは泳ぐ個体（成体・エフィラ）だけ。ポリプとストロビラは瓶底に付いているので送れない */
export function canSend(state: GameState, id: number): SendResult {
  const found = findCreature(state, id);
  if (!found) return 'missing';
  return isSwimmer(found.creature.stage) ? 'sent' : 'fixed';
}

/** 珍しさ（0〜1）：三つ葉・五つ葉、色味の偏った子、崩しの大きい子ほど */
export function rarity(genes: Readonly<Genes>, stage: Stage = 'adult'): number {
  let r = 0;
  if (genes.leaves !== 4) r = 1;
  const hue = Math.abs(genes.hue);
  if (hue >= UNCLE.rareHue) r = Math.max(r, 0.5 + 0.5 * Math.min((hue - UNCLE.rareHue) / (1 - UNCLE.rareHue), 1));
  const flaw = (genes.warp + genes.ragged + genes.leafJitter) / 3;
  if (flaw >= UNCLE.rareFlaw) r = Math.max(r, 0.3);
  if (stage === 'ephyra') r = Math.max(r, 0.15);
  return r;
}

/** 返事で触れる特徴：いちばん目立つもの */
export function topicOf(sent: Pick<SentRecord, 'genes' | 'stage'>): LetterTopic {
  const g = sent.genes;
  if (g.leaves === 5) return 'five';
  if (g.leaves === 3) return 'three';
  if (g.hue >= UNCLE.rareHue) return 'pink';
  if (g.hue <= -UNCLE.rareHue) return 'blue';
  if ((g.warp + g.ragged + g.leafJitter) / 3 >= UNCLE.rareFlaw) return 'flawed';
  if (sent.stage === 'ephyra') return 'ephyra';
  return 'plain';
}

function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = createRng(state.rng);
  const out = fn(rng);
  state.rng = rng.state();
  return out;
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
  const now = state.time + state.pending;
  const wall = wallAt(state, now);
  state.sent.push({ id: c.id, name: c.name, species: c.species, stage: c.stage, genes: { ...c.genes }, jar, sentAt: now, sentWallTime: wall });
  record(state, 'sent', jar, 1, [c.id], wall, c.name);
  updateResting(state, j, jar, rules, null);
  const rare = rarity(c.genes, c.stage);
  withRng(state, (rng) => {
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

/** 1刻み：届く時刻になった返事を届ける（advance の刻みごと） */
export function stepUncle(state: GameState, ctx: { rng: Rng; wall: number }): void {
  const r = state.uncle.reply;
  if (r && state.time >= r.dueAt) deliverReply(state, ctx.wall, ctx.rng);
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
  const now = state.time + state.pending;
  addLetter(state, { kind: 'first', topic: null, pick: 0, about: null, arrivedAt: now, wallTime: wallAt(state, now), sealed: true, jar, gift: null });
}

/**
 * 確認用：返事を今すぐ届ける。届くことになっている返事がなければ、いちばん最後に送った子（いなければ誰にも触れない）への返事にする
 */
export function deliverReplyNow(state: GameState): void {
  const now = state.time + state.pending;
  if (!state.uncle.reply) {
    const last = state.sent[state.sent.length - 1];
    state.uncle.reply = { dueAt: now, about: last?.id ?? -1, rarity: 0 };
  }
  withRng(state, (rng) => deliverReply(state, wallAt(state, now), rng));
}
