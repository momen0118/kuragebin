// 保存データの版とマイグレーション。古い版のデータは1版ずつ順に今の形へ直す。
// 形が合わないデータは読み込まない（呼び出し側で新しい状態から始める）。
import { CARE, LIFE } from '../config';
import { BASE_GENES, sanitizeGenes } from '../sim/genes';
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
  // 3：餌。個体ごとの最後に食べた餌と、瓶ごとの最後に餌をやった時刻
  2: (d) => {
    const jars = Array.isArray(d.jars) ? d.jars : [];
    return {
      ...d,
      jars: jars.map((jar: unknown) => {
        if (!isObject(jar) || !Array.isArray(jar.creatures)) return jar;
        return {
          fedWallTime: null,
          ...jar,
          creatures: jar.creatures.map((c: unknown) => (isObject(c) ? { meal: null, ...c } : c)),
        };
      }),
    };
  },
  // 4：日誌（未読、行の名前、記録は消さない）、個体の来た日の端末の時刻、瓶底の堆積と食べ残し。
  // 来た日は今の時刻からさかのぼって求め、堆積は始めてからの日数の分だけ溜まっていたことにする（水換えの目安の手前まで）
  3: (d) => {
    const jars = Array.isArray(d.jars) ? d.jars : [];
    const now = isNumber(d.lastTick) ? d.lastTick : 0;
    const t = (isNumber(d.time) ? d.time : 0) + (isNumber(d.pending) ? d.pending : 0);
    const sediment = Math.min(CARE.after + (t / 86400) * CARE.snowPerDay, CARE.threshold * 0.8);
    return {
      ...d,
      journalSeen: 0,
      journal: Array.isArray(d.journal) ? d.journal.map((e: unknown) => (isObject(e) ? { name: null, ...e } : e)) : [],
      jars: jars.map((jar: unknown) => {
        if (!isObject(jar) || !Array.isArray(jar.creatures)) return jar;
        return {
          sediment,
          leftover: null,
          cleanSince: null,
          waterDue: null,
          ...jar,
          creatures: jar.creatures.map((c: unknown) => {
            if (!isObject(c)) return c;
            const arrived = isNumber(c.arrivedAt) ? c.arrivedAt : 0;
            return { arrivedWallTime: now - (t - arrived) * 1000, ...c };
          }),
        };
      }),
    };
  },
  // 5：瓶を揺らして水が動いている間（まだ揺らしていない）
  4: (d) => {
    const jars = Array.isArray(d.jars) ? d.jars : [];
    return { ...d, jars: jars.map((jar: unknown) => (isObject(jar) ? { stirredUntil: null, ...jar } : jar)) };
  },
  // 6：個体差（遺伝子）。それまでの個体は基準のまま（今の見た目）
  5: (d) => {
    const jars = Array.isArray(d.jars) ? d.jars : [];
    return {
      ...d,
      jars: jars.map((jar: unknown) => {
        if (!isObject(jar) || !Array.isArray(jar.creatures)) return jar;
        return { ...jar, creatures: jar.creatures.map((c: unknown) => (isObject(c) ? { genes: { ...BASE_GENES }, ...c } : c)) };
      }),
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

function isMeal(v: unknown): boolean {
  return v === null || (isObject(v) && isNumber(v.at) && isNumber(v.amount));
}

function isLeftover(v: unknown): boolean {
  return v === null || (isObject(v) && isNumber(v.amount) && isNumber(v.goneAt));
}

function validate(d: Raw): GameState {
  const nums = ['rng', 'time', 'pending', 'lastTick', 'createdAt', 'nextId'] as const;
  for (const k of nums) if (!isNumber(d[k])) throw new SchemaError(`${k} が読めません`);
  if (!isNumber(d.journalSeen) || d.journalSeen < 0) d.journalSeen = 0;
  if (!Array.isArray(d.jars) || !Array.isArray(d.journal) || !Array.isArray(d.specimens)) {
    throw new SchemaError('瓶・日誌・標本が読めません');
  }
  for (const jar of d.jars) {
    if (!isObject(jar) || !Array.isArray(jar.creatures)) throw new SchemaError('瓶が読めません');
    if (typeof jar.resting !== 'boolean') jar.resting = false;
    if (!(jar.fedWallTime === null || isNumber(jar.fedWallTime))) jar.fedWallTime = null;
    // 瓶底は読めなければ、水を替えたばかりのことにする
    if (!isNumber(jar.sediment) || jar.sediment < 0) jar.sediment = CARE.after;
    if (!isLeftover(jar.leftover)) jar.leftover = null;
    if (!(jar.cleanSince === null || isNumber(jar.cleanSince))) jar.cleanSince = null;
    if (!(jar.waterDue === null || isNumber(jar.waterDue))) jar.waterDue = null;
    if (!(jar.stirredUntil === null || isNumber(jar.stirredUntil))) jar.stirredUntil = null;
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
      // 餌は読めなければ食べていないことにする（胃の色と成長の早まりだけなので）
      if (!isMeal(c.meal)) c.meal = null;
      // 遺伝子は読めない値だけ基準にする
      c.genes = sanitizeGenes(c.genes);
      // 来た日が読めなければ、始めた日にする
      if (!isNumber(c.arrivedWallTime)) c.arrivedWallTime = d.createdAt;
    }
  }
  // 日誌は読めない出来事だけを除く（出来事ひとつのために全部を捨てない）
  d.journal = d.journal.filter(
    (e: unknown) => isObject(e) && typeof e.kind === 'string' && isNumber(e.jar) && isNumber(e.time) && isNumber(e.wallTime),
  );
  const journal = d.journal as Raw[];
  for (const e of journal) {
    if (!(e.name === null || typeof e.name === 'string')) e.name = null;
    if (!isNumber(e.count)) e.count = 1;
    if (!Array.isArray(e.ids)) e.ids = [];
  }
  if ((d.journalSeen as number) > journal.length) d.journalSeen = journal.length;
  // 設定は足りない項目を初期値で埋める（あとから設定が増えても読める）
  const settings = isObject(d.settings) ? d.settings : {};
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  if (!isNumber(merged.jar) || merged.jar < 0 || merged.jar >= d.jars.length) merged.jar = 0;
  d.settings = merged;
  return d as unknown as GameState;
}
