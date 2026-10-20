// 状態の書き出し・読み込み（機種変更用）。JSON に、何のデータかがわかる見出しをつける。
import { migrate, SchemaError } from './schema';
import type { GameState } from '../sim/state';

const APP = 'kuragebin';

/** 種のページの写真として受け付ける形（ページに別のものが入らないように） */
const PHOTO_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** 書き出す。種のページの写真（番号 → 画像）も一緒に */
export function exportState(state: GameState, nowMs: number, photos: ReadonlyMap<number, string> = new Map()): string {
  return JSON.stringify({ app: APP, exportedAt: new Date(nowMs).toISOString(), state, photos: Object.fromEntries(photos) }, null, 2);
}

export interface Imported {
  state: GameState;
  /** 種のページの写真（状態が持っている番号のものだけ） */
  photos: Map<number, string>;
}

/** 書き出したデータを読み込む（写真も）。形が違えば SchemaError */
export function importAll(text: string): Imported {
  const state = importState(text);
  const raw = (JSON.parse(text) as { photos?: unknown }).photos;
  const photos = new Map<number, string>();
  const want = new Set(state.book.species.flatMap((r) => r.photos.map((p) => p.id)));
  if (typeof raw === 'object' && raw !== null) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const id = Number(k);
      if (want.has(id) && typeof v === 'string' && PHOTO_URL.test(v)) photos.set(id, v);
    }
  }
  return { state, photos };
}

/** 書き出したデータを読み込む（状態だけ）。形が違えば SchemaError */
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
