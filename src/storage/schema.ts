// 保存データの版とマイグレーション。古い版のデータは1版ずつ順に今の形へ直す。
// 形が合わないデータは読み込まない（呼び出し側で新しい状態から始める）。
import { ADULT_GROWTH, CARE, FIND_VARIANTS, LIFE, ROOM_NAMES } from '../config';
import { createBook, FACT_KEYS } from '../sim/book';
import { BASE_GENES, sanitizeBolinopsisGenes, sanitizeGenes } from '../sim/genes';
import { createRng } from '../sim/rng';
import { sexFromSeed } from '../sim/sex';
import { DEFAULT_SETTINGS, firstLetter, LETTER_KINDS, SCHEMA_VERSION, SPECIES, SPECIES_STAGES, STAGES, stageRange, type GameState, type Sex, type Species, type Stage } from '../sim/state';

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
  // 7：おじさん。すでに始めていた人にも、次に開いたとき瓶の横に最初の手紙が置いてあり、日誌に「手紙が届いていた」と一行
  6: (d) => {
    const now = isNumber(d.lastTick) ? d.lastTick : 0;
    const t = (isNumber(d.time) ? d.time : 0) + (isNumber(d.pending) ? d.pending : 0);
    const settings = isObject(d.settings) ? d.settings : {};
    const jar = isNumber(settings.jar) ? settings.jar : 0;
    const journal = Array.isArray(d.journal) ? d.journal : [];
    return {
      ...d,
      letters: [firstLetter(1, t, now, jar)],
      sent: [],
      uncle: { nextLetterId: 2, reply: null, lastReplyAt: null },
      journal: [...journal, { kind: 'firstLetter', jar: -1, count: 1, ids: [], time: t, wallTime: now, name: null }],
    };
  },
  // 8：拾いもの。それまでの標本の欄は使っていなかった（空のまま）
  7: (d) => ({ ...d, specimens: [] }),
  // 9：種のページ（豆知識と写真）。豆知識は、状態から分かるものを次に開いたときにまとめて足す（日付はその日）
  8: (d) => ({ ...d, book: createBook(isNumber(d.createdAt) ? d.createdAt : 0) }),
  // 10：雌雄とプラヌラ。最初の一匹（番号1）はメス、ほかの成体・エフィラは個体の種から半々。
  // 成体になってからの時間は、年齢からエフィラの期間（真ん中）を引いて見積もる（親のない個体は年齢のまま）。
  // 送った子も同じ決め方（エフィラは null で出さない）。
  9: (d) => {
    const jars = Array.isArray(d.jars) ? d.jars : [];
    const [elo, ehi] = LIFE.ephyra;
    const sexOf = (c: Raw): Sex => (c.id === 1 ? 'female' : sexFromSeed(isNumber(c.seed) ? c.seed : 0));
    return {
      ...d,
      jars: jars.map((jar: unknown) => {
        if (!isObject(jar) || !Array.isArray(jar.creatures)) return jar;
        return {
          ...jar,
          planulae: [],
          creatures: jar.creatures.map((c: unknown) => {
            if (!isObject(c)) return c;
            const swimmer = c.stage === 'adult' || c.stage === 'ephyra';
            const age = isNumber(c.age) ? c.age : 0;
            const adultAge = c.stage !== 'adult' ? 0 : c.parent === null ? age : Math.max(0, age - (elo + ehi) / 2);
            return { ...c, sex: swimmer ? sexOf(c) : null, adultAge, brood: null };
          }),
        };
      }),
      sent: Array.isArray(d.sent) ? d.sent.map((r: unknown) => (isObject(r) ? { ...r, sex: r.stage === 'adult' ? sexOf(r) : null } : r)) : d.sent,
    };
  },
  // 11：成体になってからの成長。すでにいる成体は育ちきった今の大きさのまま（更新した途端に縮まない）。
  // エフィラ（とほかの段階）の育ちきった大きさは、個体の種から決める
  10: (d) => {
    const jars = Array.isArray(d.jars) ? d.jars : [];
    return {
      ...d,
      jars: jars.map((jar: unknown) => {
        if (!isObject(jar) || !Array.isArray(jar.creatures)) return jar;
        return {
          ...jar,
          creatures: jar.creatures.map((c: unknown) => {
            if (!isObject(c)) return c;
            const adult = c.stage === 'adult';
            return { ...c, adultGrowth: adult ? 1 : 0, fullSize: adult ? 1 : fullSizeFromSeed(isNumber(c.seed) ? c.seed : 0) };
          }),
        };
      }),
    };
  },
  // 12：何代目か（個体・付くのを待つプラヌラ・送った子）と、新しい種の届き方（空きを訊いた種・届けた種）。
  // 前からいる個体は、状態の中で親をたどれる所までたどって数える（たどれなくなった所を1代目にする）。
  // 親が泳ぐ個体（成体）なら代を一つ足し、親が瓶底の個体（ポリプ・ストロビラ）ならエフィラはその分身なので同じ代。送った子は1代目
  11: (d) => {
    const jars = Array.isArray(d.jars) ? d.jars : [];
    const byId = new Map<number, Raw>();
    for (const jar of jars) {
      if (!isObject(jar) || !Array.isArray(jar.creatures)) continue;
      for (const c of jar.creatures) if (isObject(c) && isNumber(c.id)) byId.set(c.id, c);
    }
    const swims = (c: Raw): boolean => c.stage === 'adult' || c.stage === 'ephyra';
    const memo = new Map<number, number>();
    const generationOf = (c: Raw, depth = 0): number => {
      const id = isNumber(c.id) ? c.id : -1;
      const known = memo.get(id);
      if (known !== undefined) return known;
      const parent = isNumber(c.parent) ? byId.get(c.parent) : undefined;
      // 親の親…と、念のため輪になっていても止まるように
      const g = !parent || depth > byId.size ? 1 : generationOf(parent, depth + 1) + (swims(parent) ? 1 : 0);
      memo.set(id, g);
      return g;
    };
    return {
      ...d,
      jars: jars.map((jar: unknown) => {
        if (!isObject(jar) || !Array.isArray(jar.creatures)) return jar;
        return {
          ...jar,
          creatures: jar.creatures.map((c: unknown) => (isObject(c) ? { ...c, generation: generationOf(c) } : c)),
          planulae: Array.isArray(jar.planulae)
            ? jar.planulae.map((p: unknown) => {
                if (!isObject(p)) return p;
                const mother = isNumber(p.parent) ? byId.get(p.parent) : undefined;
                return { ...p, generation: mother ? generationOf(mother) + 1 : 1 };
              })
            : jar.planulae,
        };
      }),
      sent: Array.isArray(d.sent) ? d.sent.map((r: unknown) => (isObject(r) ? { ...r, generation: 1 } : r)) : d.sent,
      uncle: isObject(d.uncle) ? { ...d.uncle, asked: [], given: [] } : d.uncle,
    };
  },
  // 13：カブトクラゲの卵と幼生（それまでは卵がない）。いたカブトクラゲの成体は、次に卵を産むまでを数えはじめる
  // （それまではミズクラゲの成体の長さを持っていた）
  12: (d) => {
    const jars = Array.isArray(d.jars) ? d.jars : [];
    const [lo, hi] = stageRange('adult', LIFE, 'bolinopsis');
    return {
      ...d,
      jars: jars.map((jar: unknown) => {
        if (!isObject(jar)) return jar;
        const creatures = Array.isArray(jar.creatures)
          ? jar.creatures.map((c: unknown) =>
              isObject(c) && c.species === 'bolinopsis' && c.stage === 'adult' ? { ...c, progress: 0, stageLength: (lo + hi) / 2 } : c,
            )
          : jar.creatures;
        return { ...jar, creatures, eggs: [] };
      }),
    };
  },
};

