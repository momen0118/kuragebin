// スポイト。薄い半透明のプラスチックの、細い管と球がひと続きになったもの（飾りのない形）。
// 中は水と餌（ブラインシュリンプ）だけ。瓶の口から降りて先を水面の下にそっと入れ、球を押して水の中で餌を出す。
// 形は先の真ん中が原点、上が +y。位置と球の押し具合は描画側が毎フレーム決める。
// 瓶の口より下の部分は瓶の中身として、上の部分は背景に重ねて描く（shaders/clip.ts）。
import {
  BackSide,
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  FrontSide,
  GLSL3,
  Group,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  type Vector3,
} from 'three';
import { CUP, FOOD, JAR, PIPETTE } from '../config';
import { PLASTIC_LIGHT_GLSL } from './cup';
import { LAMP_GLSL, lampUniforms } from './lamp';
import { CLIP_GLSL } from './shaders/clip';
import common from './shaders/common.glsl?raw';
import { frag } from './shaders/glsl';
import type { SharedUniforms } from './uniforms';

const P = PIPETTE;
/** いちばん上（球のてっぺん） */
export const PIPETTE_LENGTH = P.stemTop + P.bulbHeight;

function smooth(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}

/** 高さ y（先から）での外側の半径。先が細く、管はまっすぐ、上に楕円の球 */
function radiusAt(y: number): number {
  const half = P.bulbHeight / 2;
  // 管は球の真ん中まで（そこから上は球だけで、てっぺんで閉じる）
  const stem = y <= P.stemTop + half ? P.tipRadius + (P.stemRadius - P.tipRadius) * smooth(y / P.taperLength) : 0;
  const u = (y - (P.stemTop + half)) / half;
  const bulb = Math.abs(u) < 1 ? P.bulbRadius * Math.sqrt(1 - u * u) : 0;
  // 管と球をなめらかにつなぐ（大きいほうへ寄せる）
  const k = 0.006;
  const h = Math.min(Math.max(0.5 + (0.5 * (bulb - stem)) / k, 0), 1);
  return stem + (bulb - stem) * h + k * h * (1 - h);
}

/** 押したときに縮む割合の重み（球の真ん中ほど強い） */
function bulbWeight(y: number): number {
  const u = (y - P.stemTop) / P.bulbHeight;
  return u > 0 && u < 1 ? Math.sin(Math.PI * u) ** 2 : 0;
}

/** 断面を回した面。先は開いていて（餌の出口）、球のてっぺんは閉じる */
function pipetteGeometry(): BufferGeometry {
  const prof: Array<[number, number]> = [];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    // 先と球のまわりを細かく
    const t = i / n;
    const y = PIPETTE_LENGTH * (t < 0.5 ? 0.5 * (2 * t) ** 1.6 : 1 - 0.5 * (2 - 2 * t) ** 1.2);
    prof.push([i === n ? 0 : radiusAt(y), y]);
  }
  const seg = 28;
  const pos: number[] = [];
  const nrm: number[] = [];
  const info: number[] = [];
  for (let i = 0; i < prof.length; i++) {
    const prev = prof[Math.max(i - 1, 0)]!;
    const next = prof[Math.min(i + 1, prof.length - 1)]!;
    let tr = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const tl = Math.hypot(tr, ty) || 1;
    tr /= tl;
    ty /= tl;
    const [r, y] = prof[i]!;
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      pos.push(r * c, y, r * s);
      nrm.push(ty * c, -tr, ty * s);
      info.push(y, bulbWeight(y), j / seg);
    }
  }
  const row = seg + 1;
  const idx: number[] = [];
  for (let i = 0; i < prof.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setAttribute('aInfo', new Float32BufferAttribute(info, 3));
  g.setIndex(idx);
  return g;
}

const DEFS = /* glsl */ `
#define WATER_Y ${JAR.waterLevel.toFixed(5)}
#define FRESNEL_GAIN ${P.fresnel.toFixed(4)}
#define BODY ${P.body.toFixed(4)}
#define IN_WATER ${CUP.inWater.toFixed(4)}
#define SQUEEZE ${P.squeezeDepth.toFixed(4)}
#define STEM_TOP ${P.stemTop.toFixed(4)}
#define LOAD_H ${P.loadHeight.toFixed(4)}
#define TINT vec3(${P.tint.map((v) => v.toFixed(3)).join(', ')})
#define FOOD_COLOR vec3(${FOOD.color.map((v) => v.toFixed(3)).join(', ')})
`;

