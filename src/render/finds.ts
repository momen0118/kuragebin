// 瓶1つの瓶底の拾いもの（貝殻のかけら・シーグラス・小石）を描く。状態の物（sim の Specimen で at がこの瓶）に合わせて作ったり消したりする。
// 自分では光らず、部屋・窓・デスクライトの光を受けたぶんだけ見える（夜はライトの円錐の中だけ）。シーグラスは曇って少し透ける。
// 拾うと薄れて消え（光になって日誌へ向かうのは ui）、標本から置いた物は水面のすぐ下から揺れながらゆっくり沈んで瓶底に落ち着く。
// 揺らしても動かない。
import {
  BackSide,
  CustomBlending,
  FrontSide,
  GLSL3,
  Group,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  type PerspectiveCamera,
  type Side,
} from 'three';
import { FIND_LOOK, FIND_VARIANTS, JAR } from '../config';
import type { Specimen } from '../sim/state';
import { findShape, type FindShape } from './findShape';
import { LAMP_GLSL, lampUniforms } from './lamp';
import { apparentNdc } from './lensMap';
import common from './shaders/common.glsl?raw';
import { frag } from './shaders/glsl';
import type { SharedUniforms } from './uniforms';

const INNER_R = JAR.radius - JAR.glassThickness;

const VERT = /* glsl */ `
out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec3 vLocal;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${common}
${LAMP_GLSL}
uniform vec3 uKey, uKeyDir, uAmbient, uColor, uColor2;
uniform float uTime, uLensLight, uGlowPass, uOpacity, uSize, uHeight, uSeed;
// 0 シーグラス、1 貝殻のかけら、2 小石。模様は 0 なし、1 縞、2 細かい斑
uniform int uKind, uPattern;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vLocal;

// 水の中の光の揺らめき（窓の光が強い時間ほど）。ゆっくり動く網目
float caustic(vec2 p, float t) {
  vec2 q = p * 130.0;
  float a = valueNoise(q + vec2(t * 0.35, -t * 0.22));
  float b = valueNoise(q * 1.7 - vec2(t * 0.27, t * 0.31) + 5.3);
  float n = 1.0 - abs(a + b - 1.0);
  return pow(saturate(n), 6.0);
}

void main() {
  if (uGlowPass > 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  bool back = !gl_FrontFacing;
  if (back) N = -N;
  float NdV = saturate(dot(N, V));
  vec2 lp = vLocal.xz / uSize;
  // 模様
  vec3 albedo = uColor;
  // 貝殻の成長線：かけらの外にある殻頂のまわりの弧（幅は不揃い）
  vec2 umbo = vec2(-1.5, 0.4 * sin(uSeed));
  float grow = length(lp - umbo) * 6.0 + 0.5 * valueNoise(lp * 2.5 + uSeed) + 0.25 * sin(atan(lp.y - umbo.y, lp.x - umbo.x) * 9.0);
  float growth = smoothstep(0.3, 0.7, 0.5 + 0.5 * sin(grow * TAU * 0.5 + 1.3 * sin(grow * 1.7)));
  if (uPattern == 1) {
    // 縞：貝殻は成長線に沿った帯、小石は斜めの帯
    float s = (lp.x * 0.8 + vLocal.y / uSize * 1.4) * 3.2 + 0.8 * valueNoise(lp * 2.0 + uSeed);
    float band = uKind == 1 ? growth : smoothstep(0.35, 0.65, 0.5 + 0.5 * sin(s * TAU * 0.5));
    albedo = mix(uColor, uColor2, band * (uKind == 1 ? 0.7 : 0.9));
  } else if (uPattern == 2) {
    // 細かい斑と、ゆるいむら
    float sp = step(0.82, hash12(floor(vLocal.xz / uSize * 26.0 + vLocal.y / uSize * 13.0) + uSeed));
    float m = valueNoise(lp * 3.5 + uSeed);
    albedo = mix(uColor, uColor2, sp * 0.8) * (0.85 + 0.3 * m);
  } else {
    albedo *= 0.92 + 0.16 * valueNoise(lp * 4.0 + uSeed);
    if (uKind == 1) albedo = mix(albedo, uColor2, growth * 0.35);
  }
  // 貝殻：内側（裏）は白っぽく、ほんのり真珠色
  if (uKind == 1 && back) albedo = mix(albedo, vec3(0.82, 0.8, 0.78), 0.55);

  // 光：まわり（上からの光が多い）、窓の光、デスクライト（円錐の中だけ）、水の中の揺らめき。瓶底に触れる所ほど暗い
  float hemi = 0.4 + 0.6 * saturate(N.y * 0.5 + 0.5);
  float ao = mix(${FIND_LOOK.contactDark.toFixed(3)}, 1.0, smoothstep(0.0, uHeight * 0.7, vLocal.y + uHeight * ${FIND_LOOK.sink.toFixed(3)}));
  vec3 light = uAmbient * ${FIND_LOOK.ambient.toFixed(3)} * hemi + uKey * saturate(dot(N, uKeyDir)) * ${FIND_LOOK.key.toFixed(3)} * (0.5 + 0.5 * uLensLight);
  vec3 Ll = lampDir(vWorldPos);
  float spot = lampSpot(vWorldPos);
  light += uLampColor * spot * ${FIND_LOOK.lamp.toFixed(3)} * (0.08 + 0.92 * saturate(dot(N, Ll)));
  float up = saturate(N.y);
  light += uKey * uLensLight * caustic(vWorldPos.xz, uTime) * up * ${FIND_LOOK.caustic.toFixed(3)};
  light *= ao;
  // 濡れた面の照り（窓とライトの向き）
  vec3 R = reflect(-V, N);
  float sheen = pow(saturate(dot(R, uKeyDir)), 24.0) * (0.5 + 0.5 * uLensLight) + pow(saturate(dot(R, Ll)), 24.0) * spot * 1.5;
  vec3 hi = (uKey + uLampColor) * sheen * ${FIND_LOOK.sheen.toFixed(3)};

  vec3 col;
  float alpha;
  if (uKind == 0) {
    // シーグラス：表面が曇って白っぽく光を散らし、中は色ガラスとして透ける。縁（視線がかすめる所）は厚みのぶん色が濃く明るい。
    // 裏の面は透けて淡い
    float rim = pow(1.0 - NdV, 2.0);
    vec3 frost = mix(albedo, vec3(0.9), ${FIND_LOOK.glassFrost.toFixed(3)});
    vec3 body = albedo * albedo;
    col = frost * light * (0.6 + ${FIND_LOOK.glassRim.toFixed(3)} * rim) + body * light * 0.35 + hi * 0.5;
    alpha = ${FIND_LOOK.glassAlpha.toFixed(3)} * (0.7 + 0.3 * rim);
    if (back) {
      col = body * light * 0.4;
      alpha *= 0.5;
    }
  } else {
    col = albedo * light + hi;
    alpha = 1.0;
  }
  alpha *= uOpacity;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

/** 瓶底に落ちる淡い影（物の下とまわりを少し暗くする） */
const SHADOW_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const SHADOW_FRAG = /* glsl */ `
uniform float uStrength;
in vec2 vUv;
void main() {
  float r = length((vUv - 0.5) * 2.0);
  float a = uStrength * (1.0 - smoothstep(0.2, 1.0, r));
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

const SHADOW_GEOMETRY = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

interface FindView {
  shape: FindShape;
  meshes: Mesh[];
  shadow: Mesh;
  uniforms: { uOpacity: { value: number } };
  shadowStrength: { value: number };
  /** 瓶底の置き場所（ワールド）と向き */
  rest: Vector3;
  yaw: number;
  /** 'rest' 置いてある、'sink' 水面から沈んでいる、'leave' 拾われて消えていく */
  phase: 'rest' | 'sink' | 'leave';
  t: number;
  /** 今の位置（ワールド） */
  pos: Vector3;
}

const KIND_INDEX = { glass: 0, shell: 1, pebble: 2 } as const;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** 描く順番を決めるもの（creatures.ts がポリプと一緒に奥から並べる） */
export interface FloorSortable {
  readonly base: Vector3;
  setRenderOrder(order: number): void;
}

export class Finds {
  readonly group = new Group();
  private readonly views = new Map<number, FindView>();
  /** 次に作るとき水面から沈める物（標本から置いた物） */
  private readonly drops = new Set<number>();
  /** ポリプと一緒に奥から並べるもの */
  readonly sortables: FloorSortable[] = [];
  private readonly tmp = new Vector3();
  private readonly tmpN = new Vector2();

  constructor(
    private readonly shared: SharedUniforms,
    /** 置いた物が水面のすぐ下に現れたとき、その上の水面に小さな波紋（瓶の座標の x, z） */
    private readonly ripple: (x: number, z: number) => void = () => {},
  ) {}

  /** 瓶底の物に合わせる（list はこの瓶にある物）。なくなった物は薄れて消える */
  sync(list: readonly Specimen[]): void {
    const seen = new Set<number>();
    for (const s of list) {
      if (!s.at) continue;
      seen.add(s.id);
      const v = this.views.get(s.id);
      if (v && v.phase !== 'leave') continue;
      if (v) this.dispose(s.id);
      this.create(s);
    }
    for (const [id, v] of this.views) if (!seen.has(id) && v.phase !== 'leave') this.leave(id);
  }

  /** 標本から置いた物：次に現れるとき、水面のすぐ下から沈める */
  drop(id: number): void {
    this.drops.add(id);
  }

  private create(s: Specimen): void {
    const at = s.at!;
    const shape = findShape(s.kind, s.seed);
    const variant = FIND_VARIANTS[s.variant]!;
    const uniforms = {
      ...lampUniforms(this.shared),
      uKey: this.shared.uKey,
      uKeyDir: this.shared.uKeyDir,
      uAmbient: this.shared.uAmbient,
      uTime: this.shared.uTime,
      uLensLight: this.shared.uLensLight,
      uGlowPass: this.shared.uGlowPass,
      uColor: { value: new Vector3(...variant.color) },
      uColor2: { value: new Vector3(...variant.color2) },
      uKind: { value: KIND_INDEX[s.kind] },
      uPattern: { value: variant.pattern },
      uSize: { value: shape.radius },
      uHeight: { value: shape.height },
      uSeed: { value: (s.seed % 997) / 7.3 },
      uOpacity: { value: 1 },
    };
    const make = (side: Side): Mesh => {
      const m = new Mesh(
        shape.geometry,
        new ShaderMaterial({
          glslVersion: GLSL3,
          vertexShader: VERT,
          fragmentShader: frag(FRAG),
          side,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          blending: CustomBlending,
          blendSrc: OneFactor,
          blendDst: OneMinusSrcAlphaFactor,
          uniforms,
        }),
      );
      m.frustumCulled = false;
      return m;
    };
    // 奥の面を先に（小石は閉じた形なので手前の面だけ）
    const meshes = s.kind === 'pebble' ? [make(FrontSide)] : [make(BackSide), make(FrontSide)];
    const shadowStrength = { value: 0 };
    const shadow = new Mesh(
      SHADOW_GEOMETRY,
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: SHADOW_VERT,
        fragmentShader: frag(SHADOW_FRAG),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        uniforms: { uStrength: shadowStrength },
      }),
    );
    shadow.frustumCulled = false;
    const rest = new Vector3(at.spot[0] * INNER_R, JAR.bottomThickness, at.spot[1] * INNER_R);
    // 影は少し右へ（窓とデスクライトは左上）
    shadow.position.set(rest.x + shape.radius * FIND_LOOK.shadowShift, JAR.bottomThickness + 0.0005, rest.z);
    shadow.rotation.y = at.yaw;
    shadow.scale.set(shape.radius * FIND_LOOK.shadowSize, 1, shape.radius * FIND_LOOK.shadowSize * 0.8);
    const dropping = this.drops.delete(s.id);
    const v: FindView = { shape, meshes, shadow, uniforms, shadowStrength, rest, yaw: at.yaw, phase: dropping ? 'sink' : 'rest', t: 0, pos: rest.clone() };
    this.group.add(shadow);
    for (const m of meshes) this.group.add(m);
    this.views.set(s.id, v);
    if (dropping) this.ripple(rest.x, rest.z);
    this.place(v);
    this.rebuildSortables();
  }

  private leave(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    v.phase = 'leave';
    v.t = 0;
  }

  private dispose(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.views.delete(id);
    for (const m of [v.shadow, ...v.meshes]) {
      this.group.remove(m);
      (m.material as ShaderMaterial).dispose();
    }
    v.shape.geometry.dispose();
    this.rebuildSortables();
  }

  private rebuildSortables(): void {
    this.sortables.length = 0;
    for (const v of this.views.values()) {
      this.sortables.push({
        base: v.pos,
        setRenderOrder: (o) => {
          v.shadow.renderOrder = o;
          v.meshes.forEach((m, k) => (m.renderOrder = o + 0.05 + k * 0.05));
        },
      });
    }
  }

  /** 今の位置と向きをメッシュに */
  private place(v: FindView): void {
    let rockX = 0;
    let rockZ = 0;
    let lift = 0;
    if (v.phase === 'sink') {
      const k = Math.min(v.t / FIND_LOOK.sinkSeconds, 1);
      // はじめはゆっくり、底の近くでまたゆっくり。揺れながら沈み、底に着くころには落ち着く
      const e = smoothstep(0, 1, k);
      const top = JAR.waterLevel - FIND_LOOK.sinkStart;
      lift = (top - v.rest.y) * (1 - e);
      const amp = FIND_LOOK.sinkRock * (1 - e);
      rockX = Math.sin(v.t * 2.3 + v.yaw) * amp;
      rockZ = Math.cos(v.t * 1.7 + v.yaw * 2) * amp * 0.7;
    } else if (v.phase === 'leave') {
      lift = FIND_LOOK.leaveRise * smoothstep(0, 1, v.t / FIND_LOOK.leaveSeconds);
    }
    v.pos.copy(v.rest);
    v.pos.y += lift;
    for (const m of v.meshes) {
      m.position.copy(v.pos);
      m.rotation.set(rockX, v.yaw, rockZ, 'YXZ');
    }
    const fade = v.phase === 'leave' ? 1 - smoothstep(0, 1, v.t / FIND_LOOK.leaveSeconds) : 1;
    v.uniforms.uOpacity.value = fade;
    // 影は瓶底に近づくほど濃く
    v.shadowStrength.value = FIND_LOOK.shadow * fade * (1 - smoothstep(0, FIND_LOOK.shadowFadeHeight, lift));
  }

  update(dt: number): void {
    for (const [id, v] of [...this.views]) {
      v.t += dt;
      if (v.phase === 'sink' && v.t >= FIND_LOOK.sinkSeconds) {
        v.phase = 'rest';
        v.t = 0;
      }
      if (v.phase === 'leave' && v.t >= FIND_LOOK.leaveSeconds) {
        this.dispose(id);
        continue;
      }
      this.place(v);
    }
  }

  /** 沈んでいる物（泳ぐ個体がよける）。なければ null */
  sinking(out: Vector3): Vector3 | null {
    for (const v of this.views.values()) if (v.phase === 'sink') return out.copy(v.pos);
    return null;
  }

  get busy(): boolean {
    for (const v of this.views.values()) if (v.phase === 'sink') return true;
    return false;
  }

  /**
   * 画面上の点（ndc）にある物の番号（水とガラスのレンズ越しに見えている位置で）。
   * 見かけの大きさより少し広く、指で押せる大きさ（minNdc、画面の高さに対する ndc の半径）までは広げる
   */
  pick(ndcX: number, ndcY: number, cam: PerspectiveCamera, minNdc: number): number | null {
    let best: number | null = null;
    let bestScore = Infinity;
    for (const [id, v] of this.views) {
      if (v.phase !== 'rest') continue;
      const a = this.apparent(id, cam);
      if (!a) continue;
      const r = Math.max(a.r * FIND_LOOK.pickScale, minNdc);
      const d = Math.hypot((ndcX - a.x) * cam.aspect, ndcY - a.y);
      if (d < r && d / r < bestScore) {
        bestScore = d / r;
        best = id;
      }
    }
    return best;
  }

  /** 物の見かけの真ん中（ndc）と半径（画面の高さに対する ndc）。レンズ越しに見えている位置 */
  apparent(id: number, cam: PerspectiveCamera): { x: number; y: number; r: number } | null {
    const v = this.views.get(id);
    if (!v) return null;
    const c = this.tmp.copy(v.pos).setY(v.pos.y + v.shape.height * 0.4);
    const p = apparentNdc(cam, c, this.tmpN);
    const x = p.x;
    const y = p.y;
    const side = this.tmp.setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(v.shape.radius).add(v.pos);
    const q = apparentNdc(cam, side, this.tmpN);
    return { x, y, r: Math.hypot((q.x - x) * cam.aspect, q.y - y) };
  }

  /** 確認用：物の位置（ワールド）。なければ null */
  positionOf(id: number): Vector3 | null {
    return this.views.get(id)?.pos.clone() ?? null;
  }
}
