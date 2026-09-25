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
