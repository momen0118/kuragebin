// 生活環。成体は瓶底にポリプを付け、ポリプはくびれてストロビラになり、エフィラを放してポリプに戻る。
// エフィラは育って成体になる。泳ぐ個体が上限に達した瓶では、ポリプは休んで進まない。
// 出来事は日誌に書く。ただし見ている瓶（ctx.watching）の出来事は書かない（見ていたので）。
// advance.ts の1刻みごとに呼ぶ（状態をその場で書き換える）。
import { LIFE, type LifeRules } from '../config';
import { stepCare } from './care';
import { BASE_GENES, inheritGenes } from './genes';
import { growthRate } from './growth';
import { record } from './journal';
import type { Rng } from './rng';
import { isSwimmer, stageRange, wallAt, type Creature, type GameState, type JarState, type Stage } from './state';

export interface JarCounts {
  /** 泳ぐ個体（成体＋エフィラ） */
  swimmers: number;
  /** ストロビラが放す予定のエフィラの数 */
  pending: number;
  /** 瓶底の個体（ポリプ＋ストロビラ） */
  polyps: number;
}

export function jarCounts(jar: JarState): JarCounts {
  let swimmers = 0;
  let pending = 0;
  let polyps = 0;
  for (const c of jar.creatures) {
    if (isSwimmer(c.stage)) swimmers++;
    else {
      polyps++;
      if (c.stage === 'strobila') pending += c.discs;
    }
  }
  return { swimmers, pending, polyps };
}

/** 泳ぐ個体をあと何匹入れられるか（ストロビラが放す予定の数も数える） */
export function freeSwimmerSlots(jar: JarState, rules: LifeRules = LIFE): number {
  const c = jarCounts(jar);
  return Math.max(0, rules.maxSwimmers - c.swimmers - c.pending);
}

/** 段階の長さを選ぶ */
export function pickStageLength(stage: Stage, rng: Rng, rules: LifeRules = LIFE): number {
  const [lo, hi] = stageRange(stage, rules);
  return rng.range(lo, hi);
}

/** 新しい段階に入る（進みは 0 から、長さは選び直す） */
export function enterStage(c: Creature, stage: Stage, rng: Rng, rules: LifeRules = LIFE): void {
  c.stage = stage;
  c.stageAge = 0;
  c.progress = 0;
  c.stageLength = pickStageLength(stage, rng, rules);
  if (stage !== 'strobila') c.discs = 0;
  if (isSwimmer(stage)) c.spot = null;
}

/**
 * 新しい個体を作る（瓶にはまだ入れない）。番号は状態から取る。
 * 来た時刻は今（進めている途中なら、extra に arrivedWallTime として刻みの端末の時刻を渡す）
 */
export function createCreature(state: GameState, stage: Stage, rng: Rng, rules: LifeRules = LIFE, extra: Partial<Creature> = {}): Creature {
  return {
    id: state.nextId++,
    species: 'aurelia',
    stage,
    seed: Math.floor(rng.next() * 2 ** 32) >>> 0,
    age: 0,
    stageAge: 0,
    progress: 0,
    stageLength: pickStageLength(stage, rng, rules),
    arrivedAt: state.time,
    arrivedWallTime: wallAt(state, state.time),
    name: null,
    parent: null,
    spot: null,
    discs: 0,
    meal: null,
    genes: { ...BASE_GENES },
    ...extra,
  };
}

/**
 * 瓶底でポリプが付く場所を選ぶ。ほかのポリプと間隔が取れる所を何回か探し、
 * 見つからなければいちばん離れた所にする。奥行きの差は画面では詰まって見えるので、軽く数える
 */
export function pickSpot(taken: ReadonlyArray<readonly [number, number]>, rng: Rng, rules: LifeRules = LIFE): [number, number] {
  let best: [number, number] = [0, 0];
  let bestD = -Infinity;
  for (let i = 0; i < rules.spotTries; i++) {
    const x = (rng.next() * 2 - 1) * rules.spotMaxX;
    const zMax = Math.sqrt(Math.max(rules.spotRadius ** 2 - x * x, 0));
    const z = (rng.next() * 2 - 1) * zMax;
    let d = Infinity;
    for (const [tx, tz] of taken) d = Math.min(d, Math.hypot(x - tx, (z - tz) * rules.spotDepthWeight));
    if (d >= rules.spotSpacing) return [x, z];
    if (d > bestD) {
      bestD = d;
      best = [x, z];
    }
  }
  return best;
}

function spotsIn(jar: JarState, extra: readonly Creature[] = []): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const c of jar.creatures) if (c.spot) out.push(c.spot);
  for (const c of extra) if (c.spot) out.push(c.spot);
  return out;
}

