// シード付き乱数（mulberry32）。同じシードからは同じ列が出る。

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [min, max) */
  range(min: number, max: number): number;
  /** 平均0・標準偏差1に近い値（3つの一様乱数の和で近似） */
  gauss(): number;
  /** 現在の内部状態。保存と復元に使う */
  state(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    gauss: () => (next() + next() + next() - 1.5) * 2,
    state: () => s,
  };
}

/**
 * 状態に持っている乱数（`rng` の内部状態）から乱数を出して fn に渡し、使ったぶんを状態に戻す。
 * 時間を進める刻みの外で乱数を使うとき（利用者の操作、デバッグの書き換え）に。同じ状態からは同じ結果になる
 */
export function withStateRng<T>(holder: { rng: number }, fn: (rng: Rng) => T): T {
  const rng = createRng(holder.rng);
  const out = fn(rng);
  holder.rng = rng.state();
  return out;
}
