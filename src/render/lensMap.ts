// 瓶の中身（海月やポリプ）が、手前のガラスと水のレンズを通して画面のどこに見えるか。
// 手前のガラスのシェーダ（jarShaders.ts の中身の読み方）と同じ曲げ方を CPU でたどり、逆に解く。
// 札の線を、見えている個体にぴったり付けるために使う。
import { Vector2, Vector3, type PerspectiveCamera } from 'three';
import { JAR } from '../config';

const R = JAR.radius;
const Ri = JAR.radius - JAR.glassThickness;

const tmpO = new Vector3();
const tmpD = new Vector3();
const tmpP = new Vector3();
const tmpS = new Vector3();
const tmpA = new Vector3();

/** 手前の面で曲がる角度（シェーダの cylinderLens の front と同じ） */
function frontBend(b: number, nIn: number): number {
  const i1 = Math.asin(Math.min(b / R, 0.9999));
  const pg = b / JAR.iorGlass;
  const t1 = Math.asin(Math.min(pg / R, 0.9999));
  const i2 = Math.asin(Math.min(pg / Ri, 0.9999));
  const t2 = Math.asin(Math.min(b / (nIn * Ri), 0.95));
  return i1 - t1 + (i2 - t2);
}

/**
 * 画面の点（ndc）で、手前のガラスが読む中身の点（瓶の軸を通る面の上、瓶の中心が原点）。
 * ガラスに当たらない所なら null
 */
export function contentsAt(cam: PerspectiveCamera, ndcX: number, ndcY: number, out: Vector3): Vector3 | null {
  const o = tmpO.setFromMatrixPosition(cam.matrixWorld);
  const d = tmpD.set(ndcX, ndcY, 0.5).unproject(cam).sub(o).normalize();
  const a = d.x * d.x + d.z * d.z;
  const b = 2 * (o.x * d.x + o.z * d.z);
  const c = o.x * o.x + o.z * o.z - R * R;
  const disc = b * b - 4 * a * c;
  if (a < 1e-9 || disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t <= 0) return null;
  const P = tmpP.copy(o).addScaledVector(d, t);
  if (P.y < JAR.bottomThickness || P.y > JAR.height) return null;
  const hl = Math.hypot(d.x, d.z);
  const hx = d.x / hl;
  const hz = d.z / hl;
  const slope = d.y / hl;
  const cr = P.x * hz - P.z * hx;
  const bb = Math.min(Math.abs(cr), R * 0.9999);
  const nIn = P.y < JAR.waterLevel ? JAR.iorWater : 1;
  const ang = (cr >= 0 ? 1 : -1) * frontBend(bb, nIn);
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  const ix = cs * hx - sn * hz;
  const iz = sn * hx + cs * hz;
  const fl = Math.hypot(o.x, o.z) || 1;
  const fx = -o.x / fl;
  const fz = -o.z / fl;
  const sQ = -(P.x * fx + P.z * fz) / Math.max(ix * fx + iz * fz, 1e-3);
  return out.set(P.x + ix * sQ, P.y + (slope * sQ) / nIn, P.z + iz * sQ);
}

/**
 * 瓶の中の点 p（瓶の中心が原点）が、レンズ越しに見える画面の位置（ndc）。
 * ガラスの外なら、そのまま投影した位置
 */
export function apparentNdc(cam: PerspectiveCamera, p: Vector3, out: Vector2): Vector2 {
  const target = tmpA.copy(p).project(cam);
  const tx = target.x;
  const ty = target.y;
  let x = tx;
  let y = ty;
  const h = 1e-3;
  const f = (px: number, py: number): [number, number] | null => {
    const s = contentsAt(cam, px, py, tmpS);
    if (!s) return null;
    s.project(cam);
    return [s.x - tx, s.y - ty];
  };
  for (let i = 0; i < 6; i++) {
    const f0 = f(x, y);
    if (!f0) break;
    if (Math.abs(f0[0]) + Math.abs(f0[1]) < 1e-5) break;
    const fx = f(x + h, y);
    const fy = f(x, y + h);
    if (!fx || !fy) break;
    const a = (fx[0] - f0[0]) / h;
    const b = (fy[0] - f0[0]) / h;
    const c = (fx[1] - f0[1]) / h;
    const d = (fy[1] - f0[1]) / h;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-9) break;
    x -= (d * f0[0] - b * f0[1]) / det;
    y -= (-c * f0[0] + a * f0[1]) / det;
  }
  return out.set(x, y);
}