export interface StepContext {
  rng: Rng;
  rules: LifeRules;
  /** 刻みの終わりの、端末の時刻（ミリ秒）。日誌の出来事に付ける */
  wall: number;
  /** 画面で見ている瓶（開いていて表示している瓶）。その瓶の出来事は日誌に書かず、水換えも起きない。閉じていれば null */
  watching: number | null;
}

/** すべての瓶の生活環と瓶底を dt 秒進める */
export function stepLife(state: GameState, dt: number, ctx: StepContext): void {
  state.jars.forEach((jar, i) => {
    stepJar(state, jar, i, dt, ctx);
    stepCare(state, jar, i, dt, ctx);
  });
}

function stepJar(state: GameState, jar: JarState, index: number, dt: number, ctx: StepContext): void {
  const { rng, rules, wall } = ctx;
  // 見ている瓶の出来事は日誌に書かない
  const log = index !== ctx.watching;
  const counts = jarCounts(jar);
  const born: Creature[] = [];
  for (const c of jar.creatures) {
    c.age += dt;
    c.stageAge += dt;
  }
  for (const c of jar.creatures) {
    switch (c.stage) {
      case 'adult': {
        // 約1日ごとに瓶底へポリプを付ける。瓶底がいっぱいなら、空くまで待つ
        c.progress = Math.min(1, c.progress + dt / c.stageLength);
        if (c.progress >= 1 && counts.polyps < rules.maxPolyps) {
          const polyp = createCreature(state, 'polyp', rng, rules, {
            parent: c.id,
            genes: inheritGenes(c.genes, rng, false),
            spot: pickSpot(spotsIn(jar, born), rng, rules),
            arrivedWallTime: wall,
          });
          born.push(polyp);
          counts.polyps++;
          enterStage(c, 'adult', rng, rules);
          if (log) record(state, 'polyp', index, 1, [polyp.id], wall);
        }
        break;
      }
      case 'polyp': {
        // 泳ぐ個体が上限なら休む（進まない）。餌を食べてから1日は少し速い
        const free = rules.maxSwimmers - counts.swimmers - counts.pending;
        if (free <= 0) break;
        c.progress = Math.min(1, c.progress + (dt * growthRate(c, state.time, jar.stirredUntil)) / c.stageLength);
        if (c.progress >= 1) {
          // くびれ始める。放す数は空きの分まで
          const [lo, hi] = rules.ephyraCount;
          const n = Math.min(lo + Math.floor(rng.next() * (hi - lo + 1)), free);
          enterStage(c, 'strobila', rng, rules);
          c.discs = n;
          counts.pending += n;
          if (log) record(state, 'strobila', index, 1, [c.id], wall, c.name);
        }
        break;
      }
      case 'strobila': {
        c.progress = Math.min(1, c.progress + dt / c.stageLength);
        if (c.progress >= 1) {
          // エフィラを放してポリプに戻る。念のため、上限を越える分は放さない
          const room = rules.maxSwimmers - counts.swimmers - (counts.pending - c.discs);
          const n = Math.max(0, Math.min(c.discs, room));
          counts.pending -= c.discs;
          const ids: number[] = [];
          for (let k = 0; k < n; k++) {
            const e = createCreature(state, 'ephyra', rng, rules, { parent: c.id, arrivedWallTime: wall, genes: inheritGenes(c.genes, rng, true) });
            born.push(e);
            ids.push(e.id);
          }
          counts.swimmers += n;
          enterStage(c, 'polyp', rng, rules);
          if (n > 0 && log) record(state, 'release', index, n, ids, wall, c.name);
        }
        break;
      }
      case 'ephyra': {
        // 餌を食べてから1日は少し速く育つ
        c.progress = Math.min(1, c.progress + (dt * growthRate(c, state.time, jar.stirredUntil)) / c.stageLength);
        if (c.progress >= 1) {
          enterStage(c, 'adult', rng, rules);
          if (log) record(state, 'adult', index, 1, [c.id], wall, c.name);
        }
        break;
      }
    }
  }
  if (born.length) jar.creatures.push(...born);
  updateResting(state, jar, index, rules, log ? wall : null);
}

/**
 * 泳ぐ個体が上限で、くびれを待つポリプがいれば「休んでいる」。変わったら日誌に書く（wall が null なら書かない）。
 * 休む・動き出すポリプが1つなら、その名前も書く
 */
export function updateResting(state: GameState, jar: JarState, index: number, rules: LifeRules, wall: number | null): void {
  const counts = jarCounts(jar);
  const waiting = jar.creatures.filter((c) => c.stage === 'polyp');
  const resting = waiting.length > 0 && counts.swimmers + counts.pending >= rules.maxSwimmers;
  if (resting === jar.resting) return;
  jar.resting = resting;
  const name = waiting.length === 1 ? waiting[0]!.name : null;
  if (wall !== null) record(state, resting ? 'rest' : 'wake', index, waiting.length, waiting.map((c) => c.id), wall, name);
}
