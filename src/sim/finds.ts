// 拾いもの（4-2）。貝殻のかけら・シーグラス・小石が、見ていない間にまれに瓶底に現れる（入れ替えた水に混じっていたもの）。
// 1瓶あたり平均 FINDS.meanDays 日に1つ。水換えとは関係なく日数で決め、見ている瓶には現れない。
// タップで拾うと日誌の標本に移り（初めて拾った日と写真を残す）、標本から瓶へ戻して飾れる。置いた物をタップするとまた標本へ。
// 1瓶に合わせて FINDS.maxPerJar まで、そのうち自分で置いた物は FINDS.maxPlaced まで（置いた物がある瓶では、現れる物はその分少ない）。
// 揺らしても動かない。日誌には書かない。現れるかどうかは刻みと瓶から決まる別の乱数で決め、生活環の乱数の並びは変えない。
// 状態をその場で書き換える。
import { FIND_VARIANTS, FINDS, SIM } from '../config';
import { createRng, type Rng } from './rng';
import type { FindKind, GameState, Specimen } from './state';

/** 2つの整数から [0, 1) の値（同じ数からはいつも同じ） */
function hash01(a: number, b: number): number {
  let t = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 瓶 jar の瓶底にある物（現れたまま・自分で置いた物） */
export function findsIn(state: GameState, jar: number): Specimen[] {
  return state.specimens.filter((s) => s.at?.jar === jar);
}

/** 瓶 jar の瓶底にある物の場所（ポリプが付く場所を選ぶときに避ける） */
export function findSpots(state: GameState, jar: number): Array<[number, number]> {
  return findsIn(state, jar).map((s) => s.at!.spot);
}

/** 標本にある物（拾った順） */
export function bookSpecimens(state: GameState): Specimen[] {
  return state.specimens.filter((s) => s.at === null && s.foundAt !== null).sort((a, b) => a.foundAt! - b.foundAt! || a.id - b.id);
}

/** 重みで1つ選ぶ */
function weighted<T extends string>(entries: ReadonlyArray<readonly [T, number]>, u: number): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = u * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x < 0) return k;
  }
  return entries[entries.length - 1]![0];
}

/** 種類と色を選ぶ（種類の重み → その種類の中の色の重み） */
export function pickVariant(rng: Rng): { kind: FindKind; variant: string } {
  const kind = weighted(Object.entries(FINDS.kinds) as Array<[FindKind, number]>, rng.next());
  const variants = Object.entries(FIND_VARIANTS)
    .filter(([, v]) => v.kind === kind)
    .map(([k, v]) => [k, v.weight] as const);
  return { kind, variant: weighted(variants, rng.next()) };
}

/** 奥行きを軽く数えた、瓶底の2点の間 */
function gap(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], (a[1] - b[1]) * FINDS.depthWeight);
}

/** 瓶底で、ほかの物やポリプから離れた所を選ぶ（何回か探し、見つからなければいちばん離れた所） */
export function pickFindSpot(taken: ReadonlyArray<readonly [number, number]>, rng: Rng): [number, number] {
  let best: [number, number] = [0, 0];
  let bestD = -Infinity;
  for (let i = 0; i < FINDS.tries; i++) {
    const x = (rng.next() * 2 - 1) * FINDS.spotMaxX;
    const zMax = Math.sqrt(Math.max(FINDS.spotRadius ** 2 - x * x, 0));
    const z = (rng.next() * 2 - 1) * zMax;
    let d = Infinity;
    for (const t of taken) d = Math.min(d, gap([x, z], t));
    if (d >= FINDS.spacing) return [x, z];
    if (d > bestD) {
      bestD = d;
      best = [x, z];
    }
  }
  return best;
}

/** 次の番号 */
function nextId(state: GameState): number {
  return state.specimens.reduce((m, s) => Math.max(m, s.id), 0) + 1;
}

/** 瓶 jar の、ポリプ（ストロビラ）とほかの物の場所 */
function takenIn(state: GameState, jar: number, except: number | null = null): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const c of state.jars[jar]?.creatures ?? []) if (c.spot) out.push(c.spot);
  for (const s of findsIn(state, jar)) if (s.id !== except) out.push(s.at!.spot);
  return out;
}

/** 瓶 jar の瓶底に、勝手に現れた物を1つ置く（variant を決めなければ重みで選ぶ）。time・wall は現れた時刻 */
export function addFind(state: GameState, jar: number, rng: Rng, wall: number, variant?: string): Specimen {
  const picked = variant && FIND_VARIANTS[variant] ? { kind: FIND_VARIANTS[variant]!.kind, variant } : pickVariant(rng);
  const s: Specimen = {
    id: nextId(state),
    kind: picked.kind,
    variant: picked.variant,
    seed: Math.floor(rng.next() * 2 ** 32) >>> 0,
    at: { jar, spot: pickFindSpot(takenIn(state, jar), rng), yaw: rng.range(0, Math.PI * 2), placed: false },
    appearedAt: state.time,
    appearedWallTime: wall,
    foundAt: null,
    foundWallTime: null,
    photo: null,
  };
  state.specimens.push(s);
  return s;
}

