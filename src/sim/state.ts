// ゲームの状態。瓶・個体・日誌・標本・設定を1つの状態として持ち、そのまま保存する。
// 描画・DOM・three.js には依存しない。
import { SIM } from '../config';
import { createRng } from './rng';

/** 保存形式の版。形を変えたら上げて、storage/schema.ts にマイグレーションを足す */
export const SCHEMA_VERSION = 1;

export type Species = 'aurelia';
export type Stage = 'polyp' | 'strobila' | 'ephyra' | 'adult';

export interface Creature {
  /** 保存データの中で一意な番号 */
  id: number;
  species: Species;
  stage: Stage;
  /** 見た目と動きの種（個体差はフェーズ4で遺伝子に広げる） */
  seed: number;
  /** 生まれてからの時間と、今の段階になってからの時間（秒、ゲーム内） */
  age: number;
  stageAge: number;
  /** この瓶に来た時刻（ゲーム内の経過秒） */
  arrivedAt: number;
  /** 名前（初期値なし） */
  name: string | null;
}

export interface JarState {
  creatures: Creature[];
}

/** 観察日誌の一文（フェーズ3） */
export interface JournalEntry {
  /** 出来事の時刻（ゲーム内の経過秒）と、端末の時刻（ミリ秒） */
  time: number;
  wallTime: number;
  text: string;
}

/** 拾いもの（フェーズ4） */
export interface Specimen {
  id: number;
  kind: string;
  foundAt: number;
}

export interface Settings {
  /** 夜のデスクライト */
  lamp: boolean;
  /** 音（初期オフ、フェーズ4） */
  sound: boolean;
  /** 揺れを使う（フェーズ3） */
  motion: boolean;
  /** 画質（フェーズ4） */
  quality: 'high' | 'medium' | 'low';
}

export interface GameState {
  schema: number;
  /** 乱数の内部状態。同じ状態と経過から同じ結果になる */
  rng: number;
  /** ゲームを始めてからの経過（秒）と、固定刻みに満たない端数（秒） */
  time: number;
  pending: number;
  /** 最後に進めた時点の端末の時刻（ミリ秒）と、始めた時刻 */
  lastTick: number;
  createdAt: number;
  /** 次に使う個体の番号 */
  nextId: number;
  jars: JarState[];
  journal: JournalEntry[];
  specimens: Specimen[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  lamp: true,
  sound: false,
  motion: true,
  quality: 'high',
};

/** 最初の状態：1番の瓶にミズクラゲの成体が1匹。2番と3番は水だけ */
export function createInitialState(nowMs: number, seed: number = SIM.seed): GameState {
  const rng = createRng(seed);
  const first: Creature = {
    id: 1,
    species: 'aurelia',
    stage: 'adult',
    seed: Math.floor(rng.next() * 2 ** 32) >>> 0,
    age: 0,
    stageAge: 0,
    arrivedAt: 0,
    name: null,
  };
  const jars: JarState[] = Array.from({ length: SIM.jarCount }, (_, i) => ({ creatures: i === 0 ? [first] : [] }));
  return {
    schema: SCHEMA_VERSION,
    rng: rng.state(),
    time: 0,
    pending: 0,
    lastTick: nowMs,
    createdAt: nowMs,
    nextId: 2,
    jars,
    journal: [],
    specimens: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}
