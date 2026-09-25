// 複数のシェーダで共有する uniform。値を一度書き換えれば全部に効く
import { Vector2, Vector3, type Texture } from 'three';

export function createSharedUniforms() {
  return {
    uTime: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
    /** 画面の高さ（px）あたりの係数。点や線の太さを画面pxで決めるのに使う */
    uPixelRatio: { value: 1 },
    uKey: { value: new Vector3(1, 1, 1) },
    uKeyDir: { value: new Vector3(-0.8, 0.5, 0.3).normalize() },
    uAmbient: { value: new Vector3(0.2, 0.2, 0.2) },
    uCaustics: { value: 1 },
    uShadow: { value: 0.2 },
    uRimWarm: { value: 0 },
    /** 海月の発光：位置（ワールド）と、色×強さ */
    uGlowPos: { value: new Vector3(0, 0.45, 0) },
    uGlowColor: { value: new Vector3(0.3, 0.4, 0.5) },
    /** 部屋（背景）だけを描いた画像。海月の縁に背景の光を拾わせる */
    tRoom: { value: null as Texture | null },
    /** 光る部分だけを描くパスのとき 1 */
    uGlowPass: { value: 0 },
  };
}

export type SharedUniforms = ReturnType<typeof createSharedUniforms>;
