// 夜のデスクライト。画面外の左上にある小さなスポットライトとして、天板・瓶・海月・マリンスノーを照らす。
import { Vector2, Vector3 } from 'three';
import { LAMP } from '../config';

/**
 * シェーダで使うライトの uniform と関数。
 * uLampColor は色×強さ×点き具合（消えていれば 0）。uLampCone は円錐の縁の cos（外側, 内側）
 */
export const LAMP_GLSL = /* glsl */ `
uniform vec3 uLampColor;
uniform float uLampLevel;
uniform vec3 uLampPos;
uniform vec3 uLampAxis;
uniform vec2 uLampCone;
uniform float uLampRef;
// 点 p にライトの光がどれだけ届くか：円錐の中か（縁は少しぼける）と、距離による弱まり
float lampSpot(vec3 p) {
  vec3 d = p - uLampPos;
  float l = length(d);
  float c = dot(d / l, uLampAxis);
  return smoothstep(uLampCone.x, uLampCone.y, c) * pow(uLampRef / l, ${LAMP.falloffPower.toFixed(3)});
}
// 点 p からライトへ向かう向き
vec3 lampDir(vec3 p) {
  return normalize(uLampPos - p);
}
`;

/** ライトの uniform（共有）。色は描画側が点き具合に合わせて毎フレーム書き換える */
export function createLampUniforms() {
  const pos = new Vector3(...LAMP.position);
  const axis = new Vector3(...LAMP.aim).sub(pos).normalize();
  const outer = (LAMP.coneDeg * Math.PI) / 180;
  const inner = ((LAMP.coneDeg - LAMP.edgeDeg) * Math.PI) / 180;
  return {
    uLampColor: { value: new Vector3() },
    /** 点き具合（0〜1） */
    uLampLevel: { value: 0 },
    uLampPos: { value: pos },
    uLampAxis: { value: axis },
    uLampCone: { value: new Vector2(Math.cos(outer), Math.cos(inner)) },
    /** 光の弱まりの基準の距離（瓶の真ん中） */
    uLampRef: { value: pos.distanceTo(new Vector3(0, 0.45, 0)) },
  };
}

export type LampUniforms = ReturnType<typeof createLampUniforms>;

/** 材質に渡すライトの uniform（共有のものをそのまま使う） */
export function lampUniforms(u: LampUniforms): LampUniforms {
  return {
    uLampColor: u.uLampColor,
    uLampLevel: u.uLampLevel,
    uLampPos: u.uLampPos,
    uLampAxis: u.uLampAxis,
    uLampCone: u.uLampCone,
    uLampRef: u.uLampRef,
  };
}
