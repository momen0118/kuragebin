// おじさんへ送るときの箱。発泡スチロールの箱（中に水を張った袋が入っている）で、瓶の手前、天板の手前の縁に置いてある。
// 瓶のガラスより手前にあるので、画面のいちばん最後に描く。カップは箱の内側と、手前の壁の間に描く
// （中へ下ろすと、手前の壁に隠れる）。描くもの：
//   内側（奥の壁・横の壁・底、奥と横の縁） → 袋の水面 → （ここでカップ） → 手前の壁と手前の縁 → 蓋
// カップが袋の水にすっかり浸かったら、水面はカップのあとに描く（水越しに見える）。
// 面は外から見て表になる向きだけ描く（裏は描かない）。形は箱の底の真ん中が原点。置く所（瓶の座標）と、
// 出る・引っこむ動きは描画側が決める。
import {
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
  Vector3,
} from 'three';
import { BOX } from '../config';
import { LAMP_GLSL, lampUniforms } from './lamp';
import common from './shaders/common.glsl?raw';
import { frag } from './shaders/glsl';
import type { SharedUniforms } from './uniforms';

const W = BOX.width / 2;
const D = BOX.depth / 2;
const H = BOX.height;
const T = BOX.wall;

type V = [number, number, number];

/** 四角い面を足す（a→b→c→d の順、法線 n）。inner は箱の内側の面（奥ほど暗い） */
function quads(list: Array<{ p: [V, V, V, V]; n: V; inner: number }>): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const inner: number[] = [];
  const idx: number[] = [];
  for (const q of list) {
    const base = pos.length / 3;
    for (const v of q.p) {
      pos.push(...v);
      nrm.push(...q.n);
      inner.push(q.inner);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setAttribute('aInner', new Float32BufferAttribute(inner, 1));
  g.setIndex(idx);
  return g;
}

/** 内側：奥の壁・横の壁・底（内向き）と、奥と横の縁（上向き） */
function insideGeometry(): BufferGeometry {
  const xi = W - T;
  const zi = D - T;
  return quads([
    { p: [[-xi, T, -zi], [xi, T, -zi], [xi, H, -zi], [-xi, H, -zi]], n: [0, 0, 1], inner: 1 },
    { p: [[-xi, T, zi], [-xi, T, -zi], [-xi, H, -zi], [-xi, H, zi]], n: [1, 0, 0], inner: 1 },
    { p: [[xi, T, -zi], [xi, T, zi], [xi, H, zi], [xi, H, -zi]], n: [-1, 0, 0], inner: 1 },
    { p: [[-xi, T, zi], [xi, T, zi], [xi, T, -zi], [-xi, T, -zi]], n: [0, 1, 0], inner: 1 },
    // 縁（奥・左・右）
    { p: [[-W, H, -zi], [W, H, -zi], [W, H, -D], [-W, H, -D]], n: [0, 1, 0], inner: 0 },
    { p: [[-W, H, D], [-xi, H, D], [-xi, H, -D], [-W, H, -D]], n: [0, 1, 0], inner: 0 },
    { p: [[xi, H, D], [W, H, D], [W, H, -D], [xi, H, -D]], n: [0, 1, 0], inner: 0 },
  ]);
}

/** 手前：手前の壁（外向き）と手前の縁、横の壁の外側 */
function frontGeometry(): BufferGeometry {
  const xi = W - T;
  const zi = D - T;
  return quads([
    { p: [[-W, -0.05, D], [W, -0.05, D], [W, H, D], [-W, H, D]], n: [0, 0, 1], inner: 0 },
    { p: [[-xi, H, D], [xi, H, D], [xi, H, zi], [-xi, H, zi]], n: [0, 1, 0], inner: 0 },
    { p: [[-W, -0.05, -D], [-W, -0.05, D], [-W, H, D], [-W, H, -D]], n: [-1, 0, 0], inner: 0 },
    { p: [[W, -0.05, D], [W, -0.05, -D], [W, H, -D], [W, H, D]], n: [1, 0, 0], inner: 0 },
  ]);
}

/** 蓋：上の面と、手前・横の縁 */
function lidGeometry(): BufferGeometry {
  const h = T * 1.2;
  return quads([
    { p: [[-W, h, D], [W, h, D], [W, h, -D], [-W, h, -D]], n: [0, 1, 0], inner: -1 },
    { p: [[-W, 0, D], [W, 0, D], [W, h, D], [-W, h, D]], n: [0, 0, 1], inner: -1 },
    { p: [[-W, 0, -D], [-W, 0, D], [-W, h, D], [-W, h, -D]], n: [-1, 0, 0], inner: -1 },
    { p: [[W, 0, D], [W, 0, -D], [W, h, -D], [W, h, D]], n: [1, 0, 0], inner: -1 },
  ]);
}

/** 袋の水面（箱の内側いっぱいの四角） */
function waterGeometry(): BufferGeometry {
  const x = W - T - 0.004;
  const z = D - T - 0.004;
  const y = H * BOX.waterLevel;
  return quads([{ p: [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]], n: [0, 1, 0], inner: 2 }]);
}

