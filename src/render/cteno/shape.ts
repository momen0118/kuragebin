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
  /** 口葉（[-x の側, +x の側]）の大きさの倍率と、前後の厚み */
  lobeScale: [number, number];
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
  const len = 1 + g.lobe * k.lobeLength;
  const wid = CTENO.lobe.width * (1 + g.lobe * k.lobeWidth);
  const rowEnds = Array.from({ length: 8 }, () => 1 - g.rowJitter * k.rowJitter * rng.next());
  return {
    radius: CTENO.body.radius * (1 - g.build * k.build),
    lobeScale: [len * (1 - skew), len * (1 + skew)],
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

/** 胴の半径（頂は丸く閉じ、頂の側ほど少し細い釣鐘の形） */
export function bodyRadius(f: CtenoForm, v: number): number {
  const taper = 1 - B.taper * (1 - v);
  if (v < B.cap) {
    const t = 1 - v / B.cap;
    return f.radius * taper * Math.sqrt(Math.max(0, 1 - t * t));
  }
  return f.radius * taper;
}

/** 胴の面の点（φ は口葉の向き +x から +z へ測る） */
export function bodyPoint(f: CtenoForm, v: number, phi: number, out: Vector3): Vector3 {
  const r = bodyRadius(f, v) * (1 + f.warp * Math.sin(phi - f.warpPhase) * Math.sin(Math.PI * v));
  return out.set(r * Math.cos(phi), bodyY(v), r * Math.sin(phi) * B.flat);
}

/** 口葉が胴に付く所（胴の列が口葉へ移る高さ）の v と、開閉の軸の x（外の縁の始まり） */
export function lobeAttach(f: CtenoForm): { v: number; x: number } {
  const v = (B.top - L.attach) / (B.top - B.bottom);
  const [sx, sy] = L.outline[L.shoulder]!;
  return { v, x: scaled(sx, sy, (f.lobeScale[0] + f.lobeScale[1]) / 2)[0] };
}

const OUT = L.outline;
const N_OUT = OUT.length;

/** 外形の上の t（0〜1 で一周、点 i は i / 点の数） */
export function outlineT(i: number): number {
  return i / N_OUT;
}

/** 大きさの倍率 scale を掛けた点（付け根の高さを中心に、下と外へ広がる） */
function scaled(x: number, y: number, scale: number): [number, number] {
  return [x * (1 + (scale - 1) * 0.6), L.attach + (y - L.attach) * scale];
}

/** 外形の点（+x の側）。点の間はなめらかにつなぐ（Catmull-Rom） */
function outlinePoint(t: number, scale: number): [number, number] {
  const u = (((t % 1) + 1) % 1) * N_OUT;
  const i = Math.floor(u);
  const s = u - i;
  const p = (k: number): readonly [number, number] => OUT[(((i + k) % N_OUT) + N_OUT) % N_OUT]!;
  const [p0, p1, p2, p3] = [p(-1), p(0), p(1), p(2)];
  const cr = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s * s + (-a + 3 * b - 3 * c + d) * s * s * s);
  return scaled(cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]), scale);
}

/**
 * 口葉の面の点。口葉は外形（開いて見える向きの輪郭）の中で前後に厚みを持つ座布団のような形。
 * side は -1（-x の側）か +1。t は外形を一周する位置（0 が付け根）、ψ は 0（前、+z）から π（後ろ、-z）まで。
 * sin ψ が外形への近さ（1 で外形の上）、cos ψ が前後の厚みの割合
 */
export function lobePoint(f: CtenoForm, side: -1 | 1, t: number, psi: number, out: Vector3): Vector3 {
  const i = side < 0 ? 0 : 1;
  const scale = f.lobeScale[i]!;
  const [ox, oy] = outlinePoint(t, scale);
  const [cx, cy] = scaled(L.center[0], L.center[1], scale);
  const rho = Math.sin(psi);
  return out.set(side * (cx + (ox - cx) * rho), cy + (oy - cy) * rho, f.lobeWidth[i]! * Math.cos(psi));
}

/** 口葉の芯の点（面の外向きを決めるため） */
export function lobeCenter(f: CtenoForm, side: -1 | 1, out: Vector3): Vector3 {
  const [cx, cy] = scaled(L.center[0], L.center[1], f.lobeScale[side < 0 ? 0 : 1]!);
  return out.set(side * cx, cy, 0);
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
  const path: Array<{ p: Vector3; side: number; at: (o: Vector3) => Vector3 }> = [];
  const steps = 120;
  const vEnd = long ? attach.v : CTENO.rowStart + (CTENO.rowShortEnd - CTENO.rowStart) * end;
  for (let s = 0; s <= steps; s++) {
    const v = CTENO.rowStart + (vEnd - CTENO.rowStart) * (s / steps);
    const at = (o: Vector3): Vector3 => bodyPoint(f, v, phi, o);
    path.push({ p: at(new Vector3()), side: 0, at });
  }
  if (long) {
    // 口葉の外の縁に沿って、細い先の手前まで続く（胴の上と同じ前後の側、外形のすぐ内側）
    const side: -1 | 1 = Math.cos(phi) > 0 ? 1 : -1;
    const front = Math.sin(phi) > 0;
    const rho = 0.94;
    const psi = front ? Math.asin(rho) : Math.PI - Math.asin(rho);
    const t0 = outlineT(L.shoulder);
    const t1 = t0 + (outlineT(L.tip) - t0) * CTENO.rowLobeEnd * end;
    for (let s = 1; s <= steps; s++) {
      const t = t0 + (t1 - t0) * (s / steps);
      const at = (o: Vector3): Vector3 => lobePoint(f, side, t, psi, o);
      path.push({ p: at(new Vector3()), side, at });
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
      const radial = b.side === 0 ? new Vector3(pos.x, 0, pos.z / B.flat) : pos.clone().sub(lobeCenter(f, b.side as -1 | 1, new Vector3()));
      const normal = radial.sub(tangent.clone().multiplyScalar(radial.dot(tangent))).normalize();
      out.push({ pos, normal, tangent, along: next, side: b.side });
      next += gap;
    }
    along += seg;
  }
  return out;
}
