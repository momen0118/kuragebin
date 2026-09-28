import { describe, expect, test } from 'vitest';
import { MOTION } from '../config';
import { clampTilt, gravityForRoll, MotionFilter, type V3 } from './motionFilter';

const G = 9.80665;
const deg = (d: number): number => (d * Math.PI) / 180;

/** 端末の姿勢から、止まっているときのセンサーの値（仕様の符号：重力の反作用で上向き）。pitch は画面を上へ向ける角度、roll は右が下がる角度 */
function atRest(pitchDeg: number, rollDeg: number, sign = 1): V3 {
  const p = deg(pitchDeg);
  const r = deg(rollDeg);
  // 下向きの重力（端末の座標）
  const down: V3 = [Math.sin(r), -Math.cos(r) * Math.cos(p), -Math.cos(r) * Math.sin(p)];
  return [-down[0] * G * sign, -down[1] * G * sign, -down[2] * G * sign];
}

function feed(f: MotionFilter, withGravity: V3, seconds: number, linear: V3 | null = [0, 0, 0]): void {
  for (let t = 0; t < seconds; t += 1 / 60) f.push({ withGravity, linear, rotation: [0, 0, 0] }, 1 / 60);
}

describe('端末の動きを瓶の座標へ', () => {
  test('まっすぐ立てて持てば、重力は真下', () => {
    const f = new MotionFilter();
    feed(f, atRest(0, 0), 0.5);
    const g = f.sample()!.gravity;
    expect(g[0]).toBeCloseTo(0, 5);
    expect(g[1]).toBeCloseTo(-1, 5);
    expect(g[2]).toBeCloseTo(0, 5);
  });

  test('画面を上へ向けて持っていても、その角度に慣れて「まっすぐ」になる', () => {
    const f = new MotionFilter();
    feed(f, atRest(50, 0), 0.5);
    expect(f.sample()!.gravity[1]).toBeCloseTo(-1, 3);
    // 持つ角度を変えると、しばらくは前後に傾いて、そのうち慣れる
    feed(f, atRest(30, 0), 0.3);
    expect(Math.abs(f.sample()!.gravity[2])).toBeGreaterThan(0.1);
    feed(f, atRest(30, 0), MOTION.pitchAdapt * 5);
    expect(f.sample()!.gravity[2]).toBeCloseTo(0, 2);
  });

  test('左右の傾きはそのまま（慣れない）。上限の角度まで', () => {
    const f = new MotionFilter();
    feed(f, atRest(40, 10), MOTION.pitchAdapt * 5);
    const g = f.sample()!.gravity;
    expect(Math.atan2(g[0], -g[1]) * (180 / Math.PI)).toBeCloseTo(10, 1);
    feed(f, atRest(40, 60), 1);
    const h = f.sample()!.gravity;
    expect(Math.atan2(h[0], -h[1]) * (180 / Math.PI)).toBeCloseTo(MOTION.maxTilt, 1);
  });

  test('揺れは g で、上限まで。小さなぶれは 0', () => {
    const f = new MotionFilter();
    feed(f, atRest(0, 0), 0.5, [0.2, 0, 0]);
    expect(f.sample()!.accel).toEqual([0, 0, 0]);
    feed(f, atRest(0, 0), 0.1, [G * 2, 0, 0]);
    expect(f.sample()!.accel[0]).toBeGreaterThan(1.8);
    feed(f, atRest(0, 0), 0.1, [G * 10, 0, 0]);
    expect(f.sample()!.accel[0]).toBeCloseTo(MOTION.maxAccel, 5);
  });

  test('重力を分けて渡さない端末でも、重力と揺れを分ける', () => {
    const f = new MotionFilter();
    feed(f, atRest(0, 0), 1, null);
    expect(f.sample()!.gravity[1]).toBeCloseTo(-1, 3);
    const up = atRest(0, 0);
    f.push({ withGravity: [up[0] + G, up[1], up[2]], linear: null, rotation: null }, 1 / 60);
    expect(f.sample()!.accel[0]).toBeGreaterThan(0.5);
  });

  test('加速度の符号が逆の端末は、逆さに持っているように見えるので直す', () => {
    const f = new MotionFilter(1);
    feed(f, atRest(30, 0, -1), MOTION.flipCheckSeconds + 0.5);
    expect(f.accelSign).toBe(-1);
    feed(f, atRest(30, 0, -1), 0.5);
    expect(f.sample()!.gravity[1]).toBeCloseTo(-1, 3);
  });

  test('傾きの上限と、つまみの傾き', () => {
    const g = clampTilt([1, 0, 0], deg(20));
    expect(Math.atan2(g[0], -g[1])).toBeCloseTo(deg(20), 6);
    const r = gravityForRoll(15);
    expect(Math.atan2(r[0], -r[1])).toBeCloseTo(deg(15), 6);
  });
});