const VERT = /* glsl */ `
in float aInner;
out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vLocal;
out float vInner;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLocal = position;
  vInner = aInner;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** 発泡スチロール：細かい粒の、つやのない白。部屋の光とデスクライトを受けたぶんだけ明るい。内側は奥ほど暗い */
const FRAG = /* glsl */ `
${common}
${LAMP_GLSL}
uniform vec3 uKey, uKeyDir, uAmbient;
uniform vec3 uColor;
uniform float uAlpha, uGlow, uTime;
in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vLocal;
in float vInner;
void main() {
  vec3 N = normalize(vNormal);
  // デスクライトの光だまりの外でも、照り返しを少し受ける（白い箱なので）
  vec3 lampC = uLampColor * (lampSpot(vWorldPos) + 0.3);
  float diff = saturate(dot(N, normalize(uKeyDir)) * 0.6 + 0.4);
  float diffL = saturate(dot(N, lampDir(vWorldPos)) * 0.6 + 0.4);
  vec3 light = uAmbient * 1.15 + uKey * diff * 0.45 + lampC * diffL * 0.7;
  if (vInner > 1.5) {
    // 袋の水面：うっすら暗く透け、窓とライトの光が映る。袋のしわで映り込みが少し揺らぐ
    vec3 V = normalize(cameraPosition - vWorldPos);
    float wrinkle = valueNoise(vLocal.xz * 38.0 + uTime * 0.05) - 0.5;
    float F = 0.04 + 0.96 * pow(1.0 - saturate(dot(N, V)), 5.0);
    vec3 col = (uAmbient * 0.9 + uKey * 0.4 + lampC * 0.6) * (F * (1.0 + wrinkle * 0.6) + 0.1);
    float a = 0.36 + F * 0.4;
    gl_FragColor = vec4(col * uAlpha, a * uAlpha);
    return;
  }
  // 細かい粒（つぶつぶの明るさのむら）
  vec2 q = abs(N.y) > 0.5 ? vLocal.xz : abs(N.x) > 0.5 ? vLocal.zy : vLocal.xy;
  float beads = (valueNoise(q * 260.0) - 0.5) * ${BOX.beads.toFixed(3)} + (valueNoise(q * 45.0) - 0.5) * 0.02;
  float shade = 1.0;
  float film = 0.0;
  if (vInner > 0.5) {
    // 内側：底ほど、隅ほど暗い。袋が内側に沿って入っていて、縦のしわにうっすら光が乗る
    float corner = min(${(W - T).toFixed(4)} - abs(vLocal.x), ${(D - T).toFixed(4)} - abs(vLocal.z));
    shade = mix(0.3, 0.85, smoothstep(0.0, ${H.toFixed(4)}, vLocal.y)) * mix(0.75, 1.0, smoothstep(0.0, 0.04, corner));
    float along = abs(N.x) > 0.5 ? vLocal.z : vLocal.x;
    film = pow(valueNoise(vec2(along * 34.0, vLocal.y * 5.0)), 3.0) * 0.5;
  } else if (vInner < -0.5) {
    // 蓋：上の面はやや明るく、縁の角は少し暗い
    float edge = min(${W.toFixed(4)} - abs(vLocal.x), ${D.toFixed(4)} - abs(vLocal.z));
    shade = (N.y > 0.5 ? 1.08 : mix(0.75, 0.95, smoothstep(0.0, ${(T * 1.2).toFixed(4)}, vLocal.y))) * mix(0.82, 1.0, smoothstep(0.0, 0.008, edge));
  } else if (N.y > 0.5) {
    // 縁の上：袋の口を折り返してかぶせてある（つやの筋）。外の角は少し丸く暗い
    float edge = min(${W.toFixed(4)} - abs(vLocal.x), ${D.toFixed(4)} - abs(vLocal.z));
    shade = 1.08 * mix(0.8, 1.0, smoothstep(0.0, 0.006, edge));
    film = pow(valueNoise(vLocal.xz * vec2(30.0, 30.0)), 2.0) * 0.6;
  } else {
    // 外の壁：下ほど暗く（天板の照り返しが少ない）、上の角は丸く光を受ける。縦の角は少し暗い
    float side = abs(N.z) > 0.5 ? ${W.toFixed(4)} - abs(vLocal.x) : ${D.toFixed(4)} - abs(vLocal.z);
    shade = mix(0.6, 1.0, smoothstep(-0.05, ${H.toFixed(4)}, vLocal.y)) * mix(0.82, 1.0, smoothstep(0.0, 0.012, side));
    shade += 0.14 * exp(-(${H.toFixed(4)} - vLocal.y) / 0.005);
    // 折り返した袋の口が、上の端から少し垂れている（下の縁はゆるく波打つ）
    float hang = 0.018 + 0.004 * sin(vLocal.x * 47.0 + 1.3) + 0.002 * sin(vLocal.x * 131.0);
    float over = smoothstep(${H.toFixed(4)} - hang - 0.003, ${H.toFixed(4)} - hang + 0.003, vLocal.y);
    film = over * (0.1 + pow(valueNoise(vec2(vLocal.x * 40.0, vLocal.y * 9.0)), 2.0) * 0.3);
    shade *= 1.0 - 0.07 * exp(-pow((vLocal.y - (${H.toFixed(4)} - hang)) / 0.004, 2.0));
  }
  vec3 sheen = (uAmbient * 0.6 + uKey * 0.5 + lampC * 0.9) * film * 0.35;
  vec3 col = uColor * (1.0 + beads) * light * shade * (1.0 + uGlow) + sheen;
  gl_FragColor = vec4(col * uAlpha, uAlpha);
}
`;

export class Box {
  /** 箱の内側（カップより先に描く） */
  readonly back = new Group();
  /** 袋の水面（ふだんはカップより先、カップが浸かったらカップのあと） */
  readonly water = new Group();
  /** 手前の壁と縁、蓋（カップのあとに描く） */
  readonly front = new Group();
  private readonly lid: Mesh;
  private readonly uniforms;
  /** 蓋の濃さ（箱の濃さ × 蓋が近づいてきた分） */
  private readonly lidAlpha = { value: 0 };
  private lidT = 0;

  constructor(shared: SharedUniforms) {
    this.uniforms = {
      ...lampUniforms(shared),
      uKey: shared.uKey,
      uKeyDir: shared.uKeyDir,
      uAmbient: shared.uAmbient,
      uTime: shared.uTime,
      uColor: { value: new Vector3(...BOX.color) },
      uAlpha: { value: 0 },
      uGlow: { value: 0 },
    };
    const mat = (uniforms: Record<string, { value: unknown }> = this.uniforms): ShaderMaterial => {
      const m = new ShaderMaterial({ glslVersion: GLSL3, vertexShader: VERT, fragmentShader: frag(FRAG), side: FrontSide, uniforms });
      m.transparent = true;
      m.depthTest = false;
      m.depthWrite = false;
      m.blending = CustomBlending;
      m.blendSrc = OneFactor;
      m.blendDst = OneMinusSrcAlphaFactor;
      return m;
    };
    const inside = new Mesh(insideGeometry(), mat());
    const water = new Mesh(waterGeometry(), mat());
    this.back.add(inside);
    this.water.add(water);
    const front = new Mesh(frontGeometry(), mat());
    front.renderOrder = 1;
    this.lid = new Mesh(lidGeometry(), mat({ ...this.uniforms, uAlpha: this.lidAlpha }));
    this.lid.renderOrder = 2;
    this.front.add(front, this.lid);
    for (const o of [inside, water, front, this.lid]) o.frustumCulled = false;
    this.lid.visible = false;
  }

  /** 箱の底の真ん中の位置（瓶の座標） */
  setPosition(p: Vector3): void {
    for (const g of [this.back, this.water, this.front]) {
      g.position.copy(p);
      g.updateMatrixWorld(true);
    }
  }

  /** 濃さ（0 で描かない）と、指が近いときの明るさの足し分 */
  setLook(alpha: number, glow: number): void {
    this.uniforms.uAlpha.value = alpha;
    this.uniforms.uGlow.value = glow;
    this.back.visible = this.water.visible = this.front.visible = alpha > 1e-3;
    this.lidAlpha.value = alpha * Math.min(1, this.lidT / 0.35);
  }

  /** 蓋：0 で外れて上にある（見えない）、1 で閉まっている */
  setLid(t: number): void {
    this.lidT = t;
    this.lid.visible = t > 0;
    this.lidAlpha.value = this.uniforms.uAlpha.value * Math.min(1, t / 0.35);
    const k = 1 - t;
    this.lid.position.set(0, H + k * 0.18, -k * 0.12);
    this.lid.updateMatrixWorld(true);
  }

  /** 描くか（濃さが 0 でない） */
  get shown(): boolean {
    return this.back.visible;
  }

  /** 袋の水面の高さ（箱の中の座標） */
  static get waterY(): number {
    return H * BOX.waterLevel;
  }
}
