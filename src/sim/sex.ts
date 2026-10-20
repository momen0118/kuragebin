// 雌雄とプラヌラ。見た目と記録だけで、増え方の仕組みは変えない。
// 成体・エフィラは生まれたときにオスかメスかが決まる（半々）。札や一覧には成体になったら出す。成体になってしばらく経つと成熟し、四つ葉の輪の色に少しずつ出る。
// 成熟したメスは、ポリプが付く前にプラヌラを口腕に抱える（生活環から呼ぶ）。状態をその場で書き換えるのは startBrood だけ。
import { SEX } from '../config';
import { createRng, type Rng } from './rng';
import type { Creature, JarState, Sex } from './state';

/** 雌雄を決める（半々） */
export function pickSex(rng: Rng): Sex {
  return rng.next() < SEX.femaleRatio ? 'female' : 'male';
}

/** 個体の種から雌雄を決める（版9までの個体。乱数の並びを変えないため） */
export function sexFromSeed(seed: number): Sex {
  return pickSex(createRng((seed ^ 0x2545f491) >>> 0));
}

/** 成熟しているか（成体になって SEX.matureAfter 経った） */
export function isMature(c: Pick<Creature, 'stage' | 'adultAge'>): boolean {
  return c.stage === 'adult' && c.adultAge >= SEX.matureAfter;
}

/** 札や一覧に出す雌雄：成体になったらオス・メス（成熟を待たない）。エフィラ・ポリプ・ストロビラは null（出さない） */
export function shownSex(c: Pick<Creature, 'stage' | 'sex'>): Sex | null {
  return c.stage === 'adult' ? c.sex : null;
}

/** 四つ葉の輪に雌雄の色がどれだけ出ているか（0〜1）。成熟すると colorStart から、colorRamp かけてはっきりする */
export function sexColorAmount(c: Pick<Creature, 'stage' | 'adultAge' | 'sex'>): number {
  if (!c.sex || !isMature(c)) return 0;
  const t = Math.min((c.adultAge - SEX.matureAfter) / SEX.colorRamp, 1);
  return SEX.colorStart + (1 - SEX.colorStart) * t;
}

/** 抱えている粒の見え方（0〜1）。抱えはじめに少しずつ揃い、終わりのほうで少しずつ減る */
export function broodAmount(c: Pick<Creature, 'brood'>, time: number): number {
  const b = c.brood;
  if (!b || time >= b.until) return 0;
  const grow = Math.min(Math.max((time - b.from) / SEX.broodIn, 0), 1);
  const out = (b.until - b.from) * SEX.broodOut;
  const fade = out > 0 ? Math.min(Math.max((b.until - time) / out, 0), 1) : 1;
  return Math.min(grow, fade);
}

/** プラヌラを抱えられるメス（成熟していて、今は抱えていない） */
export function canBrood(c: Creature): boolean {
  return c.sex === 'female' && isMature(c) && c.brood === null;
}

/** ポリプが付くときに、先にプラヌラを抱えるメス。付けることになった個体 first が抱えられればその個体、なければ瓶の中で最初に見つかったメス */
export function broodMother(jar: JarState, first: Creature): Creature | null {
  if (canBrood(first)) return first;
  return jar.creatures.find(canBrood) ?? null;
}

/** プラヌラを抱えはじめる（time から、SEX.brood の範囲の長さ） */
export function startBrood(c: Creature, time: number, rng: Rng): void {
  c.brood = { from: time, until: time + rng.range(SEX.brood[0], SEX.brood[1]) };
}

/** 瓶底に付くのを待っている分（抱えている分と、離れて付くのを待つ分）。瓶底の数に入れる */
export function reservedSpots(jar: JarState): number {
  let n = jar.planulae.length;
  for (const c of jar.creatures) if (c.brood) n++;
  return n;
}