/** 個体の種から育ちきった大きさを決める（版10までのエフィラなど。乱数の並びを変えないため） */
function fullSizeFromSeed(seed: number): number {
  const [lo, hi] = ADULT_GROWTH.fullSize;
  return createRng((seed ^ 0x5bd1e995) >>> 0).range(lo, hi);
}

export class SchemaError extends Error {}

/** 標本の写真として受け付ける形 */
const PHOTO_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

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

function isSex(v: unknown): v is Sex {
  return v === 'male' || v === 'female';
}

function isSpecies(v: unknown): v is Species {
  return (SPECIES as readonly unknown[]).includes(v);
}

/** 種の並び（読めないもの・重なりは除く） */
function speciesList(v: unknown): Species[] {
  return Array.isArray(v) ? [...new Set(v.filter(isSpecies))] : [];
}

/** 何代目か（1 以上の整数。読めなければ1代目） */
function generationOr1(v: unknown): number {
  return isNumber(v) && v >= 1 ? Math.floor(v) : 1;
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
    // 瓶底に付くのを待っているプラヌラ：読めないものだけ除く
    jar.planulae = (Array.isArray(jar.planulae) ? jar.planulae : [])
      .filter((p: unknown) => isObject(p) && isNumber(p.at))
      .map((p: Raw) => ({ at: p.at, parent: isNumber(p.parent) ? p.parent : null, genes: sanitizeGenes(p.genes), generation: generationOr1(p.generation) }));
    // カブトクラゲの卵：読めないものだけ除く。孵る数は1匹以上、見せる粒は孵る数以上
    jar.eggs = (Array.isArray(jar.eggs) ? jar.eggs : [])
      .filter((e: unknown) => isObject(e) && isNumber(e.laidAt) && isNumber(e.hatchAt) && isNumber(e.count) && e.count >= 1)
      .map((e: Raw) => {
        const count = Math.floor(e.count as number);
        return {
          parent: isNumber(e.parent) ? e.parent : null,
          laidAt: e.laidAt,
          hatchAt: e.hatchAt,
          count,
          shown: isNumber(e.shown) ? Math.max(count, Math.floor(e.shown)) : count,
          seed: isNumber(e.seed) ? e.seed >>> 0 : 0,
          genes: sanitizeBolinopsisGenes(e.genes),
          generation: generationOr1(e.generation),
        };
      });
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
      // 種（読めなければミズクラゲ）と、その種の遺伝子（読めない値だけ基準にする）。代は読めなければ1代目
      if (!isSpecies(c.species)) c.species = 'aurelia';
      // その種にない段階（確認用に変えたカブトクラゲのポリプなど）は、その種の成体にする（データ全体は捨てない）
      if (!SPECIES_STAGES[c.species as Species].includes(c.stage as Stage)) {
        const [lo, hi] = stageRange('adult', LIFE, c.species as Species);
        Object.assign(c, { stage: 'adult', progress: 0, stageLength: (lo + hi) / 2, spot: null, discs: 0 });
      }
      c.genes = c.species === 'bolinopsis' ? sanitizeBolinopsisGenes(c.genes) : sanitizeGenes(c.genes);
      c.generation = generationOr1(c.generation);
      // 来た日が読めなければ、始めた日にする
      if (!isNumber(c.arrivedWallTime)) c.arrivedWallTime = d.createdAt;
      // 雌雄：泳ぐ個体だけ（読めなければ個体の種から）。成体になってからの時間と、抱えているプラヌラは成体だけ
      // カブトクラゲは雌雄同体なので持たない
      const swimmer = c.stage === 'adult' || c.stage === 'ephyra' || c.stage === 'larva';
      if (!swimmer || c.species !== 'aurelia') c.sex = null;
      else if (!isSex(c.sex)) c.sex = sexFromSeed(c.seed as number);
      if (c.stage !== 'adult' || !isNumber(c.adultAge) || c.adultAge < 0) c.adultAge = 0;
      // 成体になってからの育ちと、育ちきった大きさ。読めなければ育ちきった今までの大きさ
      if (c.stage !== 'adult') c.adultGrowth = 0;
      else if (!isNumber(c.adultGrowth)) c.adultGrowth = 1;
      else c.adultGrowth = Math.min(Math.max(c.adultGrowth, 0), 1);
      const [lo, hi] = ADULT_GROWTH.fullSize;
      c.fullSize = isNumber(c.fullSize) ? Math.min(Math.max(c.fullSize, lo), hi) : 1;
      const b = c.brood;
      c.brood = c.stage === 'adult' && c.sex === 'female' && isObject(b) && isNumber(b.from) && isNumber(b.until) ? { from: b.from, until: b.until } : null;
    }
  }
  // 日誌は読めない出来事だけを除く（出来事ひとつのために全部を捨てない）
  d.journal = d.journal.filter(
    (e: unknown) => isObject(e) && typeof e.kind === 'string' && isNumber(e.jar) && isNumber(e.time) && isNumber(e.wallTime),
  );
  const journal = d.journal as Raw[];
  for (const e of journal) {
    if (!(e.name === null || typeof e.name === 'string')) e.name = null;
    if (e.species !== undefined && !isSpecies(e.species)) delete e.species;
    if (!isNumber(e.count)) e.count = 1;
    if (!Array.isArray(e.ids)) e.ids = [];
  }
  if ((d.journalSeen as number) > journal.length) d.journalSeen = journal.length;
  // おじさん：読めない手紙と送った子だけを除く
  d.letters = (Array.isArray(d.letters) ? d.letters : []).filter(
    (l: unknown) => isObject(l) && isNumber(l.id) && (LETTER_KINDS as readonly unknown[]).includes(l.kind) && isNumber(l.wallTime) && isNumber(l.arrivedAt),
  );
  for (const l of d.letters as Raw[]) {
    if (typeof l.sealed !== 'boolean') l.sealed = false;
    if (!isNumber(l.jar) || l.jar < 0 || l.jar >= d.jars.length) l.jar = 0;
    if (!isNumber(l.pick)) l.pick = 0;
    if (!(l.about === null || isNumber(l.about))) l.about = null;
    if (typeof l.topic !== 'string') l.topic = l.kind === 'reply' ? 'plain' : null;
    // 添えた個体は記録（種だけ使う）。種が読めなければ持たない
    if (!isObject(l.gift) || !isSpecies(l.gift.species)) l.gift = null;
  }
  d.sent = (Array.isArray(d.sent) ? d.sent : []).filter((r: unknown) => isObject(r) && isNumber(r.id) && isNumber(r.sentWallTime) && isStage(r.stage));
  for (const r of d.sent as Raw[]) {
    if (!isSpecies(r.species)) r.species = 'aurelia';
    r.genes = r.species === 'bolinopsis' ? sanitizeBolinopsisGenes(r.genes) : sanitizeGenes(r.genes);
    r.generation = generationOr1(r.generation);
    if (!(r.name === null || typeof r.name === 'string')) r.name = null;
    if (!isNumber(r.jar)) r.jar = 0;
    if (!isNumber(r.sentAt)) r.sentAt = 0;
    if (!isSex(r.sex)) r.sex = null;
  }
  const maxLetter = Math.max(0, ...(d.letters as Raw[]).map((l) => l.id as number));
  const u = isObject(d.uncle) ? d.uncle : {};
  const reply = isObject(u.reply) && isNumber(u.reply.dueAt) && isNumber(u.reply.about) && isNumber(u.reply.rarity) ? u.reply : null;
  d.uncle = {
    nextLetterId: isNumber(u.nextLetterId) && u.nextLetterId > maxLetter ? u.nextLetterId : maxLetter + 1,
    reply,
    lastReplyAt: isNumber(u.lastReplyAt) ? u.lastReplyAt : null,
    asked: speciesList(u.asked),
    given: speciesList(u.given),
  };
  // 拾いもの：読めない物だけを除く。瓶底の場所が読めなければ標本にあることにする（まだ拾っていなければ除く）
  d.specimens = (d.specimens as unknown[]).filter(
    (s: unknown) => isObject(s) && isNumber(s.id) && typeof s.variant === 'string' && FIND_VARIANTS[s.variant] !== undefined && isNumber(s.seed),
  );
  for (const s of d.specimens as Raw[]) {
    s.kind = FIND_VARIANTS[s.variant as string]!.kind;
    if (!isNumber(s.appearedAt)) s.appearedAt = 0;
    if (!isNumber(s.appearedWallTime)) s.appearedWallTime = d.createdAt;
    if (!(isNumber(s.foundAt) && isNumber(s.foundWallTime))) {
      s.foundAt = null;
      s.foundWallTime = null;
    }
    // 写真は画像の data URL だけ（読み込んだデータから、ページに別のものが入らないように）
    if (typeof s.photo !== 'string' || !PHOTO_URL.test(s.photo)) s.photo = null;
    const at = s.at;
    const ok =
      isObject(at) && isNumber(at.jar) && at.jar >= 0 && at.jar < (d.jars as unknown[]).length && isSpot(at.spot) && at.spot !== null && isNumber(at.yaw);
    s.at = ok ? { jar: at.jar, spot: at.spot, yaw: at.yaw, placed: at.placed === true } : null;
  }
  d.specimens = (d.specimens as Raw[]).filter((s) => s.at !== null || s.foundAt !== null);
  // 種のページ：読めない豆知識・写真だけを除く。数は読めなければ 0
  d.book = validateBook(d.book, d.createdAt as number);
  // 設定は足りない項目を初期値で埋める（あとから設定が増えても読める）
  const settings = isObject(d.settings) ? d.settings : {};
  const merged: Raw = { ...DEFAULT_SETTINGS, ...settings };
  if (!isNumber(merged.jar) || merged.jar < 0 || merged.jar >= d.jars.length) merged.jar = 0;
  // 部屋を持っていないデータ（部屋を選べるようになる前から遊んでいたデータ）と、読めない部屋は家のまま。
  // 新しく始めたデータの初期値（研究室）にはしない
  if (!(ROOM_NAMES as readonly unknown[]).includes(settings.room)) merged.room = 'home';
  // 研究室の入り口で部屋を固定していたころの印は使わない
  delete merged.roomLocked;
  d.settings = merged;
  return d as unknown as GameState;
}

