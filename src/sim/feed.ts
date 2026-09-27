// 餌。1瓶につき1日1回（端末の現地時刻の朝4時で日を区切る）。瓶にいる全員が食べ、食べた量は餌をやった瞬間に決まる。
// 食べてから1日の間、エフィラとポリプの進みが少し速くなる（lifecycle.ts が growthRate を掛ける）。
// 状態をその場で書き換える。
import { FEED } from '../config';
import { createRng } from './rng';
import type { Creature, GameState, JarState } from './state';

export type FeedResult = 'fed' | 'already' | 'empty' | 'missing';

/**
 * 餌の「日」（年月日を1つの数にしたもの）。端末の現地時刻で、朝 dayStartHour 時から次の日の同じ時刻まで。
 * 夜ふかしで0時をまたいでも同じ日に数える
 */
export function feedDay(wallMs: number): number {
  const d = new Date(wallMs);
  if (d.getHours() < FEED.dayStartHour) d.setDate(d.getDate() - 1);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** 餌を食べる段階か。ストロビラは触手を縮めているので食べない */
export function eats(c: Creature): boolean {
  return c.stage !== 'strobila';
}

/**
 * 瓶 jar に、端末の時刻 wallMs に餌をやれるか（'fed' ならやれる）。
 * 食べる個体がいない瓶と、その日にもうやった瓶にはやれない
 */
export function canFeed(state: GameState, jar: number, wallMs: number): FeedResult {
  const j = state.jars[jar];
  if (!j) return 'missing';
  if (!j.creatures.some(eats)) return 'empty';
  if (j.fedWallTime !== null && feedDay(j.fedWallTime) === feedDay(wallMs)) return 'already';
  return 'fed';
}

/** 瓶 jar に餌をやる。食べる個体ごとに食べた量を決め、その日はもうやれないようにする */
export function feedJar(state: GameState, jar: number, wallMs: number): FeedResult {
  const result = canFeed(state, jar, wallMs);
  if (result !== 'fed') return result;
  const j = state.jars[jar]!;
  j.fedWallTime = wallMs;
  const rng = createRng(state.rng);
  // 刻みに満たない端数も入れて、やった時刻そのものにする
  const at = state.time + state.pending;
  const [lo, hi] = FEED.amount;
  for (const c of j.creatures) if (eats(c)) c.meal = { at, amount: rng.range(lo, hi) };
  state.rng = rng.state();
  return 'fed';
}

/**
 * 食べた餌による、段階の進みの速さの倍率。食べてから boostSeconds の間だけ、
 * エフィラ（成体になるまで）とポリプ（くびれ始めるまで）が速くなる。time はゲーム内の今（刻みの終わり）
 */
export function growthRate(c: Creature, time: number): number {
  if (!c.meal || (c.stage !== 'ephyra' && c.stage !== 'polyp')) return 1;
  const since = time - c.meal.at;
  return since > 0 && since <= FEED.boostSeconds ? 1 + FEED.growthBoost * c.meal.amount : 1;
}

/** 瓶の個体が最後に食べた餌の時刻（ゲーム内。誰も食べていなければ null） */
export function lastMealAt(jar: JarState): number | null {
  let at: number | null = null;
  for (const c of jar.creatures) if (c.meal && (at === null || c.meal.at > at)) at = c.meal.at;
  return at;
}
