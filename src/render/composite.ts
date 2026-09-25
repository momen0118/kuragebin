// 最後の合成。ブルームを足し、天板に瓶の映り込みを落として画面へ出す。
import { Matrix4, Vector3, type Texture } from 'three';
import { JAR } from '../config';
import { FullscreenPass } from './fullscreen';
import common from './shaders/common.glsl?raw';
import output from './shaders/output.glsl?raw';

const FRAG = /* glsl */ `
${common}
${output}
#define JAR_R ${JAR.radius.toFixed(5)}
#define JAR_H ${JAR.height.toFixed(5)}
uniform sampler2D tScene;
uniform sampler2D tRoom;
uniform sampler2D tBloom;
uniform float uBloomStrength;
uniform mat4 uInvViewProj;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uTableBackZ;
uniform float uTableLeftX;
in vec2 vUv;

// 天板（艶のあるウォルナット）への瓶の映り込み。瓶がさえぎった分だけ差し替える
vec3 tableReflection(vec2 uv) {
  vec4 wp = uInvViewProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(wp.xyz / wp.w - uCamPos);
  if (dir.y > -1e-3) return vec3(0.0);
  vec3 P = uCamPos + dir * (-uCamPos.y / dir.y);
  if (P.z < uTableBackZ || P.x < uTableLeftX) return vec3(0.0);
  vec3 R = vec3(dir.x, -dir.y, dir.z);
  float a = R.x * R.x + R.z * R.z;
  float b = 2.0 * (P.x * R.x + P.z * R.z);
  float c = P.x * P.x + P.z * P.z - JAR_R * JAR_R;
  float disc = b * b - 4.0 * a * c;
  if (disc <= 0.0) return vec3(0.0);
  float s = (-b - sqrt(disc)) / (2.0 * a);
  if (s <= 0.0) return vec3(0.0);
  vec3 Q = P + R * s;
  if (Q.y > JAR_H) return vec3(0.0);
  vec4 clip = uViewProj * vec4(Q, 1.0);
  vec2 q = clip.xy / clip.w * 0.5 + 0.5;
  // 離れるほどぼやける
  float spread = 0.0015 + Q.y * 0.012;
  vec3 jar = vec3(0.0);
  vec3 room = vec3(0.0);
  for (int i = -2; i <= 2; i++) {
    vec2 o = vec2(0.0, float(i) * spread);
    jar += texture(tScene, q + o).rgb;
    room += texture(tRoom, q + o).rgb;
  }
  jar /= 5.0;
  room /= 5.0;
  jar += texture(tBloom, q).rgb * uBloomStrength;
  float F = 0.04 + 0.96 * pow(1.0 - (-dir.y), 5.0);
  float edge = smoothstep(0.0, 0.02, disc);
  float fade = exp(-Q.y * 3.0) * edge;
  return (jar - room) * F * fade * 1.6;
}

void main() {
  vec3 c = texture(tScene, vUv).rgb;
  c += texture(tBloom, vUv).rgb * uBloomStrength;
  c = max(c + tableReflection(vUv), 0.0);
  gl_FragColor = vec4(outputTransform(c, gl_FragCoord.xy), 1.0);
}
`;

export function createComposite(tableBackZ: number, tableLeftX: number) {
  return new FullscreenPass(FRAG, {
    tScene: { value: null as Texture | null },
    tRoom: { value: null as Texture | null },
    tBloom: { value: null as Texture | null },
    uBloomStrength: { value: 0 },
    uInvViewProj: { value: new Matrix4() },
    uViewProj: { value: new Matrix4() },
    uCamPos: { value: new Vector3() },
    uTableBackZ: { value: tableBackZ },
    uTableLeftX: { value: tableLeftX },
    uFade: { value: 1 },
  });
}
