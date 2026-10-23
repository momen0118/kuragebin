import { describe, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { CTENO } from '../../config';
import { BASE_BOLINOPSIS_GENES } from '../../sim/genes';
import { bodyRadius, ctenoForm, lobePoint, outlineT, rowPoints } from './shape';

describe('カブトクラゲの形', () => {
  test('櫛板の列：口葉の側の4本は口葉へ続いて長く、ほかの4本は短い。どれも頂の側から口の側へ並ぶ', () => {
    const f = ctenoForm(BASE_BOLINOPSIS_GENES, 1);
    const lengths = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rowPoints(f, i, CTENO.plateGap).length);
    for (let i = 0; i < 4; i++) for (let j = 4; j < 8; j++) expect(lengths[i]).toBeGreaterThan(lengths[j]!);
    for (let i = 0; i < 8; i++) {
      const pts = rowPoints(f, i, CTENO.plateGap);
      expect(pts[0]!.pos.y).toBeGreaterThan(pts.at(-1)!.pos.y);
      // 外向きは列に直角
      for (const p of pts) expect(Math.abs(p.normal.dot(p.tangent))).toBeLessThan(1e-6);
    }
    // 口葉の側の列は口葉の上で終わる
    expect(rowPoints(f, 0, CTENO.plateGap).at(-1)!.side).toBe(1);
    expect(rowPoints(f, 2, CTENO.plateGap).at(-1)!.side).toBe(-1);
  });

  test('個体差：すらりとした個体は胴が細く、口葉の大きい個体は口葉が長い。同じ遺伝子と種からは同じ形', () => {
    const base = ctenoForm(BASE_BOLINOPSIS_GENES, 7);
    const slim = ctenoForm({ ...BASE_BOLINOPSIS_GENES, build: 1 }, 7);
    const lobe = ctenoForm({ ...BASE_BOLINOPSIS_GENES, lobe: 1 }, 7);
    expect(bodyRadius(slim, 0.6)).toBeLessThan(bodyRadius(base, 0.6));
    const tip = (f: typeof base) => lobePoint(f, 1, outlineT(CTENO.lobe.tip), Math.PI / 2, new Vector3()).y;
    expect(tip(lobe)).toBeLessThan(tip(base));
    expect(ctenoForm(BASE_BOLINOPSIS_GENES, 7)).toEqual(base);
  });
});
