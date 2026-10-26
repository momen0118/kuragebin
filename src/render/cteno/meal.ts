// カブトクラゲが食べたあとの見え方：胴の中、咽頭のあたりに橙色の小さな粒が点々と透ける。
// 粒の場所は個体ごとに決め（体のローカル）、胃の濃さ（stomach.ts の level）につれて一つずつ見えたり消えたりする。
// 餌の見せ場では、捕まえた粒がこの粒の所まで運ばれて溶け込む（food.ts が speckLocal を使う）
import {
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  GLSL3,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Points,
  ShaderMaterial,
  Vector3,
  type Matrix4,
} from 'three';
import { CTENO, STOMACH } from '../../config';
import type { Rng } from '../../sim/rng';
import { LAMP_GLSL, lampUniforms } from '../lamp';
import common from '../shaders/common.glsl?raw';
import { frag } from '../shaders/glsl';
import type { SharedUniforms } from '../uniforms';

const M = CTENO.meal;

const VERT = /* glsl */ `
${common}
${LAMP_GLSL}
in float aSize;
in float aT;
uniform vec2 uResolution;
uniform vec3 uKey, uAmbient;
uniform float uLevel;
uniform float uScale;
uniform float uOpacity;
out float vAlpha;
out vec3 vColor;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  float proj = projectionMatrix[1][1] * uResolution.y * 0.5;
  float px = aSize * uScale * proj / -mv.z;
  float d = max(px, 1.5);
  gl_PointSize = d * 2.0;
  // 濃いほど多くの粒が見える（粒ごとに見えはじめる濃さが違う）
  float shown = smoothstep(aT - 0.08, aT, uLevel);
  vAlpha = shown * min(1.0, px * px / (d * d)) * uOpacity;
  vec3 p = wp.xyz;
  vColor = vec3(${STOMACH.color.map((v) => v.toFixed(3)).join(', ')}) * ${M.brightness.toFixed(3)}
    * (uAmbient * 0.9 + uKey * 0.4 + uLampColor * lampSpot(p) * 0.9);
}
`;

const FRAG = /* glsl */ `
in float vAlpha;
in vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(q, q) * 4.0) * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, a * 0.8);
}
`;

export class CtenoMeal {
  readonly points: Points;
  readonly count: number = M.specks;
  private readonly local: Float32Array;
  private readonly mat: ShaderMaterial;

  constructor(shared: SharedUniforms, rng: Rng, opacity: { value: number }) {
    const n = this.count;
    this.local = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const t = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // 咽頭のまわりに、真ん中ほど多く
      this.local[i * 3] = M.x * (rng.next() + rng.next() - 1);
      this.local[i * 3 + 1] = rng.range(M.y[0], M.y[1]);
      this.local[i * 3 + 2] = M.z * (rng.next() + rng.next() - 1);
      size[i] = M.size * rng.range(0.6, 1.2);
      // 見えはじめる濃さ：少し食べただけでも二、三粒は見える
      t[i] = 0.06 + 0.9 * ((i + rng.next() * 0.5) / n);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(this.local.slice(), 3));
    geo.setAttribute('aSize', new Float32BufferAttribute(size, 1));
    geo.setAttribute('aT', new Float32BufferAttribute(t, 1));
    this.mat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERT,
      fragmentShader: frag(FRAG),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      uniforms: {
        ...lampUniforms(shared),
        uResolution: shared.uResolution,
        uKey: shared.uKey,
        uAmbient: shared.uAmbient,
        uLevel: { value: 0 },
        uScale: { value: 1 },
        uOpacity: opacity,
      },
    });
    this.points = new Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
  }

  /** 体の座標と大きさ（ローカル 1 に当たる長さ）、胃の濃さ */
  sync(frame: Matrix4, scale: number, level: number): void {
    this.points.matrix.copy(frame);
    this.mat.uniforms.uScale!.value = scale;
    this.mat.uniforms.uLevel!.value = level;
  }

  /** i 番目の粒の場所（体のローカル） */
  speckLocal(i: number, out: Vector3): Vector3 {
    const k = ((i % this.count) + this.count) % this.count;
    return out.fromArray(this.local, k * 3);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
