// 遺伝子（sim の Genes）から、1匹の見た目と動きの個体差を作る。崩しの場所（どの縁弁がいびつか、どこが欠けているか）は
// 個体の種で決まるので、同じ親から生まれた兄弟でも違う。基準の遺伝子では、今までの見た目とまったく同じになる。
import { GENE_LOOK, JELLY_LOOK, TENTACLES, type Vec3 } from '../../config';
import { BASE_GENES, type Genes } from '../../sim/genes';
import { createRng } from '../../sim/rng';

export interface Leaf {
  /** 向き（傘のローカル、ラジアン） */
  angle: number;
  /** 中心からの距離と大きさの倍率（基準で 1） */
  offset: number;
  size: number;
}

export interface Individual {
  /** 傘・触手・口腕の色と、四つ葉の色 */
  body: Vec3;
  gonad: Vec3;
  /** 傘と口腕の濃さの倍率 */
  density: number;
  /** 触手の長さと拍動の速さの倍率 */
  tentacleScale: number;
  tempo: number;
  /** 縁弁の数（葉の数の2倍：四つ葉で8枚、三つ葉で6枚、五つ葉で10枚。エフィラの腕の数も同じ） */
  lobes: number;
  /** 縁弁ごとの大きさ（輪郭のいびつさ） */
  lobeScale: Float32Array;
  /** 縁の欠け：[向き, 深さ, 幅]（ラジアン） */
  nicks: Array<[number, number, number]>;
  /** 触手が抜けている所：[向き, 半分の幅]（ラジアン）。欠けの所も抜ける */
  gaps: Array<[number, number]>;
  /** 生殖腺（ふだんは四つ葉）。口腕も同じ数・同じ向き */
  leaves: Leaf[];
}

const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 色味：-1 でうす青、0 で基準、+1 でうす桃 */
export function hueColor(base: Vec3, blue: Vec3, pink: Vec3, hue: number): Vec3 {
  return hue < 0 ? mix3(base, blue, -hue) : mix3(base, pink, hue);
}

/** ポリプの色：傘の色味と同じ割合だけずらす */
export function polypTint(base: Vec3, hue: number): Vec3 {
  const body = hueColor(JELLY_LOOK.body, GENE_LOOK.bodyBlue, GENE_LOOK.bodyPink, hue);
  return [base[0] * (body[0] / JELLY_LOOK.body[0]), base[1] * (body[1] / JELLY_LOOK.body[1]), base[2] * (body[2] / JELLY_LOOK.body[2])];
}

/** 角度の差（-π〜π） */
export function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export function individualOf(genes: Readonly<Genes> = BASE_GENES, seed = 0): Individual {
  const L = GENE_LOOK;
  // 崩しの場所は個体の種で決める（遺伝子の乱数とは別に）
  const rng = createRng((seed ^ 0x6a09e667) >>> 0);
  // 縁弁は葉の数の2倍（実物の三つ葉・五つ葉も、縁弁が6枚・10枚になる）
  const lobes = genes.leaves * 2;
  const lobeScale = new Float32Array(lobes);
  for (let k = 0; k < lobes; k++) lobeScale[k] = 1 + genes.warp * L.warp * (rng.next() * 2 - 1);
  const nicks: Array<[number, number, number]> = [];
  const gaps: Array<[number, number]> = [];
  // 欠けは崩しが大きいほど多く深い
  const nickCount = Math.round(genes.ragged * L.nicks * rng.next() + genes.ragged * 0.6);
  for (let i = 0; i < nickCount; i++) {
    const a = rng.range(0, Math.PI * 2);
    const w = rng.range(0.05, 0.12);
    nicks.push([a, genes.ragged * L.nickDepth * rng.range(0.5, 1), w]);
    gaps.push([a, w * 1.2]);
  }
  // 房のむら：ところどころ触手がまばら
  const gapCount = Math.round(genes.ragged * (1 + 3 * rng.next()));
  for (let i = 0; i < gapCount; i++) gaps.push([rng.range(0, Math.PI * 2), genes.ragged * L.tentacleGaps * rng.range(0.15, 0.35)]);
  const n = genes.leaves;
  const leaves: Leaf[] = [];
  for (let k = 0; k < n; k++) {
    const j = genes.leafJitter;
    leaves.push({
      // 葉は縁弁1枚おきの向き（四つ葉で 45°, 135°, ...）
      angle: Math.PI / n + (k * Math.PI * 2) / n + j * L.leafAngle * (rng.next() * 2 - 1),
      offset: 1 + j * L.leafOffset * (rng.next() * 2 - 1),
      size: (n === 4 ? 1 : 4 / n) ** 0.5 * (1 + j * L.leafSize * (rng.next() * 2 - 1)),
    });
  }
  return {
    body: hueColor(JELLY_LOOK.body, L.bodyBlue, L.bodyPink, genes.hue),
    gonad: hueColor(JELLY_LOOK.gonad, L.gonadBlue, L.gonadPink, genes.hue),
    density: 1 - L.clarity * genes.clarity,
    tentacleScale: 1 + L.tentacle * genes.tentacle,
    tempo: 1 + L.tempo * genes.tempo,
    lobes,
    lobeScale,
    nicks,
    gaps,
    leaves,
  };
}

/** 触手 i 本目（角度 th）が、むらや欠けで抜けているか */
export function tentacleMissing(ind: Individual, th: number): boolean {
  for (const [a, w] of ind.gaps) if (Math.abs(angleDiff(th, a)) < w) return true;
  return false;
}

/** 確認用：触手の本数のうち、抜けている割合 */
export function missingFraction(ind: Individual): number {
  let n = 0;
  for (let i = 0; i < TENTACLES.count; i++) if (tentacleMissing(ind, ((i + 0.5) / TENTACLES.count) * Math.PI * 2)) n++;
  return n / TENTACLES.count;
}
