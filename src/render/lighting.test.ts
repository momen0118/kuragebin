import { describe, expect, test } from 'vitest';
import { buildKeys, lightAt, sunOf, wrapHour } from './lighting';
import { sunTimes } from '../sim/sun';

// 春分ごろの目安
const SUN = { sunrise: 5.5, sunset: 17.75 };

describe('lightAt', () => {
  test('写真の重みはいつも合計1', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const l = lightAt(h, SUN);
      expect(l.day + l.dusk + l.night).toBeCloseTo(1, 6);
    }
  });

  test('昼・夕方・夜の代表の時刻', () => {
    expect(lightAt(12, SUN).day).toBeCloseTo(1);
    expect(lightAt(SUN.sunset - 0.3, SUN).dusk).toBeCloseTo(1);
    expect(lightAt(23, SUN).night).toBeCloseTo(1);
    expect(lightAt(2, SUN).night).toBeCloseTo(1);
  });

  test('明け方は夜と昼を重ね、青みを乗せる', () => {
    const l = lightAt(SUN.sunrise - 20 / 60, SUN);
    expect(l.night).toBeGreaterThan(0.3);
    expect(l.day).toBeGreaterThan(0.3);
    expect(l.dawnTint).toBeCloseTo(1);
    expect(lightAt(12, SUN).dawnTint).toBe(0);
  });

  test('夜は窓の光がほぼない', () => {
    const l = lightAt(23, SUN);
    expect(Math.max(...l.key)).toBeLessThan(0.05);
    expect(l.lensLight).toBe(0);
  });

  test('夕方、日の入りの少し前に縁へ温度が乗る', () => {
    expect(lightAt(SUN.sunset - 25 / 60, SUN).rimWarm).toBeCloseTo(1);
    expect(lightAt(12, SUN).rimWarm).toBeLessThan(0.01);
  });

  test('切り替えはなめらか（1分で大きく跳ばない）', () => {
    for (let m = 0; m < 24 * 60; m++) {
      const a = lightAt(m / 60, SUN);
      const b = lightAt((m + 1) / 60, SUN);
      expect(Math.abs(a.day - b.day)).toBeLessThan(0.05);
      expect(Math.abs(a.night - b.night)).toBeLessThan(0.05);
      expect(Math.abs(a.glow - b.glow)).toBeLessThan(0.05);
    }
  });

  test('24時をまたいでも同じ', () => {
    expect(lightAt(25, SUN)).toEqual(lightAt(1, SUN));
    expect(lightAt(-1, SUN)).toEqual(lightAt(23, SUN));
    expect(wrapHour(24)).toBe(0);
  });

  test('キーフレームは時刻の順に並び、0時〜24時をおおう', () => {
    const keys = buildKeys(SUN);
    for (let i = 1; i < keys.length; i++) expect(keys[i]!.hour).toBeGreaterThanOrEqual(keys[i - 1]!.hour);
    expect(keys[0]!.hour).toBeLessThan(0);
    expect(keys[keys.length - 1]!.hour).toBeGreaterThan(24);
  });

  test('夏は昼が長く、冬は短い（日本時間の値で）', () => {
    const summer = { sunrise: 4.42, sunset: 19.02 };
    const winter = { sunrise: 6.78, sunset: 16.53 };
    // 夏の夕方5時はまだ昼、冬の夕方6時はもう夜
    expect(lightAt(17, summer).day).toBeGreaterThan(0.9);
    expect(lightAt(18, winter).night).toBeGreaterThan(0.9);
    // 夏の朝5時半は明るく、冬の朝5時半はまだ夜
    expect(lightAt(5.5, summer).day).toBeGreaterThan(0.9);
    expect(lightAt(5.5, winter).night).toBeGreaterThan(0.9);
  });

  test('日の出・日の入りが0時をまたいでもつながる（日本以外のタイムゾーン）', () => {
    // UTC の端末で、日本の空に合わせたとき
    const sun = { sunrise: 20.5, sunset: 8.75 };
    expect(lightAt(2, sun).day).toBeGreaterThan(0.9);
    expect(lightAt(14, sun).night).toBeGreaterThan(0.9);
    for (let m = 0; m < 24 * 60; m++) {
      const a = lightAt(m / 60, sun);
      const b = lightAt((m + 1) / 60, sun);
      expect(Math.abs(a.day - b.day)).toBeLessThan(0.05);
    }
  });

  test('今日の日の出は日の入りより前か、0時をまたいでいる', () => {
    const s = sunOf(new Date(2026, 8, 25, 12));
    const len = (s.sunset - s.sunrise + 24) % 24;
    expect(len).toBeGreaterThan(10);
    expect(len).toBeLessThan(14);
  });
});

describe('sunTimes', () => {
  // 東京の実際の値（国立天文台）との差が数分以内
  test.each([
    [new Date(2026, 5, 21, 12), 4 + 25 / 60, 19 + 1 / 60],
    [new Date(2026, 11, 22, 12), 6 + 47 / 60, 16 + 32 / 60],
    [new Date(2026, 2, 20, 12), 5 + 45 / 60, 17 + 53 / 60],
  ])('%s', (date, rise, set) => {
    // 端末のタイムゾーンによらず、JST に直して比べる
    const s = sunTimes(date, 35.6895, 139.6917);
    const tzShift = (9 * 60 + date.getTimezoneOffset()) / 60;
    const toJst = (h: number): number => (((h + tzShift) % 24) + 24) % 24;
    expect(Math.abs(toJst(s.sunrise) - rise)).toBeLessThan(0.1);
    expect(Math.abs(toJst(s.sunset) - set)).toBeLessThan(0.1);
  });
});
