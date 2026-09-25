// 傘の断面の形。頂点シェーダ（bell.vert.glsl の bellProfile）と同じ式を保つこと。
// 傘の半径 = 1 の単位。s は頂点(0)から縁(1)まで、p は縮み具合。
import { BELL } from '../../config';

export function bellProfile(s: number, p: number): [number, number] {
  const [rR, hR, aR] = BELL.relaxed;
  const [rC, hC, aC] = BELL.contracted;
  const a0 = s * aR;
  const a1 = s * aC;
  const r = rR * Math.sin(a0) + (rC * Math.sin(a1) - rR * Math.sin(a0)) * p;
  const y0 = hR * Math.cos(a0);
  const y1 = hC * Math.cos(a1) + (hR - hC);
  return [r, y0 + (y1 - y0) * p];
}

/** 縁（s=1）での、断面の外向きの接線（下へ垂れる向き） */
export function marginTangent(p: number): [number, number] {
  const e = 1e-3;
  const [r1, y1] = bellProfile(1, p);
  const [r0, y0] = bellProfile(1 - e, p);
  const l = Math.hypot(r1 - r0, y1 - y0) || 1;
  return [(r1 - r0) / l, (y1 - y0) / l];
}

/** 8つの切れ込み（感覚器）による縁の半径の減り。θ はラジアン */
export function notch(theta: number, s: number): number {
  const k = (theta / (Math.PI / 4)) - 0.5;
  const d = (k - Math.round(k)) * (Math.PI / 4);
  const w = Math.min(Math.max((s - 0.86) / 0.14, 0), 1);
  return 1 - BELL.notchDepth * Math.exp(-(d * d) / 0.0035) * w * w;
}