/** 瓶 jar に、あといくつ勝手に現れてよいか（自分で置いた物がある瓶では、その分少ない） */
export function freeFindSlots(state: GameState, jar: number): number {
  return Math.max(0, FINDS.maxPerJar - findsIn(state, jar).length);
}

export interface FindStepContext {
  /** 刻みの終わりの端末の時刻（ミリ秒） */
  wall: number;
  /** 画面で見ている瓶（そこには現れない）。閉じていれば null */
  watching: number | null;
}

/**
 * 1刻み（dt 秒、state.time は刻みの終わり）ぶん進める：見ていない瓶に、まれに拾いものが現れる。
 * 現れるかどうかと中身は、刻みの番号・瓶・始めた時刻から決まる乱数で選ぶ（生活環の乱数の並びは変えない）
 */
export function stepFinds(state: GameState, dt: number, ctx: FindStepContext): void {
  const chance = 1 - Math.exp(-dt / (FINDS.meanDays * 86400));
  const n = Math.round(state.time / SIM.stepSeconds);
  const salt = Math.floor(state.createdAt / 1000) | 0;
  for (let j = 0; j < state.jars.length; j++) {
    if (j === ctx.watching) continue;
    if (hash01(n * 8 + j, salt) >= chance) continue;
    if (freeFindSlots(state, j) < 1) continue;
    const rng = createRng(Math.floor(hash01(n * 8 + j, salt ^ 0x5bd1e995) * 2 ** 32) >>> 0);
    addFind(state, j, rng, ctx.wall);
  }
}

/** 瓶底の物を拾って標本へ移す。初めて拾ったなら、その時刻（ゲーム内の秒と端末のミリ秒）を残す。拾えたら true */
export function pickFind(state: GameState, id: number, wall: number): boolean {
  const s = state.specimens.find((x) => x.id === id);
  if (!s?.at) return false;
  s.at = null;
  if (s.foundAt === null) {
    s.foundAt = state.time + state.pending;
    s.foundWallTime = wall;
  }
  return true;
}

/** 初めて拾ったときの写真を貼る（もう貼ってあれば何もしない） */
export function setFindPhoto(state: GameState, id: number, photo: string): boolean {
  const s = state.specimens.find((x) => x.id === id);
  if (!s || s.photo !== null) return false;
  s.photo = photo;
  return true;
}

export type PlaceResult = 'placed' | 'full' | 'missing';

/** 標本の物 id を瓶 jar に置けるか（自分で置ける物は1瓶に FINDS.maxPlaced まで） */
export function canPlace(state: GameState, id: number, jar: number): PlaceResult {
  const s = state.specimens.find((x) => x.id === id);
  if (!s || s.at !== null || s.foundAt === null || !state.jars[jar]) return 'missing';
  if (findsIn(state, jar).filter((x) => x.at!.placed).length >= FINDS.maxPlaced) return 'full';
  return 'placed';
}

/**
 * spot がポリプやほかの物に近すぎれば、近くの空いた所へずらす（瓶底の半径 limit の内側で）。
 * 少しずつ遠くを、いくつかの向きで探す。どこも空いていなければ、いちばん離れた所
 */
export function settleSpot(taken: ReadonlyArray<readonly [number, number]>, spot: readonly [number, number], limit: number = FINDS.spotRadius): [number, number] {
  const clampIn = (x: number, z: number): [number, number] => {
    const r = Math.hypot(x, z);
    return r > limit ? [(x / r) * limit, (z / r) * limit] : [x, z];
  };
  const clearance = (p: readonly [number, number]): number => taken.reduce((m, t) => Math.min(m, gap(p, t)), Infinity);
  let best = clampIn(spot[0], spot[1]);
  let bestD = clearance(best);
  if (bestD >= FINDS.placeSpacing) return best;
  const steps = 14;
  const angles = 16;
  for (let i = 1; i <= steps; i++) {
    const d = (i / steps) * limit;
    for (let k = 0; k < angles; k++) {
      const a = (k / angles) * Math.PI * 2;
      // 奥行きの向きは画面では詰まって見えるので、そのぶん大きく動かす
      const p = clampIn(spot[0] + Math.cos(a) * d, spot[1] + (Math.sin(a) * d) / FINDS.depthWeight);
      const c = clearance(p);
      if (c >= FINDS.placeSpacing) return p;
      if (c > bestD) {
        bestD = c;
        best = p;
      }
    }
  }
  return best;
}

/**
 * 標本の物 id を、瓶 jar の瓶底の spot に置く（ポリプやほかの物に近ければ、近くの空いた所へずらす）。
 * 置いた物は揺らしても動かない。日誌には書かない
 */
export function placeFind(state: GameState, id: number, jar: number, spot: readonly [number, number], yaw: number): PlaceResult {
  const result = canPlace(state, id, jar);
  if (result !== 'placed') return result;
  const s = state.specimens.find((x) => x.id === id)!;
  s.at = { jar, spot: settleSpot(takenIn(state, jar), spot, FINDS.placeRadius), yaw, placed: true };
  return 'placed';
}
