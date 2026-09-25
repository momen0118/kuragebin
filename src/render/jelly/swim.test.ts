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

  test('ふだんは上向きで、ときどき大きく傾く（ひっくり返らない）', { timeout: 60000 }, () => {
    for (const seed of [7, 8]) {
      const j = new Jellyfish(createSharedUniforms(), createRng(seed));
      let upright = 0;
      let maxTilt = 0;
      let minY = 1;
      const n = 60 * 300;
      for (let i = 0; i < n; i++) {
        j.update(1 / 60);
        const ay = j.swimmer.axis.y;
        if (ay > Math.cos((45 * Math.PI) / 180)) upright++;
        maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, ay)));
        minY = Math.min(minY, ay);
      }
      expect(upright / n).toBeGreaterThan(0.6);
      expect(maxTilt).toBeGreaterThan((50 * Math.PI) / 180);
      expect(minY).toBeGreaterThan(-0.35);
    }
  });
});
