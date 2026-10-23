// カブトクラゲの形（ローカル、頂から口葉の先までがおよそ 1。+y が頂＝平衡器のある側、口葉は ±x の向きに2枚）。
// 胴・口葉・耳状突起の面と、櫛板の列の道筋を CPU で求める。描画（body.ts）と櫛板（combs.ts）が使う。
// 個体差（遺伝子）で太さ・口葉の大きさ・左右差・いびつさ・列の長さが少し変わる
import { Vector3 } from 'three';
import { CTENO } from '../../config';
import type { BolinopsisGenes } from '../../sim/genes';
import { createRng } from '../../sim/rng';

export interface CtenoForm {
  /** 胴のいちばん太い所の半径 */
  radius: number;
  /** 口葉（[-x の側, +x の側]）の長さと幅 */
  lobeLength: [number, number];
  lobeWidth: [number, number];
  /** 輪郭のいびつさ（欠けて直ったあとのような左右差）の大きさと向き */
  warp: number;
  warpPhase: number;
  /** 櫛板の列ごとの長さの倍率（8本） */
  rowEnds: number[];
  /** 濃さの倍率と、櫛板を打つ速さの倍率 */
  density: number;
  tempo: number;
}

/** 遺伝子と個体の種から形を決める */
export function ctenoForm(g: Readonly<BolinopsisGenes>, seed: number): CtenoForm {
  const k = CTENO.genes;
  const rng = createRng((seed ^ 0x6c8e9cf5) >>> 0);
  // 左右の口葉の差：どちらが大きいかは個体の種で
  const skew = g.lobeSkew * k.lobeSkew * (rng.next() < 0.5 ? -1 : 1);
  const len = CTENO.lobe.length * (1 + g.lobe * k.lobeLength);
  const wid = CTENO.lobe.width * (1 + g.lobe * k.lobeWidth);
  const rowEnds = Array.from({ length: 8 }, () => 1 - g.rowJitter * k.rowJitter * rng.next());
  return {
    radius: CTENO.body.radius * (1 - g.build * k.build),
    lobeLength: [len * (1 - skew), len * (1 + skew)],
    lobeWidth: [wid * (1 - skew * 0.6), wid * (1 + skew * 0.6)],
    warp: g.warp * k.warp,
    warpPhase: rng.range(0, Math.PI * 2),
    rowEnds,
    density: 1 - g.clarity * k.density,
    tempo: 1 + g.tempo * k.tempo,
  };
}

const B = CTENO.body;
const L = CTENO.lobe;

/** 胴の高さ（v は頂 0 から下端 1） */
export function bodyY(v: number): number {
  return B.top - (B.top - B.bottom) * v;
}

/** 胴の半径（頂は丸く閉じ、下のほうで少しすぼまる） */
export function bodyRadius(f: CtenoForm, v: number): number {
  if (v < B.cap) {
    const t = 1 - v / B.cap;
    return f.radius * Math.sqrt(Math.max(0, 1 - t * t));
  }
  const t = (v - B.cap) / (1 - B.cap);
  return f.radius * (1 - 0.12 * t * t);
}

/** 胴の面の点（φ は口葉の向き +x から +z へ測る） */
export function bodyPoint(f: CtenoForm, v: number, phi: number, out: Vector3): Vector3 {
  const r = bodyRadius(f, v) * (1 + f.warp * Math.sin(phi - f.warpPhase) * Math.sin(Math.PI * v));
  return out.set(r * Math.cos(phi), bodyY(v), r * Math.sin(phi) * B.flat);
}

/** 口葉が胴に付く所の v と、付け根の x（口葉が開閉する軸） */
export function lobeAttach(f: CtenoForm): { v: number; x: number } {
  const v = (B.top - L.attach) / (B.top - B.bottom);
  return { v, x: bodyRadius(f, v) * L.inset };
}

/** 口葉の丸み（a は付け根 0 から先 1）：付け根で 0.55、いちばん広い所で 1、そこから先へ丸く閉じて 0 */
function lobeRound(a: number): number {
  if (a < L.round) return 0.55 + 0.45 * Math.pow(a / L.round, 0.7);
  const t = (a - L.round) / (1 - L.round);
  return Math.sqrt(Math.max(0, 1 - t * t));
}

/** 口葉の芯（断面の真ん中）の x（side を掛ける前）と高さ */
function lobeCore(f: CtenoForm, side: -1 | 1, a: number): { x: number; y: number } {
  const len = f.lobeLength[side < 0 ? 0 : 1]!;
  const xb = lobeAttach(f).x;
  return { x: xb + L.flare * Math.sin(Math.PI * a * 0.85) - L.tuck * a * a * a, y: L.attach - a * len };
}

/**
 * 口葉の面の点。口葉は平たい袋：断面は横（±z）に広く、厚み（±x）は薄い楕円。
 * side は -1（-x の側）か +1。a は付け根 0 から先 1、ψ は断面を一周する角度（cos ψ が横、sin ψ が外側の向き）。
 * 外へ張り出しながら垂れ、先は少し内へ戻る。横の端は内側（軸の側）へ丸まる
 */
