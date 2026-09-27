// 見ていない間の世話（水換え）。水換えの機能は作らない。誰かが瓶の世話をしている跡としてだけ出る。
// 瓶底にはマリンスノーが少しずつ溜まり、餌の食べ残しが消えると、そのぶん少し増える（餌をやるほど水換えの間隔が短くなる）。
// 溜まったものが一定量に届いた瓶と、餌をやった瓶は、夜中（2〜4時のどこか。瓶と夜ごとに決まる）に水を替え、瓶底が薄く均されて日誌に一行残る。
// 餌をやった瓶はその夜に必ず替える。夜中に餌をやったときは、食べ残しが消えきって少し間を空けてから（夜明け前後になることもある）。
// 一定量に届いただけの瓶は、その時刻に食べ残しが消えきってから間もなければ見送る。どちらも、その瓶を表示していれば次の夜に回す。
// advance.ts の1刻みごとに呼ぶ（状態をその場で書き換える）。
import { CARE } from '../config';
import { record } from './journal';
import type { StepContext } from './lifecycle';
import type { GameState, JarState } from './state';

/** 整数から [0, 1) の値（同じ数からはいつも同じ） */
function hash01(n: number): number {
  let t = (n + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 端末の時刻の日付（年月日を1つの数にしたもの） */
export function dateKey(wall: number): number {
  const d = new Date(wall);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * 瓶 index の水を替える時刻（端末のミリ秒）。wall と同じ日付の夜中（startHour 時から windowHours 時間のどこか）。
 * 瓶と日付ごとに決まっていて、同じ夜なら何度求めても同じ
 */
export function waterTime(wall: number, index: number): number {
  const d = new Date(wall);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), CARE.startHour).getTime();
  return start + hash01(dateKey(wall) * 8 + index) * CARE.windowHours * 3600 * 1000;
}

/** 瓶底の堆積を dt 秒進め、その夜の水換えの時刻を通り過ぎたら水を替える（ctx.wall は刻みの終わりの端末の時刻） */
export function stepCare(state: GameState, jar: JarState, index: number, dt: number, ctx: StepContext): void {
  jar.sediment += (dt * CARE.snowPerDay) / 86400;
  const left = jar.leftover;
  if (left && state.time >= left.goneAt) {
    jar.sediment += left.amount;
    jar.cleanSince = left.goneAt;
    jar.leftover = null;
  }
  const due = isDue(jar, ctx.wall);
  let at = waterTime(ctx.wall, index);
  // 餌をやった瓶は、食べ残しが消えきって少し間を空けるまで待ってから替える
  const gone = jar.leftover?.goneAt ?? jar.cleanSince;
  if (due && gone !== null) at = Math.max(at, ctx.wall + (gone - state.time + CARE.settleSeconds) * 1000);
  if (!(ctx.wall - dt * 1000 < at && at <= ctx.wall)) return;
  if (!canChangeWater(state, jar, index, ctx.watching, due)) return;
  jar.sediment = CARE.after;
  jar.waterDue = null;
  record(state, 'water', index, 1, [], ctx.wall);
}

/** 餌をやったので、今夜（端末の時刻 wall の日付の夜中）水を替えることになっているか */
function isDue(jar: JarState, wall: number): boolean {
  return jar.waterDue !== null && dateKey(wall) >= jar.waterDue;
}

/**
 * 今、水を替えられるか：その瓶を見ていなくて、食べ残しが消えきってから間が空いていて、
 * 餌をやったので替えることになっているか、溜まったものが一定量に届いている
 */
export function canChangeWater(
  state: GameState,
  jar: JarState,
  index: number,
  watching: number | null,
  due: boolean,
): boolean {
  if (index === watching) return false;
  if (!due && jar.sediment < CARE.threshold) return false;
  if (jar.leftover) return false;
  return jar.cleanSince === null || state.time - jar.cleanSince >= CARE.settleSeconds - 1e-6;
}
