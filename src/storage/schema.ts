// 保存データの版とマイグレーション。古い版のデータは1版ずつ順に今の形へ直す。
// 形が合わないデータは読み込まない（呼び出し側で新しい状態から始める）。
import { DEFAULT_SETTINGS, SCHEMA_VERSION, type GameState } from '../sim/state';

type Raw = Record<string, unknown>;

/** 版 n のデータを n+1 の形にする。版を上げたらここに足す */
const MIGRATIONS: Record<number, (data: Raw) => Raw> = {};

export class SchemaError extends Error {}

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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

function validate(d: Raw): GameState {
  const nums = ['rng', 'time', 'pending', 'lastTick', 'createdAt', 'nextId'] as const;
  for (const k of nums) if (!isNumber(d[k])) throw new SchemaError(`${k} が読めません`);
  if (!Array.isArray(d.jars) || !Array.isArray(d.journal) || !Array.isArray(d.specimens)) {
    throw new SchemaError('瓶・日誌・標本が読めません');
  }
  for (const jar of d.jars) {
    if (!isObject(jar) || !Array.isArray(jar.creatures)) throw new SchemaError('瓶が読めません');
    for (const c of jar.creatures) {
      if (!isObject(c) || !isNumber(c.id) || !isNumber(c.seed) || !isNumber(c.age) || typeof c.stage !== 'string') {
        throw new SchemaError('個体が読めません');
      }
    }
  }
  // 設定は足りない項目を初期値で埋める（あとから設定が増えても読める）
  const settings = isObject(d.settings) ? d.settings : {};
  d.settings = { ...DEFAULT_SETTINGS, ...settings };
  return d as unknown as GameState;
}
