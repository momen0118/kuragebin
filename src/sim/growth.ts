// 段階の進みの早まり。餌（食べてから1日、エフィラとポリプ）と、瓶を揺らしたこと（数時間、エフィラだけ）。
// 二つは足すが、上限（GROWTH.cap）を分け合う。餌で上限に届いている日は、揺らしても何も足されない。
// 瓶を揺らしたことは状態に「水が動いている間」（stirredUntil）として持つ。何度揺らしても量は増えず、時間が延びるだけ。
// 状態をその場で書き換える。
import { FEED, GROWTH, STIR } from '../config';
import type { Creature, GameState } from './state';

/**
 * 段階の進みの速さの倍率。time はゲーム内の今（刻みの終わり）、stirredUntil はその瓶の水が動いている間の終わり（なければ null）
 */
export function growthRate(c: Creature, time: number, stirredUntil: number | null = null): number {
  let boost = 0;
  if (c.meal && (c.stage === 'ephyra' || c.stage === 'polyp')) {
    const since = time - c.meal.at;
    if (since > 0 && since <= FEED.boostSeconds) boost += FEED.growthBoost * c.meal.amount;
  }
  if (c.stage === 'ephyra' && stirredUntil !== null && time <= stirredUntil && time > stirredUntil - STIR.seconds) boost += STIR.boost;
  return 1 + Math.min(boost, GROWTH.cap);
}

/** 瓶 jar を揺らした：今から STIR.seconds の間、水が動いている（前の分は延ばすだけで重ならない）。瓶がなければ false */
export function stirJar(state: GameState, jar: number): boolean {
  const j = state.jars[jar];
  if (!j) return false;
  j.stirredUntil = state.time + state.pending + STIR.seconds;
  return true;
}
