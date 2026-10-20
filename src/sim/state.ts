// ゲームの状態。瓶・個体・日誌・標本・設定を1つの状態として持ち、そのまま保存する。
// 描画・DOM・three.js には依存しない。
import { CARE, LIFE, SIM } from '../config';
import { BASE_GENES, type Genes } from './genes';
import { createRng } from './rng';

/** 保存形式の版。形を変えたら上げて、storage/schema.ts にマイグレーションを足す */
export const SCHEMA_VERSION = 8;

export type Species = 'aurelia';
export type Stage = 'polyp' | 'strobila' | 'ephyra' | 'adult';

export const STAGES: readonly Stage[] = ['polyp', 'strobila', 'ephyra', 'adult'];

export interface Creature {
  /** 保存データの中で一意な番号 */
  id: number;
  species: Species;
  stage: Stage;
  /** 見た目と動きの種（揺れ方や形の細かいところ。受け継ぐ個体差は genes） */
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
  /** 遺伝子（見た目と動きの個体差）。最初の1匹と、版5までにいた個体は基準のまま */
  genes: Genes;
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
  /**
   * 餌をやったので水を替えることになっている夜（年月日を1つの数にしたもの、なければ null）。
   * その日付の夜中から、溜まった量によらず替える。見送った夜のぶんは次の夜に回す
   */
  waterDue: number | null;
  /**
   * 瓶を揺らして水が動いている間の終わり（ゲーム内の秒、なければ null）。その間だけエフィラの育ちがわずかに早まる。
   * 揺らすたびに今から数えなおす（延びるだけで、量は増えない）
   */
  stirredUntil: number | null;
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
  | 'water'
  /** おじさんのところへ送った（count 匹。瓶の行） */
  | 'sent'
  /** おじさんから手紙が届いた（瓶によらない行。jar は -1） */
  | 'letter'
  /** 手紙が届いていた（版6までに始めていた人の、最初の手紙。jar は -1） */
  | 'firstLetter';

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

/** おじさんへ送った子（個体一覧に「送った子」として残る） */
export interface SentRecord {
  id: number;
  name: string | null;
  species: Species;
  stage: Stage;
  genes: Genes;
  /** 送った瓶と、送った時刻（ゲーム内の秒と端末のミリ秒） */
  jar: number;
  sentAt: number;
  sentWallTime: number;
}

/** 返事で触れる送った子の特徴（文面を選ぶ） */
export type LetterTopic = 'five' | 'three' | 'pink' | 'blue' | 'flawed' | 'ephyra' | 'plain';

/** おじさんからの手紙。文面は届いたときに決めた種類と番号から、日誌を開いたときに作る（ui/letters.ts） */
export interface Letter {
  id: number;
  /** 最初の手紙か、送った子への返事か */
  kind: 'first' | 'reply';
  /** 返事で触れる特徴と、その中の何番目の文面か */
  topic: LetterTopic | null;
  pick: number;
  /** 返事で触れる送った子（SentRecord の番号） */
  about: number | null;
  /** 届いた時刻（ゲーム内の秒と端末のミリ秒） */
  arrivedAt: number;
  wallTime: number;
  /** 封筒のまま、机の上の瓶の横に置いてある（まだ読んでいない）。読んだら日誌のその日のページに留まる */
  sealed: boolean;
  /** 封筒を置いた瓶の横 */
  jar: number;
  /** 手紙に添えられた個体（新しい種を足すときに、手紙と一緒に一匹届く。今は使わない） */
  gift: Creature | null;
}

/** おじさんとのやりとり */
export interface UncleState {
  /** 次の手紙の番号 */
  nextLetterId: number;
  /** 届くことになっている返事（なければ null）：届く時刻（ゲーム内の秒）と、触れる送った子と、その珍しさ */
  reply: { dueAt: number; about: number; rarity: number } | null;
  /** 最後に返事が届いた時刻（ゲーム内の秒、まだなら null） */
  lastReplyAt: number | null;
}

/** 拾いものの種類 */
export type FindKind = 'glass' | 'shell' | 'pebble';

/** 瓶底にあるときの場所 */
export interface FindSpot {
  /** 瓶の番号（0 から） */
  jar: number;
  /** 瓶底の場所。瓶底の内側の半径を 1 とした [x, z] */
  spot: [number, number];
  /** 向き（ラジアン） */
  yaw: number;
  /** 自分で置いた（飾り）。勝手に現れた物は false */
  placed: boolean;
}

/**
 * 拾いもの（4-2）。見ていない間に瓶底に現れ（入れ替えた水に混じっていたもの）、タップで拾うと日誌の標本に移る。
 * 標本から瓶へ戻して飾れる（at に場所が入る）。日誌には書かない
 */
export interface Specimen {
  id: number;
  kind: FindKind;
  /** 色や模様（config の FIND_VARIANTS のキー） */
  variant: string;
  /** 形の種 */
  seed: number;
  /** 瓶底にあれば、その場所。標本にあれば null */
  at: FindSpot | null;
  /** 現れた時刻（ゲーム内の秒と端末のミリ秒） */
  appearedAt: number;
  appearedWallTime: number;
  /** 初めて拾った時刻（ゲーム内の秒と端末のミリ秒、まだなら null）。標本の「拾った日」 */
  foundAt: number | null;
  foundWallTime: number | null;
  /** 初めて拾ったときの写真（data URL、まだなら null）。標本に貼る */
  photo: string | null;
}

export interface Settings {
  /** 夜のデスクライト */
  lamp: boolean;
  /** 音（初期オフ、フェーズ4） */
  sound: boolean;
  /** 揺れを使う（端末を傾けたり揺らしたりすると、瓶の水が動く）。iOS で許可を断られたらオフにする */
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
  /** おじさんからの手紙と、送った子と、やりとり */
  letters: Letter[];
  sent: SentRecord[];
  uncle: UncleState;
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
    genes: { ...BASE_GENES },
  };
  const jars: JarState[] = Array.from({ length: SIM.jarCount }, (_, i) => ({
    creatures: i === 0 ? [first] : [],
    resting: false,
    fedWallTime: null,
    sediment: CARE.after,
    leftover: null,
    cleanSince: null,
    waterDue: null,
    stirredUntil: null,
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
    // 最初の成体1匹と一緒に、瓶の横に封筒が置いてある
    letters: [firstLetter(1, 0, nowMs, 0)],
    sent: [],
    uncle: { nextLetterId: 2, reply: null, lastReplyAt: null },
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** 最初の手紙（封筒のまま、瓶 jar の横に置いてある） */
export function firstLetter(id: number, time: number, wallMs: number, jar: number): Letter {
  return { id, kind: 'first', topic: null, pick: 0, about: null, arrivedAt: time, wallTime: wallMs, sealed: true, jar, gift: null };
}
