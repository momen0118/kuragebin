import { describe, expect, test } from 'vitest';
import { CTENO } from '../../config';
import { createRng } from '../../sim/rng';
import { CombDrive } from './drive';

const run = (d: CombDrive, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 60) d.update(1 / 60);
};

describe('カブトクラゲの櫛板の泳ぎ', () => {
  test('拍動しない：押し出す強さはなめらかで、泳ぐ調子のほうが漂う調子より強い。櫛板もそれに合わせて速く打つ', () => {
    const d = new CombDrive(createRng(1));
    expect(d.contracting).toBe(false);
    d.setStyle(1, 1, 1);
    run(d, 10);
    const drift = d.thrustRate();
    const driftBeat = d.beatRate();
    d.setStyle(1, 0, 1);
    run(d, 10);
    expect(d.thrustRate()).toBeGreaterThan(drift * 2);
    expect(d.beatRate()).toBeGreaterThan(driftBeat);
    // 1/60 秒ごとの変化は小さい（拍動のような山がない）
    const a = d.thrustRate();
    run(d, 1 / 60);
    expect(Math.abs(d.thrustRate() - a)).toBeLessThan(0.02);
  });

  test('つつかれると、しばらく櫛板を逆に打ち（前へは押さない）、そのあと元に戻る。波の位相は逆に進む', () => {
    const d = new CombDrive(createRng(2));
    d.setStyle(1, 0, 1);
    run(d, 5);
    d.startle(1);
    const p0 = d.beatPhase;
    run(d, 0.5);
    expect(d.beatRate()).toBeLessThan(0);
    expect(d.thrustRate()).toBe(0);
    expect(d.beatPhase).toBeLessThan(p0);
    run(d, CTENO.poke.reverseTime + 5);
    expect(d.beatRate()).toBeGreaterThan(0);
    expect(d.thrustRate()).toBeGreaterThan(0);
  });
});
