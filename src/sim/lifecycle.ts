// 生活環。成体は瓶底にポリプを付け、ポリプはくびれてストロビラになり、エフィラを放してポリプに戻る。
// エフィラは育って成体になる。泳ぐ個体が上限に達した瓶では、ポリプは休んで進まない。
// 出来事は日誌に書く。ただし見ている瓶（ctx.watching）の出来事は書かない（見ていたので）。
// advance.ts の1刻みごとに呼ぶ（状態をその場で書き換える）。
import { ADULT_GROWTH, CTENO, LIFE, SEX, type LifeRules } from '../config';
import { stepCare } from './care';
import { takenSpots } from './finds';
import { BASE_BOLINOPSIS_GENES, BASE_GENES, inheritBolinopsisGenes, inheritGenes } from './genes';
import { growthRate } from './growth';
import { record } from './journal';
import type { Rng } from './rng';
import { broodMother, pickSex, reservedSpots, startBrood } from './sex';
import { isSwimmer, stageRange, wallAt, type AureliaCreature, type BolinopsisCreature, type Creature, type CreatureBase, type EggClutch, type GameState, type JarState, type Planula, type Species, type Stage } from './state';

export interface JarCounts {
  /** 泳ぐ個体（成体・エフィラ・幼生） */
  swimmers: number;
  /** これから泳ぎだす予定の数：ストロビラが放す予定のエフィラと、カブトクラゲの卵から孵る予定の幼生 */
  pending: number;
  /** 瓶底の個体（ポリプ＋ストロビラ）と、これから付くプラヌラ（抱えている分と、離れて付くのを待つ分） */
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
  for (const e of jar.eggs) pending += e.count;
  return { swimmers, pending, polyps: polyps + reservedSpots(jar) };
}

/** 泳ぐ個体をあと何匹入れられるか（ストロビラが放す予定の数と、卵から孵る予定の数も数える） */
export function freeSwimmerSlots(jar: JarState, rules: LifeRules = LIFE): number {
  const c = jarCounts(jar);
  return Math.max(0, rules.maxSwimmers - c.swimmers - c.pending);
}

/** 段階の長さを選ぶ（成体の長さは種で違う） */
export function pickStageLength(stage: Stage, rng: Rng, rules: LifeRules = LIFE, species: Species = 'aurelia'): number {
  const [lo, hi] = stageRange(stage, rules, species);
  return rng.range(lo, hi);
}

/**
 * 新しい段階に入る（進みは 0 から、長さは選び直す）。成体が次のポリプへ数えなおすときも呼ぶ（成体になってからの時間はそのまま）。
 * 泳ぐ段階で雌雄がまだなければ決める（確認用に段階を変えたとき）。瓶底の段階は雌雄を持たない
 */
export function enterStage(c: Creature, stage: Stage, rng: Rng, rules: LifeRules = LIFE): void {
  c.stage = stage;
  c.stageAge = 0;
  c.progress = 0;
  c.stageLength = pickStageLength(stage, rng, rules, c.species);
  if (stage !== 'strobila') c.discs = 0;
  if (isSwimmer(stage)) c.spot = null;
  if (stage !== 'adult') {
    c.adultAge = 0;
    c.adultGrowth = 0;
    c.brood = null;
  }
  // 雌雄があるのはミズクラゲだけ（カブトクラゲは雌雄同体）
  if (!isSwimmer(stage) || c.species !== 'aurelia') c.sex = null;
  else if (c.sex === null) c.sex = pickSex(rng);
}

/** 種によらないところ。乱数は 種 → 段階の長さ → 雌雄（withSex のとき）→ 育ちきった大きさ の順に引く（並びを変えると結果が変わる） */
function baseCreature(state: GameState, stage: Stage, rng: Rng, rules: LifeRules, species: Species): CreatureBase {
  const withSex = species === 'aurelia';
  const seed = Math.floor(rng.next() * 2 ** 32) >>> 0;
  const stageLength = pickStageLength(stage, rng, rules, species);
  // 成体・エフィラは生まれたときに雌雄が決まる。育ちきった大きさも生まれたときに決まる
  const sex = withSex && isSwimmer(stage) ? pickSex(rng) : null;
  const fullSize = rng.range(ADULT_GROWTH.fullSize[0], ADULT_GROWTH.fullSize[1]);
  return {
    id: state.nextId++,
    stage,
    seed,
    age: 0,
    stageAge: 0,
    progress: 0,
    stageLength,
    arrivedAt: state.time,
    arrivedWallTime: wallAt(state, state.time),
    name: null,
    parent: null,
    spot: null,
    discs: 0,
    meal: null,
    generation: 1,
    sex,
    adultAge: 0,
    brood: null,
    adultGrowth: 0,
    fullSize,
  };
}

