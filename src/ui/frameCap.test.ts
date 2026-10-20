import { describe, expect, test } from 'vitest';
import { shouldDraw } from './frameCap';

/** hz の画面で seconds 秒、上限 fps で描いた回数（画面の更新の時刻は ±jitter ミリ秒揺れる） */
function drawn(hz: number, fps: number, seconds = 10, jitter = 0): number {
  let last = 0;
  let n = 0;
  for (let i = 1; i <= hz * seconds; i++) {
    const now = (i * 1000) / hz + (i % 2 ? jitter : -jitter);
    if (shouldDraw(now, last, fps)) {
      last = now;
      n++;
    }
  }
  return n / seconds;
}

describe('1秒に描く回数の上限', () => {
  test('60Hz の画面：60fps ならすべて描き、30fps なら1つおき', () => {
    expect(drawn(60, 60)).toBeCloseTo(60, 0);
    expect(drawn(60, 30)).toBeCloseTo(30, 0);
  });

  test('120Hz の画面でも上限を越えない', () => {
    expect(drawn(120, 60)).toBeCloseTo(60, 0);
    expect(drawn(120, 30)).toBeCloseTo(30, 0);
  });

  test('画面の更新の時刻が少し揺れても、30fps が 20fps に落ちない', () => {
    expect(drawn(60, 30, 10, 1.5)).toBeGreaterThan(29);
    expect(drawn(60, 60, 10, 1.5)).toBeGreaterThan(59);
  });
});
