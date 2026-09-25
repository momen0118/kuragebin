import { describe, expect, test } from 'vitest';
import { LIGHT_KEYS } from '../config';
import { lightAt, wrapHour } from './lighting';

describe('lightAt', () => {
  test('写真の重みはいつも合計1', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const l = lightAt(h);
      expect(l.day + l.dusk + l.night).toBeCloseTo(1, 6);
    }
  });

  test('昼・夕方・夜の代表の時刻', () => {
    expect(lightAt(12).day).toBeCloseTo(1);
    expect(lightAt(17).dusk).toBeCloseTo(1);
    expect(lightAt(23).night).toBeCloseTo(1);
    expect(lightAt(2).night).toBeCloseTo(1);
  });

  test('明け方は夜と昼を重ね、青みを乗せる', () => {
    const l = lightAt(5.25);
    expect(l.night).toBeGreaterThan(0.3);
    expect(l.day).toBeGreaterThan(0.3);
    expect(l.dawnTint).toBeCloseTo(1);
    expect(lightAt(12).dawnTint).toBe(0);
  });

  test('夜は窓の光がほぼない', () => {
    const l = lightAt(23);
    expect(Math.max(...l.key)).toBeLessThan(0.05);
    expect(l.caustics).toBe(0);
  });

  test('切り替えはなめらか（1分で大きく跳ばない）', () => {
    for (let m = 0; m < 24 * 60; m++) {
      const a = lightAt(m / 60);
      const b = lightAt((m + 1) / 60);
      expect(Math.abs(a.day - b.day)).toBeLessThan(0.05);
      expect(Math.abs(a.night - b.night)).toBeLessThan(0.05);
      expect(Math.abs(a.glow - b.glow)).toBeLessThan(0.05);
    }
  });

  test('24時をまたいでも同じ', () => {
    expect(lightAt(25)).toEqual(lightAt(1));
    expect(lightAt(-1)).toEqual(lightAt(23));
    expect(wrapHour(24)).toBe(0);
  });

  test('キーフレームは時刻の順に並んでいる', () => {
    for (let i = 1; i < LIGHT_KEYS.length; i++) {
      expect(LIGHT_KEYS[i]!.hour).toBeGreaterThanOrEqual(LIGHT_KEYS[i - 1]!.hour);
    }
    expect(LIGHT_KEYS[0]!.hour).toBe(0);
    expect(LIGHT_KEYS[LIGHT_KEYS.length - 1]!.hour).toBe(24);
  });
});
