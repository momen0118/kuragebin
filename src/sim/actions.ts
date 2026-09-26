// 利用者の操作による状態の変更：個体を隣の瓶へ移す、名前を付ける。状態をその場で書き換える。
import { LIFE, type LifeRules } from '../config';
import { findCreature } from './edit';
import { freeSwimmerSlots } from './lifecycle';
import { isSwimmer, type GameState } from './state';

/** 名前の長さの上限（文字） */
export const NAME_MAX = 12;

export type MoveResult = 'moved' | 'full' | 'fixed' | 'missing' | 'same';

/**
 * 個体を瓶 toJar へ移せるか。動かせるのは泳ぐ個体（成体・エフィラ）だけで、ポリプとストロビラは瓶底に付いているので動かさない。
 * 移し先の泳ぐ個体（ストロビラが放す予定の数も数える）が上限なら 'full'
 */
export function canMove(state: GameState, id: number, toJar: number, rules: LifeRules = LIFE): MoveResult {
  const found = findCreature(state, id);
  if (!found || !state.jars[toJar]) return 'missing';
  if (found.jar === toJar) return 'same';
  if (!isSwimmer(found.creature.stage)) return 'fixed';
  if (freeSwimmerSlots(state.jars[toJar]!, rules) < 1) return 'full';
  return 'moved';
}

/**
 * 個体を瓶 toJar へ移す。この瓶に来た時刻は今になり、成体の「次のポリプまで」は数えなおす
 * （移した直後に移し先の瓶底へポリプが付かないように）。休みの明けは次の刻みで日誌に書かれる
 */
export function moveCreature(state: GameState, id: number, toJar: number, rules: LifeRules = LIFE): MoveResult {
  const result = canMove(state, id, toJar, rules);
  if (result !== 'moved') return result;
  const found = findCreature(state, id)!;
  const from = state.jars[found.jar]!;
  const c = found.creature;
  from.creatures = from.creatures.filter((x) => x.id !== id);
  c.arrivedAt = state.time;
  if (c.stage === 'adult') c.progress = 0;
  state.jars[toJar]!.creatures.push(c);
  return 'moved';
}

/** 名前を付ける。前後の空白を除き、長すぎれば切る。空なら名無しに戻す */
export function renameCreature(state: GameState, id: number, name: string | null): boolean {
  const c = findCreature(state, id)?.creature;
  if (!c) return false;
  const trimmed = (name ?? '').trim();
  c.name = trimmed ? [...trimmed].slice(0, NAME_MAX).join('') : null;
  return true;
}
