// 泳ぐ個体の大きさ（傘の半径の倍率。1 が今までの成体の大きさ）。描画とデバッグパネルが使う。
// エフィラは放されたときの大きさから育ち、成体になった直後は育ちきった大きさの ADULT_GROWTH.start ほど。
// そこから数日かけて、はじめは速く、だんだんゆっくり育ちきった大きさ（個体ごとの fullSize）に近づく。
import { ADULT_GROWTH } from '../config';
import type { Creature } from './state';

/** 成体になってからの育ち（0〜1）での、育ちきった大きさに対する割合 */
export function adultSizeFraction(growth: number): number {
  const x = Math.min(Math.max(growth, 0), 1);
  const ease = 1 - (1 - x) * (1 - x);
  return ADULT_GROWTH.start + (1 - ADULT_GROWTH.start) * ease;
}

/**
 * 形の大きさ（render/jelly/form.ts の半径）に掛ける倍率。エフィラは育ち具合（progress）につれて 1 から
 * 成体になった直後の大きさへ寄せる（放されたときの大きさはそのまま、成体になるところで大きさがつながる）
 */
export function bodySize(c: Pick<Creature, 'stage' | 'progress' | 'adultGrowth' | 'fullSize'>): number {
  if (c.stage === 'adult') return c.fullSize * adultSizeFraction(c.adultGrowth);
  if (c.stage === 'ephyra') {
    const end = c.fullSize * ADULT_GROWTH.start;
    return 1 + (end - 1) * Math.min(Math.max(c.progress, 0), 1);
  }
  return 1;
}
