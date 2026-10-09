// 確認用の書き換え（デバッグパネルから）。状態をその場で書き換える。
// 上限は見ない（見た目の確認のために、何匹でも出せる）。
import { LIFE, type LifeRules } from '../config';
import { addFind, findSpots } from './finds';
import { createCreature, enterStage, pickSpot, updateResting } from './lifecycle';
import { BASE_GENES, inheritGenes, sanitizeGenes, type Genes } from './genes';
import { createRng, type Rng } from './rng';
import { isSwimmer, wallAt, type Creature, type GameState, type Stage } from './state';

function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = createRng(state.rng);
  const out = fn(rng);
  state.rng = rng.state();
  return out;
}

function spots(state: GameState, jarIndex: number): Array<[number, number]> {
  return [...state.jars[jarIndex]!.creatures.flatMap((c) => (c.spot ? [c.spot] : [])), ...findSpots(state, jarIndex)];
}

export function findCreature(state: GameState, id: number): { jar: number; creature: Creature } | null {
  for (let j = 0; j < state.jars.length; j++) {
    const c = state.jars[j]!.creatures.find((x) => x.id === id);
    if (c) return { jar: j, creature: c };
  }
  return null;
}

/** 確認用に出す個体の年齢（育ちきった姿で出す） */
const GROWN_AGE = 86400;

/** 瓶に、段階を選んで個体を1つ出す（育ちきった姿で） */
export function spawnCreature(state: GameState, jarIndex: number, stage: Stage, rules: LifeRules = LIFE): Creature {
  return withRng(state, (rng) => {
    const jar = state.jars[jarIndex]!;
    const c = createCreature(state, stage, rng, rules, { age: GROWN_AGE, stageAge: GROWN_AGE });
    if (!isSwimmer(stage)) c.spot = pickSpot(spots(state, jarIndex), rng, rules);
    if (stage === 'strobila') c.discs = rules.ephyraCount[1];
    jar.creatures.push(c);
    updateResting(state, jar, jarIndex, rules, null);
    return c;
  });
}

/** 段階を変える（進みは 0 から） */
export function setStage(state: GameState, id: number, stage: Stage, rules: LifeRules = LIFE): void {
  const found = findCreature(state, id);
  if (!found) return;
  const c = found.creature;
  withRng(state, (rng) => {
    enterStage(c, stage, rng, rules);
    if (!isSwimmer(stage) && !c.spot) c.spot = pickSpot(spots(state, found.jar), rng, rules);
    if (stage === 'strobila') c.discs = rules.ephyraCount[1];
  });
  updateResting(state, state.jars[found.jar]!, found.jar, rules, null);
}

/** 今の段階の進みを変える（0〜1） */
export function setProgress(state: GameState, id: number, progress: number): void {
  const c = findCreature(state, id)?.creature;
  if (c) c.progress = Math.min(Math.max(progress, 0), 1);
}

/** ストロビラの皿の数（放すエフィラの数）を変える */
export function setDiscs(state: GameState, id: number, discs: number, rules: LifeRules = LIFE): void {
  const found = findCreature(state, id);
  if (!found || found.creature.stage !== 'strobila') return;
  found.creature.discs = Math.max(1, Math.round(discs));
  updateResting(state, state.jars[found.jar]!, found.jar, rules, null);
}

/** 個体を消す */
export function removeCreature(state: GameState, id: number, rules: LifeRules = LIFE): void {
  const found = findCreature(state, id);
  if (!found) return;
  const jar = state.jars[found.jar]!;
  jar.creatures = jar.creatures.filter((c) => c.id !== id);
  updateResting(state, jar, found.jar, rules, null);
}

/** 餌をやった記録を消す（その日のうちにまたやれる）。jarIndex が null ならすべての瓶 */
export function clearFed(state: GameState, jarIndex: number | null): void {
  state.jars.forEach((jar, i) => {
    if (jarIndex === null || i === jarIndex) jar.fedWallTime = null;
  });
}

/** 瓶底の堆積を value にする（jarIndex が null ならすべての瓶）。食べ残しも消えたことにする（水換えを試すため） */
export function setSediment(state: GameState, jarIndex: number | null, value: number): void {
  state.jars.forEach((jar, i) => {
    if (jarIndex !== null && i !== jarIndex) return;
    jar.sediment = Math.max(0, value);
    jar.leftover = null;
    jar.cleanSince = null;
  });
}

/** 食べた餌を消す（胃の色と成長の早まりがなくなる） */
export function clearMeals(state: GameState): void {
  for (const jar of state.jars) for (const c of jar.creatures) c.meal = null;
}

/** 泳ぐ個体を成体 n 匹にする（エフィラは除く）。瓶底の個体はそのまま */
export function fillAdults(state: GameState, jarIndex: number, n: number, rules: LifeRules = LIFE): void {
  const jar = state.jars[jarIndex]!;
  const adults = jar.creatures.filter((c) => c.stage === 'adult').slice(0, n);
  const bottom = jar.creatures.filter((c) => !isSwimmer(c.stage));
  withRng(state, (rng) => {
    while (adults.length < n) adults.push(createCreature(state, 'adult', rng, rules));
  });
  jar.creatures = [...bottom, ...adults];
  updateResting(state, jar, jarIndex, rules, null);
}

/** 確認用の遺伝子の書き換え：基準に戻す・何世代か受け継いだようにばらす・色味や葉の数を決めて置く */
export type GeneEdit = 'base' | 'generations' | { set: Partial<Genes> };

export function editGenes(state: GameState, id: number, edit: GeneEdit): void {
  const c = findCreature(state, id)?.creature;
  if (!c) return;
  if (edit === 'base') c.genes = { ...BASE_GENES };
  else if (edit === 'generations') {
    withRng(state, (rng) => {
      // 6世代ぶん受け継いだように（葉の数は今のまま）
      const leaves = c.genes.leaves;
      let g = c.genes;
      for (let i = 0; i < 6; i++) g = inheritGenes(g, rng, false);
      c.genes = { ...g, leaves };
    });
  } else c.genes = sanitizeGenes({ ...c.genes, ...edit.set });
}

/** 確認用：瓶 jar の瓶底に拾いものを1つ出す（variant を決めなければ重みで選ぶ）。上限は見ない */
export function spawnFind(state: GameState, jarIndex: number, variant?: string): number {
  return withRng(state, (rng) => addFind(state, jarIndex, rng, wallAt(state, state.time + state.pending), variant).id);
}

/** 確認用：瓶 jar の瓶底の物をすべて消す（null ならすべての瓶）。標本はそのまま */
export function clearFinds(state: GameState, jarIndex: number | null): void {
  state.specimens = state.specimens.filter((s) => !s.at || (jarIndex !== null && s.at.jar !== jarIndex));
}

/** 確認用：標本を空にする（瓶底の物はそのまま） */
export function clearSpecimens(state: GameState): void {
  state.specimens = state.specimens.filter((s) => s.at !== null);
}
