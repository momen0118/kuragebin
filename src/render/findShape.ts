// 拾いものの形（CPU で作る）。どれも種から決まり、同じ種からはいつも同じ形。
// シーグラス：角の丸い平たいかけら（輪郭は少し角ばる）。小石：つぶれた丸み（ゆるいでこぼこ）。
// 貝殻のかけら：浅いお椀の一部（輪郭は割れたようにぎざぎざ）、放射状の筋。
// 原点は瓶底に触れる所の真ん中、上が +y。大きさは瓶の高さ単位。
import { BufferGeometry, Float32BufferAttribute, IcosahedronGeometry } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FIND_LOOK } from '../config';
import { createRng, type Rng } from '../sim/rng';
import type { FindKind } from '../sim/state';

export interface FindShape {
  geometry: BufferGeometry;
  /** 上から見た差し渡しの半分（指で押せる大きさや、写真の広さの目安）と、高さ */
  radius: number;
  height: number;
}

/** なめらかなでこぼこ（向き v の関数）。いくつかの波を重ねる */
function bumps(rng: Rng, count: number, freq: [number, number], amp: number): (x: number, y: number, z: number) => number {
  const waves = Array.from({ length: count }, () => {
    const th = rng.range(0, Math.PI * 2);
    const ph = Math.acos(rng.range(-1, 1));
    const f = rng.range(freq[0], freq[1]);
    return { kx: Math.sin(ph) * Math.cos(th) * f, ky: Math.cos(ph) * f, kz: Math.sin(ph) * Math.sin(th) * f, p: rng.range(0, Math.PI * 2), a: rng.range(0.5, 1) };
  });
  const norm = waves.reduce((s, w) => s + w.a, 0);
  return (x, y, z) => (amp * waves.reduce((s, w) => s + w.a * Math.sin(w.kx * x + w.ky * y + w.kz * z + w.p), 0)) / norm;
}

/** 輪郭の半径の揺らぎ（角度の関数）。低い次数の波と、角ばり */
function outline(rng: Rng, lobes: number, amp: number): (a: number) => number {
  const terms = Array.from({ length: lobes }, (_, i) => ({ m: i + 2, p: rng.range(0, Math.PI * 2), a: (amp * rng.range(0.4, 1)) / (i + 1) }));
  return (a) => 1 + terms.reduce((s, t) => s + t.a * Math.cos(t.m * a + t.p), 0);
}

/** 丸い面を変形して作る（シーグラスと小石）。pos は単位球の点を変形した位置 */
function fromSphere(detail: number, f: (x: number, y: number, z: number) => [number, number, number]): BufferGeometry {
  const ico = new IcosahedronGeometry(1, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico);
  ico.dispose();
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const v = f(p.getX(i), p.getY(i), p.getZ(i));
    p.setXYZ(i, v[0], v[1], v[2]);
  }
  g.computeVertexNormals();
  return g;
}

/** 下の端が y = -sink になるよう持ち上げる（瓶底の堆積に少し埋まる） */
function seat(g: BufferGeometry, height: number): void {
  g.computeBoundingBox();
  const minY = g.boundingBox!.min.y;
  g.translate(0, -minY - height * FIND_LOOK.sink, 0);
}

function glass(rng: Rng, len: number): FindShape {
  const thick = len * rng.range(...FIND_LOOK.glassThickness);
  const aspect = rng.range(0.6, 0.85);
  const rim = outline(rng, 4, 0.16);
  const wob = bumps(rng, 5, [1.5, 3], 0.06);
  const g = fromSphere(4, (x, y, z) => {
    const a = Math.atan2(z, x);
    const r = rim(a);
    // 平たい板：上下の面は平らに近く、縁は丸い
    const yy = Math.sign(y) * Math.pow(Math.abs(y), 0.55);
    const s = 1 + wob(x, y, z);
    return [x * len * r * s, yy * thick * 0.5, z * len * aspect * r * s];
  });
  seat(g, thick);
  return { geometry: g, radius: len, height: thick };
}

function pebble(rng: Rng, len: number): FindShape {
  const height = len * rng.range(...FIND_LOOK.pebbleHeight);
  const aspect = rng.range(0.65, 0.9);
  const big = bumps(rng, 6, [1, 2.2], 0.1);
  const fine = bumps(rng, 8, [3, 6], 0.02);
  const g = fromSphere(4, (x, y, z) => {
    const r = 1 + big(x, y, z) + fine(x, y, z);
    // 下は平たく（転がって落ち着いた向き）
    const yy = y < 0 ? y * 0.75 : y;
    return [x * len * r, yy * height * 0.5 * r, z * len * aspect * r];
  });
  seat(g, height);
  return { geometry: g, radius: len, height };
}

/** 貝殻のかけら：浅いお椀の一部を、割れたような輪郭で切り取る（両面を描く薄い面） */
function shell(rng: Rng, len: number): FindShape {
  const rings = 14;
  const segs = 48;
  const depth = len * rng.range(...FIND_LOOK.shellCurve);
  const aspect = rng.range(0.7, 0.95);
  const rim = outline(rng, 5, 0.18);
  // 割れ目：ところどころ深く欠ける
  const breaks = Array.from({ length: 3 }, () => ({ a: rng.range(0, Math.PI * 2), w: rng.range(0.25, 0.6), d: rng.range(0.12, 0.3) }));
  const ribs = Math.round(rng.range(14, 22));
  const ribAmp = depth * 0.06;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      let r = rim(a);
      for (const b of breaks) {
        const d = Math.atan2(Math.sin(a - b.a), Math.cos(a - b.a));
        r -= b.d * Math.max(0, 1 - Math.abs(d) / b.w);
      }
      const rr = u * r;
      const x = Math.cos(a) * rr * len;
      const z = Math.sin(a) * rr * len * aspect;
      // 上へふくらむ浅いお椀（てっぺんは殻頂の側へ寄る）と、放射状の筋
      const y = depth * (1 - rr * rr) + ribAmp * Math.sin(a * ribs) * rr;
      pos.push(x, y, z);
      uv.push(u, j / segs);
    }
  }
  const row = segs + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // 少し傾いて落ち着く（縁の一方が瓶底に触れる）
  g.rotateX(rng.range(-0.25, 0.25));
  g.rotateZ(rng.range(-0.25, 0.25));
  g.computeVertexNormals();
  seat(g, depth * 0.5);
  return { geometry: g, radius: len, height: depth };
}

/** 種類と種から形を作る */
export function findShape(kind: FindKind, seed: number): FindShape {
  const rng = createRng((seed ^ 0x2545f491) >>> 0);
  const [lo, hi] = FIND_LOOK.size[kind];
  const len = rng.range(lo, hi);
  if (kind === 'glass') return glass(rng, len);
  if (kind === 'pebble') return pebble(rng, len);
  return shell(rng, len);
}