export function lobePoint(f: CtenoForm, side: -1 | 1, a: number, psi: number, out: Vector3): Vector3 {
  const i = side < 0 ? 0 : 1;
  const k = lobeRound(a);
  const w = f.lobeWidth[i]! * k;
  const h = L.thickness * k * (1 - 0.6 * a);
  const core = lobeCore(f, side, a);
  const b = Math.cos(psi);
  const x = core.x + h * Math.sin(psi) - L.cup * w * b * b;
  return out.set(side * x, core.y, b * w);
}

/** 口葉の芯の点（面の外向きを決めるため） */
export function lobeCenter(f: CtenoForm, side: -1 | 1, a: number, out: Vector3): Vector3 {
  const core = lobeCore(f, side, a);
  const w = f.lobeWidth[side < 0 ? 0 : 1]! * lobeRound(a);
  return out.set(side * (core.x - L.cup * w * 0.5), core.y, 0);
}

const A = CTENO.auricle;

/**
 * 耳状突起の芯の点（4つ。i は 0〜3、t は付け根 0 から先 1）。口のそば、口葉の間（±z の側）から外へ垂れ、先は外へ反る
 */
export function auriclePoint(f: CtenoForm, i: number, t: number, out: Vector3): Vector3 {
  const sx = i % 2 === 0 ? -1 : 1;
  const sz = i < 2 ? -1 : 1;
  const z0 = bodyRadius(f, 0.9) * B.flat * 0.85;
  const len = A.length;
  const y = A.y - t * len * 0.9;
  const z = sz * (z0 + t * len * 0.3 + A.curl * len * t * t);
  const x = sx * (0.035 + t * len * 0.1);
  return out.set(x, y, z);
}

/** 耳状突起の幅（先へ細くなる） */
export function auricleWidth(t: number): number {
  return A.width * (1 - 0.6 * t);
}

/** 櫛板の列の向き（8本）。0〜3 は口葉の側（±x の近く）で口葉の外側へ続き、4〜7 は耳状突起の側（±z の近く）で短い */
export function rowAngles(): number[] {
  const d = CTENO.rowAngle;
  return [d, -d, Math.PI - d, Math.PI + d, Math.PI / 2 - d, Math.PI / 2 + d, -Math.PI / 2 - d, -Math.PI / 2 + d];
}

export interface RowPoint {
  pos: Vector3;
  /** 外向きの面の向き */
  normal: Vector3;
  /** 列に沿った向き（頂から口の側へ） */
  tangent: Vector3;
  /** 列の始まりからの長さ */
  along: number;
  /** 口葉の上なら、その口葉の側（-1・+1）。胴なら 0 */
  side: number;
}

/** 櫛板の列 i の上に、間隔 gap で点を並べる（頂の近くから） */
export function rowPoints(f: CtenoForm, i: number, gap: number): RowPoint[] {
  const phi = rowAngles()[i]!;
  const long = i < 4;
  const attach = lobeAttach(f);
  const end = f.rowEnds[i]!;
  // 道筋を細かくたどる：胴の上（v）、続けて口葉の上（a）
  const path: Array<{ p: Vector3; side: number; at: (o: Vector3) => Vector3; a?: number }> = [];
  const steps = 120;
  const vEnd = long ? attach.v : CTENO.rowStart + (CTENO.rowShortEnd - CTENO.rowStart) * end;
  for (let s = 0; s <= steps; s++) {
    const v = CTENO.rowStart + (vEnd - CTENO.rowStart) * (s / steps);
    const at = (o: Vector3): Vector3 => bodyPoint(f, v, phi, o);
    path.push({ p: at(new Vector3()), side: 0, at });
  }
  if (long) {
    // 口葉の外側の面へ続く（胴の上と同じ横の位置から）
    const side: -1 | 1 = Math.cos(phi) > 0 ? 1 : -1;
    const zb = path[path.length - 1]!.p.z;
    const w0 = f.lobeWidth[side < 0 ? 0 : 1]! * 0.55;
    const b = Math.max(-0.7, Math.min(0.7, zb / w0));
    const psi = Math.acos(b);
    const aEnd = CTENO.rowLobeEnd * end;
    for (let s = 1; s <= steps; s++) {
      const a = aEnd * (s / steps);
      const at = (o: Vector3): Vector3 => lobePoint(f, side, a, psi, o);
      path.push({ p: at(new Vector3()), side, at, a });
    }
  }
  // 長さに沿って間隔 gap ごとに
  const out: RowPoint[] = [];
  let along = 0;
  let next = gap * 0.5;
  for (let s = 1; s < path.length; s++) {
    const a = path[s - 1]!;
    const b = path[s]!;
    const seg = a.p.distanceTo(b.p);
    while (next <= along + seg && seg > 0) {
      const t = (next - along) / seg;
      const pos = a.p.clone().lerp(b.p, t);
      const tangent = b.p.clone().sub(a.p).normalize();
      // 外向き：胴は軸から離れる向き、口葉は口葉の芯から離れる向き。列に直角にそろえる
      const radial =
        b.side === 0 ? new Vector3(pos.x, 0, pos.z / B.flat) : pos.clone().sub(lobeCenter(f, b.side as -1 | 1, b.a ?? 0, new Vector3())).setY(0);
      const normal = radial.sub(tangent.clone().multiplyScalar(radial.dot(tangent))).normalize();
      out.push({ pos, normal, tangent, along: next, side: b.side });
      next += gap;
    }
    along += seg;
  }
  return out;
}