const FACT_SET: ReadonlySet<string> = new Set(FACT_KEYS);

function validateBook(v: unknown, createdAt: number): Raw {
  const b = isObject(v) ? v : (createBook(createdAt) as unknown as Raw);
  const species = (Array.isArray(b.species) ? b.species : []).filter((r: unknown) => isObject(r) && isSpecies(r.species)) as Raw[];
  let maxPhoto = 0;
  for (const r of species) {
    if (!isNumber(r.since)) r.since = createdAt;
    r.facts = (Array.isArray(r.facts) ? r.facts : []).filter((f: unknown) => isObject(f) && typeof f.key === 'string' && FACT_SET.has(f.key) && isNumber(f.wallTime));
    r.photos = (Array.isArray(r.photos) ? r.photos : []).filter((p: unknown) => isObject(p) && isNumber(p.id) && isNumber(p.wallTime));
    for (const p of r.photos as Raw[]) {
      if (!(p.creature === null || isNumber(p.creature))) p.creature = null;
      if (!(p.name === null || typeof p.name === 'string')) p.name = null;
      maxPhoto = Math.max(maxPhoto, p.id as number);
    }
  }
  if (!species.some((r) => r.species === 'aurelia')) species.unshift({ species: 'aurelia', since: createdAt, facts: [], photos: [] });
  const counts = isObject(b.counts) ? b.counts : {};
  return {
    species,
    factsSeen: isNumber(b.factsSeen) && b.factsSeen >= 0 ? b.factsSeen : 0,
    counts: { feeds: isNumber(counts.feeds) ? counts.feeds : 0, righted: isNumber(counts.righted) ? counts.righted : 0 },
    nextPhotoId: isNumber(b.nextPhotoId) && b.nextPhotoId > maxPhoto ? b.nextPhotoId : maxPhoto + 1,
  };
}