/**
 * 新しいミズクラゲを作る（瓶にはまだ入れない）。番号は状態から取る。
 * 来た時刻は今（進めている途中なら、extra に arrivedWallTime として刻みの端末の時刻を渡す）。代は extra で渡さなければ1代目
 */
export function createCreature(state: GameState, stage: Stage, rng: Rng, rules: LifeRules = LIFE, extra: Partial<AureliaCreature> = {}): AureliaCreature {
  return { ...baseCreature(state, stage, rng, rules, 'aurelia'), species: 'aurelia', genes: { ...BASE_GENES }, ...extra };
}

/** 新しいカブトクラゲを作る（瓶にはまだ入れない）。雌雄同体なので雌雄は持たない */
export function createBolinopsis(state: GameState, stage: Stage, rng: Rng, rules: LifeRules = LIFE, extra: Partial<BolinopsisCreature> = {}): BolinopsisCreature {
  return { ...baseCreature(state, stage, rng, rules, 'bolinopsis'), species: 'bolinopsis', genes: { ...BASE_BOLINOPSIS_GENES }, ...extra };
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

/** 瓶底でふさがっている場所（新しいポリプはここを避ける）。extra はこの刻みに付いて、まだ瓶に入れていないポリプ */
function spotsIn(state: GameState, index: number, extra: readonly Creature[] = []): Array<[number, number]> {
  const out = takenSpots(state, index);
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
        c.adultAge += dt;
        // 成体になってからも、数日かけて育ちきった大きさへ
        c.adultGrowth = Math.min(1, c.adultGrowth + dt / ADULT_GROWTH.seconds);
        // カブトクラゲ：成熟すると、数日ごとに卵を産む。孵る数を上限に数え、空きがなければ産まずに待つ（日誌には書かない）
        if (c.species === 'bolinopsis') {
          if (c.adultAge < SEX.matureAfter) break;
          c.progress = Math.min(1, c.progress + dt / c.stageLength);
          if (c.progress < 1) break;
          const free = rules.maxSwimmers - counts.swimmers - counts.pending;
          if (free <= 0) break;
          const clutch = layEggs(state, c, rng, rules, free);
          jar.eggs.push(clutch);
          counts.pending += clutch.count;
          enterStage(c, 'adult', rng, rules);
          if (log) record(state, 'eggs', index, 1, [c.id], wall, c.name, 'bolinopsis');
          break;
        }
        // 抱えていたプラヌラの粒がなくなった：しばらくして、今いる瓶の瓶底に付く
        if (c.brood && state.time >= c.brood.until) {
          jar.planulae.push({
            at: state.time + rng.range(SEX.settle[0], SEX.settle[1]),
            parent: c.id,
            genes: inheritGenes(c.genes, rng, false),
            generation: c.generation + 1,
          });
          c.brood = null;
        }
        // 約1日ごとに瓶底へポリプを付ける。瓶底がいっぱいなら、空くまで待つ
        c.progress = Math.min(1, c.progress + dt / c.stageLength);
        if (c.progress < 1 || counts.polyps >= rules.maxPolyps) break;
        // 成熟したメスがいれば、先にそのメスが口腕にプラヌラを抱える（瓶がいっぱいでポリプが休んでいる間は抱えない）。
        // 抱えられるメスがいなければ、今まで通りそのまま付く
        const mother = jar.resting ? null : broodMother(jar, c);
        if (mother) {
          startBrood(mother, state.time, rng);
          counts.polyps++;
          enterStage(c, 'adult', rng, rules);
          if (log) record(state, 'planula', index, 1, [mother.id], wall, mother.name);
          break;
        }
        const polyp = createCreature(state, 'polyp', rng, rules, {
          parent: c.id,
          genes: inheritGenes(c.genes, rng, false),
          spot: pickSpot(spotsIn(state, index, born), rng, rules),
          arrivedWallTime: wall,
          generation: c.generation + 1,
        });
        born.push(polyp);
        counts.polyps++;
        enterStage(c, 'adult', rng, rules);
        if (log) record(state, 'polyp', index, 1, [polyp.id], wall);
        break;
      }
      case 'polyp': {
        if (c.species !== 'aurelia') break;
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
        if (c.species !== 'aurelia') break;
        c.progress = Math.min(1, c.progress + dt / c.stageLength);
        if (c.progress >= 1) {
          // エフィラを放してポリプに戻る。念のため、上限を越える分は放さない
          const room = rules.maxSwimmers - counts.swimmers - (counts.pending - c.discs);
          const n = Math.max(0, Math.min(c.discs, room));
          counts.pending -= c.discs;
          const ids: number[] = [];
          for (let k = 0; k < n; k++) {
            // ポリプの分身なので、代はそのポリプと同じ
            const e = createCreature(state, 'ephyra', rng, rules, {
              parent: c.id,
              arrivedWallTime: wall,
              genes: inheritGenes(c.genes, rng, true),
              generation: c.generation,
            });
            born.push(e);
            ids.push(e.id);
          }
          counts.swimmers += n;
          enterStage(c, 'polyp', rng, rules);
          if (n > 0 && log) record(state, 'release', index, n, ids, wall, c.name);
        }
        break;
      }
      case 'larva': {
        // 幼生：育って成体になる（触手を落として口葉が広がる）
        c.progress = Math.min(1, c.progress + (dt * growthRate(c, state.time, jar.stirredUntil)) / c.stageLength);
        if (c.progress >= 1) {
          enterStage(c, 'adult', rng, rules);
          if (log) record(state, 'adult', index, 1, [c.id], wall, c.name, 'bolinopsis');
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
  hatchEggs(state, jar, index, rules, ctx, log);
  settlePlanulae(state, jar, index, rules, ctx, log);
  updateResting(state, jar, index, rules, log ? wall : null);
}

/**
 * カブトクラゲが卵を産む（瓶にはまだ入れない）。孵る数は LIFE.hatchCount の範囲で空き free まで、見せる粒は CTENO.eggs.shown の範囲。
 * 孵った幼生は親の遺伝子を受け継ぎ、代は親の代＋1
 */
export function layEggs(state: GameState, c: BolinopsisCreature, rng: Rng, rules: LifeRules, free: number): EggClutch {
  const [lo, hi] = rules.hatchCount;
  const count = Math.max(1, Math.min(lo + Math.floor(rng.next() * (hi - lo + 1)), free));
  const [slo, shi] = CTENO.eggs.shown;
  return {
    parent: c.id,
    laidAt: state.time,
    hatchAt: state.time + rng.range(rules.eggHatch[0], rules.eggHatch[1]),
    count,
    shown: slo + Math.floor(rng.next() * (shi - slo + 1)),
    seed: Math.floor(rng.next() * 2 ** 32) >>> 0,
    genes: { ...c.genes },
    generation: c.generation + 1,
  };
}

/** 孵る時刻になった卵から幼生を出す（念のため、上限を越える分は孵さない）。日誌に一行 */
function hatchEggs(state: GameState, jar: JarState, index: number, rules: LifeRules, ctx: StepContext, log: boolean): void {
  if (!jar.eggs.length) return;
  const due = jar.eggs.filter((e) => state.time >= e.hatchAt);
  if (!due.length) return;
  jar.eggs = jar.eggs.filter((e) => state.time < e.hatchAt);
  for (const e of due) {
    const n = Math.min(e.count, freeSwimmerSlots(jar, rules));
    if (n <= 0) continue;
    const ids = hatchClutch(state, jar, e, n, ctx.rng, rules, ctx.wall);
    if (log) record(state, 'hatch', index, n, ids, ctx.wall, null, 'bolinopsis');
  }
}

/** 一腹の卵から幼生を n 匹、瓶に入れる。幼生は親の遺伝子を受け継ぎ、代は卵の代。入れた幼生の番号を返す */
export function hatchClutch(state: GameState, jar: JarState, e: EggClutch, n: number, rng: Rng, rules: LifeRules, wall: number): number[] {
  const ids: number[] = [];
  for (let k = 0; k < n; k++) {
    const larva = createBolinopsis(state, 'larva', rng, rules, {
      parent: e.parent,
      genes: inheritBolinopsisGenes(e.genes, rng),
      generation: e.generation,
      arrivedWallTime: wall,
    });
    jar.creatures.push(larva);
    ids.push(larva.id);
  }
  return ids;
}

/** 付く時刻になったプラヌラを瓶底にポリプとして付ける。瓶底がいっぱいなら、空くまで待つ */
function settlePlanulae(state: GameState, jar: JarState, index: number, rules: LifeRules, ctx: StepContext, log: boolean): void {
  if (!jar.planulae.length) return;
  const waiting: Planula[] = [];
  for (const p of jar.planulae) {
    const bottom = jar.creatures.filter((c) => !isSwimmer(c.stage)).length;
    if (state.time < p.at || bottom >= rules.maxPolyps) {
      waiting.push(p);
      continue;
    }
    const polyp = createCreature(state, 'polyp', ctx.rng, rules, {
      parent: p.parent,
      genes: p.genes,
      generation: p.generation,
      spot: pickSpot(takenSpots(state, index), ctx.rng, rules),
      arrivedWallTime: ctx.wall,
    });
    jar.creatures.push(polyp);
    if (log) record(state, 'polyp', index, 1, [polyp.id], ctx.wall);
  }
  jar.planulae = waiting;
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
