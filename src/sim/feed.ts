// 餌。1瓶につき1日1回（端末の現地時刻の朝4時で日を区切る）。瓶にいる全員が食べ、食べた量は餌をやった瞬間に決まる。
// 出す粒の数と、個体ごとに食べる粒の数もここで決める（描画の見せ場はそのとおりに食べて見せる）。
// 食べ残しの粒は瓶底でしばらくして消え、そのぶん瓶底の堆積が少し増える（care.ts）。餌をやった瓶は、その夜に水を替える。
// 食べてから1日の間、エフィラとポリプの進みが少し速くなる（growth.ts）。
// 状態をその場で書き換える。
import { CARE, FEED, FOOD } from '../config';
import { dateKey } from './care';
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

/**
 * 瓶 jar に餌をやる。食べる個体ごとに食べた量を決め、その日はもうやれないようにする。
 * 食べ残しは CARE.leftoverSeconds で消えきり、そのとき瓶底の堆積に足す
 */
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
  const plan = feedingPlan(j, at);
  const amount = (plan.grains - plan.total) * CARE.perGrain + (j.leftover?.amount ?? 0);
  j.leftover = { amount, goneAt: at + CARE.leftoverSeconds };
  // 餌の日（朝4時区切り）が明けるその夜に水を替える。0時を過ぎてからやったなら、その夜のうち
  const night = new Date(wallMs);
  if (night.getHours() >= FEED.dayStartHour) night.setDate(night.getDate() + 1);
  const due = dateKey(night.getTime());
  j.waterDue = j.waterDue === null ? due : Math.min(j.waterDue, due);
  return 'fed';
}

/** 食べた量 1 のときに食べる粒の数：成体、エフィラ（育つほど多い）、ポリプ */
function bitesPerMeal(c: Creature): number {
  if (c.stage === 'adult') return FOOD.bitesAdult;
  if (c.stage === 'ephyra') return FOOD.bitesEphyra[0] + (FOOD.bitesEphyra[1] - FOOD.bitesEphyra[0]) * c.progress;
  if (c.stage === 'polyp') return FOOD.bitesPolyp;
  return 0;
}

export interface FeedingPlan {
  /** 個体ごとに食べる粒の数（餌 at を食べた個体だけ） */
  bites: Map<number, number>;
  /** 食べる粒の合計と、出す粒の数（食べ残しは grains - total） */
  total: number;
  grains: number;
}

/** 餌 at（sim の meal.at）の、出す粒の数と個体ごとに食べる粒の数 */
export function feedingPlan(jar: JarState, at: number): FeedingPlan {
  const bites = new Map<number, number>();
  let total = 0;
  for (const c of jar.creatures) {
    if (!c.meal || c.meal.at !== at) continue;
    const n = Math.max(1, Math.round(c.meal.amount * bitesPerMeal(c)));
    bites.set(c.id, n);
    total += n;
  }
  const grains = Math.min(Math.max(Math.round(total * (1 + FOOD.extra)), FOOD.min), FOOD.max);
  return { bites, total, grains };
}

/** 瓶の個体が最後に食べた餌の時刻（ゲーム内。誰も食べていなければ null） */
export function lastMealAt(jar: JarState): number | null {
  let at: number | null = null;
  for (const c of jar.creatures) if (c.meal && (at === null || c.meal.at > at)) at = c.meal.at;
  return at;
}
