// 個体差と変異。各個体は小さな遺伝子を持ち、見た目と動きを決める。今までの見た目が「基準」（すべて 0、四つ葉）。
// 新しく生まれる個体は、親の値を少しずらして受け継ぐ（ポリプは成体から、エフィラはストロビラから）。
// 三つ葉・五つ葉はエフィラごとにまれに出る（受け継がない）。状態をその場で書き換えない純粋な関数だけ。
import { GENES } from '../config';
import type { Rng } from './rng';

export type Leaves = 3 | 4 | 5;

export interface Genes {
  /** 傘の色味：-1 でうす青、+1 でうす桃 */
  hue: number;
  /** 透け具合：-1 で少し濃い、+1 でよく透ける */
  clarity: number;
  /** 触手の長さ：-1 で短い、+1 で長い */
  tentacle: number;
  /** 拍動の速さ：-1 でゆっくり、+1 で速い */
  tempo: number;
  /** 縁の発光色（光る種のため。ミズクラゲは光らないので使わない） */
  glow: number;
  /** 崩し（0〜1）：輪郭のいびつさ、縁の欠けと房のむら、四つ葉の不揃い */
  warp: number;
  ragged: number;
  leafJitter: number;
  /** 生殖腺の数（ふだんは四つ葉。まれに三つ葉・五つ葉） */
  leaves: Leaves;
}

/** 基準の遺伝子（今までの見た目） */
export const BASE_GENES: Readonly<Genes> = {
  hue: 0,
  clarity: 0,
  tentacle: 0,
  tempo: 0,
  glow: 0,
  warp: 0,
  ragged: 0,
  leafJitter: 0,
  leaves: 4,
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** -1〜1 の値を少しずらす（基準へ少し戻しながら） */
function shift(v: number, sigma: number, rng: Rng): number {
  return clamp(v * (1 - GENES.pull) + rng.gauss() * sigma, -1, 1);
}

/** 崩し（0〜1）を少しずらす（世代を重ねると typicalFlaw のあたりに落ち着く） */
function shiftFlaw(v: number, rng: Rng): number {
  const pulled = v + (GENES.typicalFlaw - v) * GENES.pull * 3;
  return clamp(Math.abs(pulled + rng.gauss() * GENES.drift.flaw), 0, 1);
}

/**
 * 親の遺伝子を少しずらして受け継ぐ。withLeaves なら（エフィラ）、まれに三つ葉・五つ葉になる。
 * それ以外（ポリプ）は親の葉の数に関わらず四つ葉（ポリプには四つ葉がない。エフィラになるときに決まる）
 */
export function inheritGenes(parent: Readonly<Genes>, rng: Rng, withLeaves: boolean): Genes {
  const d = GENES.drift;
  let leaves: Leaves = 4;
  if (withLeaves) {
    const r = rng.next();
    if (r < GENES.threeLeaves) leaves = 3;
    else if (r < GENES.threeLeaves + GENES.fiveLeaves) leaves = 5;
  }
  return {
    hue: shift(parent.hue, d.hue, rng),
    clarity: shift(parent.clarity, d.clarity, rng),
    tentacle: shift(parent.tentacle, d.tentacle, rng),
    tempo: shift(parent.tempo, d.tempo, rng),
    glow: shift(parent.glow, d.glow, rng),
    warp: shiftFlaw(parent.warp, rng),
    ragged: shiftFlaw(parent.ragged, rng),
    leafJitter: shiftFlaw(parent.leafJitter, rng),
    leaves,
  };
}

/** 読み込んだ値を遺伝子として使える形にする（足りない・読めない値は基準） */
export function sanitizeGenes(raw: unknown): Genes {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (k: keyof Genes, lo: number, hi: number): number => {
    const v = o[k];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : (BASE_GENES[k] as number);
  };
  const leaves = o.leaves === 3 || o.leaves === 5 ? o.leaves : 4;
  return {
    hue: num('hue', -1, 1),
    clarity: num('clarity', -1, 1),
    tentacle: num('tentacle', -1, 1),
    tempo: num('tempo', -1, 1),
    glow: num('glow', -1, 1),
    warp: num('warp', 0, 1),
    ragged: num('ragged', 0, 1),
    leafJitter: num('leafJitter', 0, 1),
    leaves,
  };
}

/** 遺伝子が同じか（描画側で、作り直すかを決めるのに使う） */
export function genesKey(g: Readonly<Genes>): string {
  return [g.hue, g.clarity, g.tentacle, g.tempo, g.glow, g.warp, g.ragged, g.leafJitter, g.leaves].map((v) => v.toFixed(4)).join(',');
}