const VERT = /* glsl */ `
${DEFS}
// 先からの高さ、押したときに縮む重み、まわりの角度（0〜1）
in vec3 aInfo;
uniform float uSqueeze;
out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec2 vInfo;
void main() {
  vec3 p = position;
  p.xz *= 1.0 - uSqueeze * SQUEEZE * aInfo.y;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vInfo = aInfo.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * スポイトの面。uSide が 0 で奥の面（内側から見る）、1 で手前の面。
 * 乳白の薄いプラスチック：縁で反射が強まり（フレネル）、窓やデスクライトのハイライトが細く乗る。
 * 管の下のほうには、水ごと吸った餌が橙色の細かい粒として透けて見える（押すと減る）
 */
const FRAG = /* glsl */ `
${common}
${LAMP_GLSL}
${CLIP_GLSL}
${DEFS}
${PLASTIC_LIGHT_GLSL}
uniform float uAlpha, uLoad, uSide;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec2 vInfo;
void main() {
  clipToJar(vWorldPos);
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float facing = dot(N, V);
  vec3 Nf = facing < 0.0 ? -N : N;
  float NdV = abs(facing);
  float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  float k = inJarWater(vWorldPos) ? IN_WATER : 1.0;
  vec3 R = reflect(-V, Nf);
  vec3 lampC = uLampColor * lampSpot(vWorldPos);
  vec3 L = lampDir(vWorldPos);
  float spec = pow(max(dot(R, normalize(uKeyDir)), 0.0), 60.0);
  float lspec = pow(max(dot(R, L), 0.0), 50.0);
  // 乳白：光が少し回って、面そのものがうっすら明るい
  float wrap = saturate(dot(Nf, uKeyDir) * 0.5 + 0.5);
  float wrapL = saturate(dot(Nf, L) * 0.5 + 0.5);
  vec3 milk = TINT * (uAmbient * 0.9 + uKey * 0.3 * wrap + lampC * 0.6 * wrapL);
  vec3 col = (envColor(R) * F * FRESNEL_GAIN + uKey * spec * 0.6 + lampC * lspec) * k + milk * BODY * 1.5;
  float a = (F * 0.8 + BODY) * k;
  // 管の中の餌：下のほうに細かい粒がまばらに透ける
  float y = vInfo.x;
  float band = (1.0 - smoothstep(LOAD_H * 0.6, LOAD_H, y)) * step(y, STEM_TOP) * smoothstep(0.004, 0.012, y);
  // 粒は升目ごとに1つ置くかどうか（升目は段ごとにずらし、並んで見えないように）
  float row = floor(y * 260.0);
  vec2 cell = vec2(row, floor(vInfo.y * 5.0 + hash12(vec2(row, 7.0 + uSide)) * 5.0));
  float grain = step(0.8, hash12(cell));
  float food = uLoad * band * (0.1 + 0.9 * grain);
  col += FOOD_COLOR * (uAmbient * 0.9 + uKey * 0.3 + lampC * 0.7) * food * 0.9;
  a += food * 0.45;
  gl_FragColor = vec4(col * uAlpha, min(a, 1.0) * uAlpha);
}
`;

export class Pipette {
  readonly group = new Group();
  private readonly uniforms;

  constructor(shared: SharedUniforms) {
    this.uniforms = {
      ...lampUniforms(shared),
      uKey: shared.uKey,
      uKeyDir: shared.uKeyDir,
      uAmbient: shared.uAmbient,
      uClipMode: shared.uClipMode,
      uAlpha: { value: 0 },
      uSqueeze: { value: 0 },
      uLoad: { value: P.load as number },
    };
    const geo = pipetteGeometry();
    const make = (side: number): Mesh => {
      const m = new Mesh(
        geo,
        new ShaderMaterial({
          glslVersion: GLSL3,
          vertexShader: VERT,
          fragmentShader: frag(FRAG),
          side: side === 0 ? BackSide : FrontSide,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          blending: CustomBlending,
          blendSrc: OneFactor,
          blendDst: OneMinusSrcAlphaFactor,
          uniforms: { ...this.uniforms, uSide: { value: side } },
        }),
      );
      m.frustumCulled = false;
      return m;
    };
    const back = make(0);
    back.renderOrder = 20;
    const front = make(1);
    front.renderOrder = 80;
    this.group.add(back, front);
    this.group.visible = false;
  }

  /** 見え方の濃さ（現れる・消えるとき）。0 なら描かない */
  setAlpha(a: number): void {
    this.uniforms.uAlpha.value = a;
    this.group.visible = a > 1e-3;
  }

  /** 先の位置（瓶の座標）。スポイトはいつもまっすぐ立てて持つ */
  setTip(tip: Vector3): void {
    this.group.position.copy(tip);
    this.group.updateMatrixWorld(true);
  }

  /** 球の押し具合（0〜1） */
  setSqueeze(s: number): void {
    this.uniforms.uSqueeze.value = s;
  }

  /** 管の中に残っている餌（0〜1） */
  setLoad(l: number): void {
    this.uniforms.uLoad.value = P.load * l;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as ShaderMaterial).dispose();
      }
    });
  }
}
