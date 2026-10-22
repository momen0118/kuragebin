import { describe, expect, it } from 'vitest';
import { SAKURA } from '../config';
import { inSakuraSeason, petalOf } from './season';

const at = (m: number, d: number, h = 12, y = 2027): number => new Date(y, m - 1, d, h).getTime();

describe('桜の季節', () => {
  it('4月11日の0時から4月30日の終わりまで（端末の現地の日付）', () => {
    expect(inSakuraSeason(at(4, 10, 23))).toBe(false);
    expect(inSakuraSeason(at(4, 11, 0))).toBe(true);
    expect(inSakuraSeason(at(4, 20))).toBe(true);
    expect(inSakuraSeason(at(4, 30, 23))).toBe(true);
    expect(inSakuraSeason(at(5, 1, 0))).toBe(false);
    expect(inSakuraSeason(at(3, 25))).toBe(false);
  });

  it('花びらは季節の中だけ。同じ日なら同じ所、日が変われば決め直す', () => {
    expect(petalOf(at(5, 3))).toBeNull();
    for (let d = 11; d <= 30; d++) expect(petalOf(at(4, d, 1))).toEqual(petalOf(at(4, d, 22)));
  });

  it('花びらが落ちている日はおよそ3日に1日で、瓶の左右の決まった範囲にある', () => {
    let days = 0;
    let found = 0;
    for (let y = 2027; y < 2077; y++) {
      for (let d = 11; d <= 30; d++) {
        days++;
        const p = petalOf(at(4, d, 12, y));
        if (!p) continue;
        found++;
        expect(Math.abs(p.x)).toBeGreaterThanOrEqual(SAKURA.petalX[0]);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(SAKURA.petalX[1]);
        expect(p.z).toBeGreaterThanOrEqual(SAKURA.petalZ[0]);
        expect(p.z).toBeLessThanOrEqual(SAKURA.petalZ[1]);
      }
    }
    expect(found / days).toBeGreaterThan(0.27);
    expect(found / days).toBeLessThan(0.4);
  });
});
