import { describe, expect, test } from 'vitest';
import { MOTION } from '../config';
import { clampTilt, gravityForRoll, MotionFilter, ShakeGate, type MotionSample, type V3 } from './motionFilter';

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

  test('左右の傾きはそのまま（慣れない）。手のぶれほどの傾きは除き、上限の角度まで', () => {
    const f = new MotionFilter();
    feed(f, atRest(40, 3), MOTION.pitchAdapt * 5);
    expect(f.sample()!.gravity[0]).toBeCloseTo(0, 6);
    feed(f, atRest(40, 12), 2);
    const g = f.sample()!.gravity;
    expect(Math.atan2(g[0], -g[1]) * (180 / Math.PI)).toBeCloseTo(12 - MOTION.tiltDeadZone, 1);
    feed(f, atRest(40, 60), 2);
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

describe('揺らしたいときだけ揺れる', () => {
  /** 横に振る（amp g、freq Hz、seconds 秒）。通した揺れのいちばん大きいところを返す */
  const shake = (amp: number, freq: number, seconds: number, gate: ShakeGate): number => {
    let peak = 0;
    for (let t = 0; t < seconds; t += 1 / 60) {
      const s: MotionSample = { gravity: [0, -1, 0], accel: [amp * Math.sin(2 * Math.PI * freq * t), 0, 0], spin: [0, 0, 0] };
      const out = gate.apply(s, 1 / 60)!;
      peak = Math.max(peak, Math.abs(out.accel[0]));
      expect(out.gravity).toEqual([0, -1, 0]);
    }
    return peak;
  };
  const still = (seconds: number, gate: ShakeGate): void => void shake(0, 1, seconds, gate);

  test('手のぶれ・歩きながら持つ・軽く揺らすくらいでは通さない', () => {
    const gate = new ShakeGate();
    expect(shake(0.3, 5, 3, gate)).toBe(0);
    expect(shake(0.45, 2, 5, gate)).toBe(0);
    expect(shake(0.7, 3.5, 0.6, gate)).toBe(0);
  });

  test('机に置いたときの一瞬の衝撃では通さない', () => {
    const gate = new ShakeGate();
    const hit: MotionSample = { gravity: [0, -1, 0], accel: [0, 3, 0], spin: [0, 0, 0] };
    gate.apply(hit, 1 / 60);
    gate.apply(hit, 1 / 60);
    still(1, gate);
    expect(gate.level).toBe(0);
  });

  test('手首で一回ぐっと振ると開き、少し遅れて水が回りだすほどかき混ぜる', () => {
    const gate = new ShakeGate();
    shake(2.2, 4, 0.25, gate);
    expect(gate.level).toBeGreaterThan(0);
    let stir = 0;
    for (let t = 0; t < 1; t += 1 / 60) stir = Math.max(stir, gate.apply({ gravity: [0, -1, 0], accel: [0, 0, 0], spin: [0, 0, 0] }, 1 / 60)!.stir!);
    expect(stir).toBeGreaterThan(0.3);
  });

  test('開いたときはゆっくり立ち上がる。収まるとしばらくして閉じる', () => {
    const gate = new ShakeGate();
    const first = { value: -1 };
    for (let t = 0; t < 1.5; t += 1 / 60) {
      const out = gate.apply({ gravity: [0, -1, 0], accel: [1.5 * Math.sin(2 * Math.PI * 3 * t), 0, 0], spin: [0, 0, 0] }, 1 / 60)!;
      if (gate.level > 0 && first.value < 0) first.value = Math.abs(out.accel[0]) / Math.max(Math.abs(1.5 * Math.sin(2 * Math.PI * 3 * t)), 1e-6);
    }
    expect(first.value).toBeLessThan(0.05);
    expect(gate.level).toBe(1);
    still(MOTION.shakeHold + MOTION.shakeSmooth * 6 + MOTION.shakeRampOut + 0.1, gate);
    expect(gate.level).toBe(0);
  });

  test('値が来なくなっても（デバッグの揺れが終わっても）、閉じきるまで続ける', () => {
    const gate = new ShakeGate();
    shake(2.2, 4, 0.25, gate);
    const out = gate.apply(null, 1 / 60);
    expect(out).not.toBeNull();
    for (let t = 0; t < 5; t += 1 / 60) gate.apply(null, 1 / 60);
    expect(gate.apply(null, 1 / 60)).toBeNull();
  });

  test('速く回したときも通す', () => {
    const gate = new ShakeGate();
    let out: MotionSample | null = null;
    for (let t = 0; t < 1; t += 1 / 60) out = gate.apply({ gravity: [0, -1, 0], accel: [0, 0, 0], spin: [0, 0, MOTION.shakeSpinOpen + 1] }, 1 / 60);
    expect(out!.spin[2]).toBeGreaterThan(MOTION.shakeSpinOpen);
  });
});
