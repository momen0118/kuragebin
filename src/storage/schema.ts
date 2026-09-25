// 保存データの版とマイグレーション。古い版のデータは1版ずつ順に今の形へ直す。
// 形が合わないデータは読み込まない（呼び出し側で新しい状態から始める）。
import { LIFE } from '../config';
import { DEFAULT_SETTINGS, SCHEMA_VERSION, STAGES, stageRange, type GameState, type Stage } from '../sim/state';

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStage = (v: unknown): v is Stage => typeof v === 'string' && (STAGES as readonly string[]).includes(v);

/** 版 n のデータを n+1 の形にする。版を上げたらここに足す */
const MIGRATIONS: Record<number, (data: Raw) => Raw> = {
  // 2：生活環（段階の進み・長さ、親、瓶底の場所、皿の数）と、瓶の「休んでいる」。
  // 日誌は形を変えた（版1では何も書いていなかった）
  1: (d) => {
    const jars = Array.isArray(d.jars) ? d.jars : [];
    return {
      ...d,
      jars: jars.map((jar: unknown) => {
        if (!isObject(jar) || !Array.isArray(jar.creatures)) return jar;
        return {
          ...jar,
          resting: false,
          creatures: jar.creatures.map((c: unknown) => {
            if (!isObject(c)) return c;
            const [lo, hi] = stageRange(isStage(c.stage) ? c.stage : 'adult', LIFE);
            return { progress: 0, stageLength: (lo + hi) / 2, parent: null, spot: null, discs: 0, ...c };
          }),
        };
      }),
      journal: [],
    };
  },
};

export class SchemaError extends Error {}

/** 保存データを今の版の状態にする。読めなければ SchemaError */
export function migrate(input: unknown): GameState {
  if (!isObject(input)) throw new SchemaError('保存データの形が違います');
  let data: Raw = structuredClone(input);
  let version = data.schema;
  if (!isNumber(version) || version < 1) throw new SchemaError('保存データの版がわかりません');
  if (version > SCHEMA_VERSION) throw new SchemaError(`新しい版（${version}）の保存データです`);
  while (version < SCHEMA_VERSION) {
    const up = MIGRATIONS[version];
    if (!up) throw new SchemaError(`版 ${version} からのマイグレーションがありません`);
    data = up(data);
    version += 1;
    data.schema = version;
  }
  return validate(data);
}

function isSpot(v: unknown): boolean {
  return v === null || (Array.isArray(v) && v.length === 2 && isNumber(v[0]) && isNumber(v[1]));
}

function validate(d: Raw): GameState {
  const nums = ['rng', 'time', 'pending', 'lastTick', 'createdAt', 'nextId'] as const;
  for (const k of nums) if (!isNumber(d[k])) throw new SchemaError(`${k} が読めません`);
  if (!Array.isArray(d.jars) || !Array.isArray(d.journal) || !Array.isArray(d.specimens)) {
    throw new SchemaError('瓶・日誌・標本が読めません');
  }
  for (const jar of d.jars) {
    if (!isObject(jar) || !Array.isArray(jar.creatures)) throw new SchemaError('瓶が読めません');
    if (typeof jar.resting !== 'boolean') jar.resting = false;
    for (const c of jar.creatures) {
      if (
        !isObject(c) ||
        !isNumber(c.id) ||
        !isNumber(c.seed) ||
        !isNumber(c.age) ||
        !isNumber(c.stageAge) ||
        !isStage(c.stage) ||
        !isNumber(c.progress) ||
        !isNumber(c.stageLength) ||
        !(c.stageLength > 0) ||
        !isNumber(c.discs) ||
        !isSpot(c.spot) ||
        !(c.parent === null || isNumber(c.parent))
      ) {
        throw new SchemaError('個体が読めません');
      }
    }
  }
  // 日誌は読めない出来事だけを除く（出来事ひとつのために全部を捨てない）
  d.journal = d.journal.filter(
    (e: unknown) => isObject(e) && typeof e.kind === 'string' && isNumber(e.jar) && isNumber(e.time) && isNumber(e.wallTime),
  );
  // 設定は足りない項目を初期値で埋める（あとから設定が増えても読める）
  const settings = isObject(d.settings) ? d.settings : {};
  d.settings = { ...DEFAULT_SETTINGS, ...settings };
  return d as unknown as GameState;
}
