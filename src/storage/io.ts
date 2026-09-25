// 状態の書き出し・読み込み（機種変更用）。JSON に、何のデータかがわかる見出しをつける。
import { migrate, SchemaError } from './schema';
import type { GameState } from '../sim/state';

const APP = 'kuragebin';

export function exportState(state: GameState, nowMs: number): string {
  return JSON.stringify({ app: APP, exportedAt: new Date(nowMs).toISOString(), state }, null, 2);
}

/** 書き出したデータを読み込む。形が違えば SchemaError */
export function importState(text: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SchemaError('JSON として読めません');
  }
  if (typeof parsed !== 'object' || parsed === null || (parsed as { app?: unknown }).app !== APP) {
    throw new SchemaError('海月瓶のデータではありません');
  }
  return migrate((parsed as { state?: unknown }).state);
}
