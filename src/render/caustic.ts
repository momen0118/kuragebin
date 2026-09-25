// 瓶が集めた光（天板の弧、瓶底の光の輪）の揺らめき。天板と瓶底で同じ揺れを使う。
import { CAUSTIC } from '../config';

/**
 * causticSway(s, t, ag)
 * s は光の筋に沿った位置（-1〜1 ほど）、t は時刻（秒）、ag は水面の揺れ（0〜1）。
 * 戻り値 x: 位置のずれ（瓶の高さ単位）、y: 明るさの倍率。
 * いつもは数秒の周期でゆっくり揺らめき、筋に沿って波がゆっくり進むので形もわずかにゆがむ。
 * 拍動で水面が揺れると大きく、少し細かくなり、揺れが収まるとまた落ち着く
 */
export const CAUSTIC_SWAY = /* glsl */ `
vec2 causticSway(float s, float t, float ag) {
  float k = 1.0 + ag * ${(CAUSTIC.agitationBoost - 1).toFixed(3)};
  float w = 0.5 * sin(s * 5.0 - t * 0.9 + 0.8 * sin(t * 0.23))
          + 0.3 * sin(s * 2.3 + t * 0.57 + 1.9)
          + 0.2 * sin(t * 1.4 + 4.2 + s * 1.1);
  w += ag * 0.6 * sin(s * 9.0 - t * 2.6);
  float b = 0.6 * sin(t * 0.7 + s * 3.1 + 0.4) + 0.4 * sin(t * 1.6 + s * 1.7 + 2.3);
  return vec2(w * ${CAUSTIC.sway.toFixed(4)} * k, 1.0 + b * ${CAUSTIC.flicker.toFixed(3)} * k);
}
`;
