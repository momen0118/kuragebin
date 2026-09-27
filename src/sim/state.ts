// ゲームの状態。瓶・個体・日誌・標本・設定を1つの状態として持ち、そのまま保存する。
// 描画・DOM・three.js には依存しない。
import { CARE, LIFE, SIM } from '../config';
import { createRng } from './rng';

/** 保存形式の版。形を変えたら上げて、storage/schema.ts にマイグレーションを足す */
export const SCHEMA_VERSION = 4;

export type Species = 'aurelia';
export type Stage = 'polyp' | 'strobila' | 'ephyra' | 'adult';

export const STAGES: readonly Stage[] = ['polyp', 'strobila', 'ephyra', 'adult'];

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
  /**
   * 今の段階の進み（0〜1）。1 に達すると次へ進む。
   * ポリプはくびれ始めるまで、ストロビラはエフィラを放すまで、エフィラは成体になるまで、成体は次のポリプを付けるまで
   */
  progress: number;
  /** 今の段階の長さ（秒、ゲーム内）。段階に入ったときに決める */
  stageLength: number;
  /** この瓶に来た時刻（ゲーム内の経過秒）と、そのときの端末の時刻（ミリ秒。日誌の個体一覧の「来た日」） */
  arrivedAt: number;
  arrivedWallTime: number;
  /** 名前（初期値なし） */
  name: string | null;
  /** 親の番号。ポリプは付けた成体、エフィラは放したポリプ。最初の1匹は null */
  parent: number | null;
  /** 瓶底の場所（ポリプ・ストロビラ）。瓶底の内側の半径を 1 とした [x, z]。泳ぐ個体は null */
  spot: [number, number] | null;
  /** ストロビラが放すエフィラの数（ほかの段階では 0） */
  discs: number;
  /** 最後に食べた餌（まだなら null）。胃の橙色と、成長の早まりに使う */
  meal: Meal | null;
}

export interface Meal {
  /** 食べた時刻（ゲーム内の経過秒） */
  at: number;
  /** 食べた量（1 で満腹） */
  amount: number;
}

export interface JarState {
  creatures: Creature[];
  /** 泳ぐ個体が上限に達していて、ポリプが休んでいる */
  resting: boolean;
  /** 最後に餌をやった端末の時刻（ミリ秒、まだなら null）。餌は1日1回まで */
  fedWallTime: number | null;
  /**
   * 瓶底に溜まったもの（CARE.threshold で水換えの目安）。マリンスノーが少しずつ、餌の食べ残しが消えると少し増える。
   * 見ていない夜中に水を替えると、薄く均される
   */
  sediment: number;
  /** まだ瓶底に残っている餌の食べ残し：消えたときに堆積に足す量と、消えきる時刻（ゲーム内の秒）。なければ null */
  leftover: { amount: number; goneAt: number } | null;
  /** 最後に食べ残しが消えきった時刻（ゲーム内の秒、まだなら null）。水換えはそこから少し間を空けたあと */
  cleanSince: number | null;
}

/** 日誌に載せる出来事の種類 */
export type JournalKind =
  /** 瓶底にポリプが付いた */
  | 'polyp'
  /** ポリプがくびれ始めた */
  | 'strobila'
  /** ストロビラからエフィラが離れた（count 匹） */
  | 'release'
  /** エフィラが成体になった */
  | 'adult'
  /** 瓶がいっぱいで、ポリプが休みに入った */
  | 'rest'
  /** 空きができて、ポリプがまた動き出した */
  | 'wake'
  /** 見ていない夜中に水を替えた（瓶底が均された） */
  | 'water';

/** 観察日誌の出来事。文にするのは日誌を開いたとき（ui） */
export interface JournalEntry {
  kind: JournalKind;
  /** 瓶の番号（0 から） */
  jar: number;
  /** 数（離れたエフィラの匹数など） */
  count: number;
  /** 関わった個体の番号 */
  ids: number[];
  /** 出来事の時刻（ゲーム内の経過秒）と、端末の時刻（ミリ秒） */
  time: number;
  wallTime: number;
  /**
   * その行の主な個体の名前（書いたときの名前。名無しなら null）。日誌では名前で書く。
   * くびれ始めた・成体になったは本人、離れたは放したストロビラ、休み・再開はポリプが1つのときだけ
   */
  name: string | null;
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
  /** 開いたときに出す瓶（前回見ていた瓶、0 から） */
  jar: number;
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
  /** 日誌で読んだ出来事の数（これより後ろの出来事が未読。日誌のアイコンに点が付く） */
  journalSeen: number;
  specimens: Specimen[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  lamp: true,
  sound: false,
  motion: true,
  quality: 'high',
  jar: 0,
};

/** 段階ごとの長さの範囲（秒） */
export function stageRange(stage: Stage, rules = LIFE): readonly [number, number] {
  switch (stage) {
    case 'polyp':
      return rules.polyp;
    case 'strobila':
      return rules.strobila;
    case 'ephyra':
      return rules.ephyra;
    case 'adult':
      return rules.adultPolyp;
  }
}

/** ゲーム内の時刻 t に当たる端末の時刻（ミリ秒）。進めている途中でないとき（lastTick が time + pending に当たるとき）に使う */
export function wallAt(state: GameState, t: number): number {
  return state.lastTick - (state.time + state.pending - t) * 1000;
}

/** 泳ぐ段階か（成体とエフィラ） */
export function isSwimmer(stage: Stage): boolean {
  return stage === 'adult' || stage === 'ephyra';
}

/** 最初の状態：1番の瓶にミズクラゲの成体が1匹。2番と3番は水だけ */
export function createInitialState(nowMs: number, seed: number = SIM.seed): GameState {
  const rng = createRng(seed);
  const [lo, hi] = LIFE.adultPolyp;
  const first: Creature = {
    id: 1,
    species: 'aurelia',
    stage: 'adult',
    seed: Math.floor(rng.next() * 2 ** 32) >>> 0,
    age: 0,
    stageAge: 0,
    progress: 0,
    stageLength: rng.range(lo, hi),
    arrivedAt: 0,
    arrivedWallTime: nowMs,
    name: null,
    parent: null,
    spot: null,
    discs: 0,
    meal: null,
  };
  const jars: JarState[] = Array.from({ length: SIM.jarCount }, (_, i) => ({
    creatures: i === 0 ? [first] : [],
    resting: false,
    fedWallTime: null,
    sediment: CARE.after,
    leftover: null,
    cleanSince: null,
  }));
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
    journalSeen: 0,
    specimens: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}
