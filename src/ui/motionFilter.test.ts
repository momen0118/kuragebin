import { describe, expect, test } from 'vitest';
import { KICK, MOTION } from '../config';
import { MotionFilter, ShakeDetector, type Kick, type MotionSample, type V3 } from './motionFilter';

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

function feed(f: MotionFilter, withGravity: V3, seconds: number, linear: V3 | null = [0, 0, 0], rotation: V3 = [0, 0, 0]): void {
  for (let t = 0; t < seconds; t += 1 / 60) f.push({ withGravity, linear, rotation }, 1 / 60);
}

describe('センサーの値を瓶の座標の揺れへ', () => {
  test('揺れは g で、上限まで。小さなぶれは 0', () => {
    const f = new MotionFilter();
    feed(f, atRest(0, 0), 0.5, [0.2, 0, 0]);
    expect(f.sample()!.accel).toEqual([0, 0, 0]);
    feed(f, atRest(0, 0), 0.1, [G * 2, 0, 0]);
    expect(f.sample()!.accel[0]).toBeGreaterThan(1.8);
    feed(f, atRest(0, 0), 0.1, [G * 10, 0, 0]);
    expect(f.sample()!.accel[0]).toBeCloseTo(MOTION.maxAccel, 5);
  });

  test('画面を上へ向けて持っていても、画面の手前向きに振れば、瓶の手前向きの揺れ', () => {
    const f = new MotionFilter();
    feed(f, atRest(50, 0), MOTION.pitchAdapt * 3);
    // 端末の z（画面から手前）を、持っている角度だけ戻すと瓶の z
    feed(f, atRest(50, 0), 0.05, [0, 0, G * 2]);
    const a = f.sample()!.accel;
    expect(Math.hypot(...a)).toBeCloseTo(2 - MOTION.accelDeadZone, 3);
  });

  test('重力を分けて渡さない端末でも、揺れを取り出す。ゆっくり傾けたぶんはほとんど入らない', () => {
    const f = new MotionFilter();
    feed(f, atRest(0, 0), 1, null);
    expect(Math.hypot(...f.sample()!.accel)).toBeLessThan(0.01);
    // 2秒かけて 20° 傾ける
    let peak = 0;
    for (let t = 0; t < 2; t += 1 / 60) {
      f.push({ withGravity: atRest(0, 10 * t), linear: null, rotation: null }, 1 / 60);
      peak = Math.max(peak, Math.hypot(...f.sample()!.accel));
    }
    expect(peak).toBeLessThan(KICK.accel * 0.2);
    const up = atRest(0, 20);
    f.push({ withGravity: [up[0] + 2 * G, up[1], up[2]], linear: null, rotation: null }, 1 / 60);
    expect(f.sample()!.accel[0]).toBeGreaterThan(0.5);
  });

  test('回す速さは速い分だけ。ゆっくり回したぶんは消えていく', () => {
    const f = new MotionFilter();
    feed(f, atRest(0, 0), 0.5, [0, 0, 0], [0, 0, 0]);
    // z まわり（alpha）に 60°/秒 で回し続ける
    feed(f, atRest(0, 0), MOTION.spinHighPass * 6, [0, 0, 0], [60, 0, 0]);
    expect(Math.hypot(...f.sample()!.spin)).toBeLessThan(0.05);
  });

  test('加速度の符号が逆の端末は、逆さに持っているように見えるので直す', () => {
    const f = new MotionFilter(1);
    feed(f, atRest(30, 0, -1), MOTION.flipCheckSeconds + 0.5);
    expect(f.accelSign).toBe(-1);
  });
});

describe('振ったことの検出', () => {
  const quiet = (): MotionSample => ({ accel: [0, 0, 0], spin: [0, 0, 0] });
  /** 決まった揺れを seconds 秒入れて、検出した一回を返す */
  function run(d: ShakeDetector, seconds: number, at: (t: number) => MotionSample): Kick[] {
    const out: Kick[] = [];
    for (let t = 0; t < seconds; t += 1 / 60) {
      const k = d.push(at(t), 1 / 60);
      if (k) out.push(k);
    }
    return out;
  }
  const sway = (amp: number, freq: number, dir: V3 = [1, 0, 0]) => (t: number): MotionSample => {
    const a = amp * Math.sin(2 * Math.PI * freq * t);
    return { accel: [dir[0] * a, dir[1] * a, dir[2] * a], spin: [0, 0, 0] };
  };

  test('手のぶれ・歩きながら持つ・軽く振るくらいでは越えない', () => {
    const d = new ShakeDetector();
    expect(run(d, 3, sway(0.3, 5))).toHaveLength(0);
    expect(run(d, 5, sway(0.5, 2, [0, 1, 0]))).toHaveLength(0);
    expect(run(d, 0.6, sway(0.7, 3.5))).toHaveLength(0);
  });

  test('机に置いたときの一瞬の衝撃では越えない', () => {
    const d = new ShakeDetector();
    const kicks = run(d, 1, (t) => (t < 1 / 60 ? { accel: [0, 3, 0], spin: [0, 0, 0] } : quiet()));
    expect(kicks).toHaveLength(0);
  });

  test('ゆっくり傾けたくらいの回りでは越えない', () => {
    const d = new ShakeDetector();
    expect(run(d, 2, () => ({ accel: [0.05, 0, 0], spin: [0, 0, 1.5] }))).toHaveLength(0);
  });

  test('手首で一回ぐっと振ると、振った向きに一回', () => {
    const d = new ShakeDetector();
    const kicks = run(d, 1, (t) => (t < 0.25 ? sway(2.2, 4)(t) : quiet()));
    expect(kicks.length).toBeGreaterThanOrEqual(1);
    expect(kicks.length).toBeLessThanOrEqual(2);
    const k = kicks[0]!;
    expect(k.spin).toBe(false);
    expect(k.dir[0]).toBeGreaterThan(0.99);
    expect(k.size).toBeGreaterThanOrEqual(KICK.base);
    expect(k.size).toBeLessThanOrEqual(1);
  });

  test('何往復も振れば何回も。次の一回までは少しあける', () => {
    const d = new ShakeDetector();
    const at: number[] = [];
    for (let t = 0; t < 1.4; t += 1 / 60) if (d.push(sway(2.4, 3)(t), 1 / 60)) at.push(t);
    expect(at.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(KICK.refractory + KICK.window - 0.02);
  });

  test('速く回すと、回した一回', () => {
    const d = new ShakeDetector();
    const kicks = run(d, 0.5, (t) => ({ accel: [0, 0, 0], spin: [0, 0, t < 0.2 ? 9 : 0] }));
    expect(kicks).toHaveLength(1);
    expect(kicks[0]!.spin).toBe(true);
    expect(kicks[0]!.dir[2]).toBeCloseTo(1, 5);
  });

  test('今の値と、少し前までのいちばん大きかった値を持つ', () => {
    const d = new ShakeDetector();
    run(d, 0.3, sway(1, 2));
    expect(d.accelPeak).toBeGreaterThan(0.5);
    run(d, KICK.peakHold + 0.2, quiet);
    expect(d.accel).toBeLessThan(0.01);
    expect(d.accelPeak).toBeLessThan(0.01);
  });
});
