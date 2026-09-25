import { describe, expect, test } from 'vitest';
import { BELL, JAR } from '../../config';
import { createRng } from '../../sim/rng';
import { createSharedUniforms } from '../uniforms';
import { Jellyfish } from './jellyfish';
import { swimBounds } from './swim';

describe('泳ぎ', () => {
  test('瓶の壁・底・水面にぶつからない（5分間）', { timeout: 60000 }, () => {
    const b = swimBounds();
    const inner = JAR.radius - JAR.glassThickness;
    for (const seed of [1, 2, 3]) {
      const j = new Jellyfish(createSharedUniforms(), createRng(seed));
      let low = Infinity;
      let high = -Infinity;
      for (let i = 0; i < 60 * 300; i++) {
        j.update(1 / 60);
        const p = j.swimmer.pos;
        // 傘の縁が瓶の内側に収まっている
        expect(Math.hypot(p.x, p.z) + BELL.radius).toBeLessThan(inner);
        expect(p.y + BELL.radius * BELL.apexY).toBeLessThan(JAR.waterLevel);
        expect(p.y).toBeGreaterThan(b.bottom - 0.05);
        low = Math.min(low, p.y);
        high = Math.max(high, p.y);
      }
      // 上のほうに張り付かず、瓶の上下を使う
      expect(high - low).toBeGreaterThan((b.top - b.bottom) * 0.5);
    }
  });

  test('ほとんどの時間は上向き（横倒しで泳ぎ続けない）', { timeout: 60000 }, () => {
    const j = new Jellyfish(createSharedUniforms(), createRng(7));
    let upright = 0;
    const n = 60 * 180;
    for (let i = 0; i < n; i++) {
      j.update(1 / 60);
      if (j.swimmer.axis.y > Math.cos((45 * Math.PI) / 180)) upright++;
    }
    expect(upright / n).toBeGreaterThan(0.9);
  });
});
