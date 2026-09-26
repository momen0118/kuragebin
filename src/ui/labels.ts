// 画面に出す言葉（段階の名前など）。
import type { Stage } from '../sim/state';

export const STAGE_LABELS: Record<Stage, string> = {
  polyp: 'ポリプ',
  strobila: 'ストロビラ',
  ephyra: 'エフィラ',
  adult: '成体',
};

/** 名前のない個体 */
export const UNNAMED = '名無し';
