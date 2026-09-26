// 複数のシェーダで共有する uniform。値を一度書き換えれば全部に効く
import { Matrix4, Vector2, Vector3, Vector4, type Texture } from 'three';
import { createLampUniforms } from './lamp';

export function createSharedUniforms() {
  return {
    /** 夜のデスクライト（lamp.ts） */
    ...createLampUniforms(),
    uTime: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
    /** 画面の高さ（px）あたりの係数。点や線の太さを画面pxで決めるのに使う */
    uPixelRatio: { value: 1 },
    /** カメラの投影×視点（ワールド座標から画面へ） */
    uViewProj: { value: new Matrix4() },
    uKey: { value: new Vector3(1, 1, 1) },
    uKeyDir: { value: new Vector3(-0.8, 0.5, 0.3).normalize() },
    uAmbient: { value: new Vector3(0.2, 0.2, 0.2) },
    /** 瓶がレンズになって集める光の強さ（窓の光が強いほど） */
    uLensLight: { value: 1 },
    uShadow: { value: 0.2 },
    uRimWarm: { value: 0 },
    /** 海月の拍動で水面が揺れている度合い（0〜1） */
    uAgitation: { value: 0 },
    /** 光る海月の光：位置（ワールド）と、色×強さ（ミズクラゲは光らないので 0） */
    uGlowPos: { value: new Vector3(0, 0.45, 0) },
    uGlowColor: { value: new Vector3(0.3, 0.4, 0.5) },
    /** 部屋（背景）だけを描いた画像。海月の縁に背景の光を拾わせる */
    tRoom: { value: null as Texture | null },
    /** 光る部分だけを描くパスのとき 1 */
    uGlowPass: { value: 0 },
    /** 瓶の口を境に描く所を分ける（shaders/clip.ts）。0 は分けない、1 は瓶の中だけ、2 は瓶の外だけ */
    uClipMode: { value: 0 },
    /**
     * 水面の波紋（描いている瓶の分）。1つずつ (x, z, 始まった時刻, 強さ)。強さ 0 は無し。
     * カップを沈めたとき・引き上げたとき・注いだときに立つ
     */
    uRipples: { value: [new Vector4(), new Vector4(), new Vector4(), new Vector4()] },
  };
}

export type SharedUniforms = ReturnType<typeof createSharedUniforms>;
