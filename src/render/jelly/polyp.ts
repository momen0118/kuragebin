// ポリプとストロビラ。瓶底に立つ小さなラッパ形の体と、口の縁の触手16本。
// 体は断面（polypShape.ts）を回した回転体で、ストロビラでは皿の縁に8本の腕の形が出て、終わりごろぴくぴく動く。
// 触手は根元から外へ開いて先が上へ反り、水のゆるい流れでそろって揺れ、1本ずつも少し揺れる。
// つつかれると縮み、瓶がいっぱいで休んでいる間は触手を縮めてゆっくり揺れる。
// ストロビラがエフィラを放すときは、上の皿から1枚ずつ離れていく（離れた皿は泳ぐエフィラとして描く）。
import {
  BackSide,
  BufferGeometry,
  CustomBlending,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  FrontSide,
  GLSL3,
  Group,
  Matrix4,
  Mesh,
  NearestFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Quaternion,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
  type Side,
} from 'three';
import { EPHYRA, JAR, JELLY_LOOK, POLYP, STROBILA } from '../../config';
import type { Rng } from '../../sim/rng';
import type { SharedUniforms } from '../uniforms';
import { LAMP_GLSL, lampUniforms } from '../lamp';
import common from '../shaders/common.glsl?raw';
import { frag } from '../shaders/glsl';
import { within } from './form';
import { polypShape, POLYP_PROFILE_N, type PolypShape } from './polypShape';
import { createStrandMesh, writeStrands } from './tentacles';

const INNER_R = JAR.radius - JAR.glassThickness;
const RINGS = 72;
const SEGMENTS = 40;
/** 触手の節の数 */
const NODES = 6;
const DEG = Math.PI / 180;

const VERT = /* glsl */ `
${common}
#define N ${POLYP_PROFILE_N}
// 断面の点：半径, 高さ, 腕の形の強さ, 皿の番号（polypShape.ts）
uniform sampler2D tProfile;
uniform vec3 uTwitch;
uniform float uLobeCut, uTwitchDrop, uLobePhase;
out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec3 vViewNormal;
out float vLobe;

vec4 prof(float t) {
  float f = clamp(t, 0.0, 1.0) * float(N);
  int i = int(min(floor(f), float(N - 1)));
  vec4 a = texelFetch(tProfile, ivec2(i, 0), 0);
  vec4 b = texelFetch(tProfile, ivec2(i + 1, 0), 0);
  return mix(a, b, f - float(i));
}

vec3 surf(float t, float th) {
  vec4 p = prof(t);
  // 皿の縁に8本の腕。腕の間は切れ込む
  float lobe = pow(0.5 + 0.5 * cos(8.0 * (th - uLobePhase)), 1.5);
  float r = p.x * (1.0 - p.z * (1.0 - lobe) * uLobeCut);
  // ぴくぴく：腕が下へ折れる（上の皿ほど強い）
  float d = floor(p.w + 0.5);
  float tw = d == 1.0 ? uTwitch.x : (d == 2.0 ? uTwitch.y : (d == 3.0 ? uTwitch.z : 0.0));
  float y = p.y - tw * p.z * lobe * uTwitchDrop * p.x;
  return vec3(cos(th) * r, y, sin(th) * r);
}

void main() {
  float t = uv.x;
  float th = uv.y * TAU;
  vec3 pos = surf(t, th);
  float h = 0.5 / float(N);
  float e = 0.02;
  vec3 dT = surf(min(t + h, 1.0), th) - surf(max(t - h, 0.0), th);
  vec3 dA = surf(t, th + e) - surf(t, th - e);
  vec3 nrm = cross(dT, dA);
  // 軸の近く（足の中心と口の先）では、断面の向きだけから求めた法線を使う
  vec4 pa = prof(max(t - h, 0.0));
  vec4 pb = prof(min(t + h, 1.0));
  vec2 tg = normalize(vec2(pb.x - pa.x, pb.y - pa.y) + vec2(1e-6));
  vec3 nMer = normalize(vec3(cos(th) * tg.y, -tg.x, sin(th) * tg.y));
  float nl = length(nrm);
  nrm = nl > 1e-9 ? nrm / nl : nMer;
  if (dot(nrm, nMer) < 0.0) nrm = -nrm;
  nrm = normalize(mix(nMer, nrm, smoothstep(0.0, 0.04, prof(t).x)));
  vLobe = prof(t).z;
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * nrm);
  vViewNormal = normalize(mat3(viewMatrix) * vWorldNormal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${common}
${LAMP_GLSL}
uniform float uGlowPass;
uniform vec3 uKey, uKeyDir, uAmbient, uTint;
uniform sampler2D tRoom;
uniform vec2 uResolution;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vViewNormal;
in float vLobe;
void main() {
  if (uGlowPass > 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float facing = dot(N, V);
  vec3 Nf = facing < 0.0 ? -N : N;
  float NdV = abs(facing);
  // 乳白色の半透明。中は透けて、輪郭と皿の縁が明るい。厚みのある真ん中はほんのり濃い
  float rim = pow(1.0 - NdV, 3.0);
  float core = pow(NdV, 3.0);
  float wrap = saturate(dot(Nf, uKeyDir) * 0.5 + 0.5);
  float trans = pow(saturate(dot(-V, uKeyDir) * 0.5 + 0.5), 3.0);
  vec3 light = uAmbient * 0.9 + uKey * (0.2 * wrap + 0.45 * trans);
  // 夜のデスクライト（円錐の中だけ）
  vec3 Ll = lampDir(vWorldPos);
  float spot = lampSpot(vWorldPos);
  light += uLampColor * spot * (0.2 * saturate(dot(Nf, Ll) * 0.5 + 0.5) + 0.45 * pow(saturate(dot(-V, Ll) * 0.5 + 0.5), 3.0));
  float density = 0.012 + 0.035 * core + 0.3 * rim + 0.1 * vLobe;
  vec3 col = uTint * light * density * 2.0;
  vec2 aspect = vec2(uResolution.y / uResolution.x, 1.0);
  vec2 suv = gl_FragCoord.xy / uResolution + vViewNormal.xy * aspect * 0.01 * rim;
  float refr = rim * 0.14;
  col += texture(tRoom, suv).rgb * refr;
  // 夜は輪郭と皿の縁でライトの光が散って、闇の中に形が浮かぶ
  col += uLampColor * spot * uTint * (0.12 * rim + 0.03 * core + 0.12 * vLobe) * ${JELLY_LOOK.lampScatter.toFixed(3)};
  gl_FragColor = vec4(col, density * 0.55 + refr);
}
`;

function latheGrid(rings: number, segments: number): BufferGeometry {
  const uv: number[] = [];
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j <= segments; j++) {
      uv.push(i / rings, j / segments);
      pos.push(0, 0, 0);
    }
  }
  const row = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** 状態から描き方を決めるのに要るもの */
export interface PolypInfo {
  stage: 'polyp' | 'strobila';
  /** ストロビラの進み（0〜1） */
  progress: number;
  /** ストロビラの皿の数 */
  discs: number;
  /** 生まれてからと、今の段階になってからの時間（秒、ゲーム内） */
  age: number;
  stageAge: number;
  /** 瓶がいっぱいで休んでいる */
  resting: boolean;
}

/** 離れたエフィラを泳がせはじめる（位置と、傘の向き） */
export type Launch = (pos: Vector3, up: Vector3) => void;

export class Polyp {
  readonly group = new Group();
  /** 瓶底の足もとの位置（ワールド） */
  readonly base = new Vector3();
  private readonly body: Mesh[];
  private readonly strands: Mesh;
  private readonly profile: DataTexture;
  private shape: PolypShape;
  private readonly uniforms: {
    uTwitch: { value: Vector3 };
    uLobeCut: { value: number };
    uTwitchDrop: { value: number };
    uLobePhase: { value: number };
  };
  private readonly matrix = new Matrix4();
  private readonly quat = new Quaternion();
  private readonly scaleV = new Vector3();
  private readonly up = new Vector3();
  /** 大きさ（体の高さ、瓶の高さ単位） */
  private height: number = POLYP.height;
  private time = 0;
  /** つつかれて縮んだ度合いと、休んでいる度合い（0〜1、なめらかに変わる） */
  private contract = 0;
  private contractHold = 0;
  private rest = 0;
  private restTarget = 0;
  private readonly twitch = [0, 0, 0];
  // 状態から決まる形
  private stage: 'polyp' | 'strobila' = 'polyp';
  private progress = 0;
  private discs = 0;
  private calyx = 1;
  private grow = 1;
  private sizeScale = 1;
  /** 触手の長さの割合（ストロビラで縮んで消え、生え直す） */
  private reach = 1;
  // 触手
  private readonly angles: Float32Array;
  private readonly lengths: Float32Array;
  private readonly phases: Float32Array;
  private readonly speeds: Float32Array;
  private readonly x: Float32Array;
  private readonly local = new Vector3();
  /** 水のゆるい流れの向き（ゆっくり回る） */
  private readonly flowPhase: number;
  // エフィラを放しているところ
  private releasing: { total: number; released: number; timer: number } | null = null;
  private readonly queue: Launch[] = [];
  private synced = false;

  constructor(
    shared: SharedUniforms,
    private readonly rng: Rng,
    spot: readonly [number, number],
  ) {
    const n = POLYP.tentacleCount;
    const yaw = rng.range(0, Math.PI * 2);
    this.angles = new Float32Array(n);
    this.lengths = new Float32Array(n);
    this.phases = new Float32Array(n * 2);
    this.speeds = new Float32Array(n * 2);
    const [pMin, pMax] = POLYP.swayPeriod;
    const seeds = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.angles[i] = yaw + ((i + rng.range(-0.2, 0.2)) / n) * Math.PI * 2;
      this.lengths[i] = POLYP.tentacleLength * rng.range(0.8, 1.15);
      for (let k = 0; k < 2; k++) {
        this.phases[i * 2 + k] = rng.range(0, Math.PI * 2);
        this.speeds[i * 2 + k] = (Math.PI * 2) / rng.range(pMin, pMax);
      }
      seeds[i] = rng.next();
    }
    this.flowPhase = rng.range(0, Math.PI * 2);
    this.x = new Float32Array(n * NODES * 3);

    // 瓶底の場所と、少しの傾き
    this.base.set(spot[0] * INNER_R, JAR.bottomThickness, spot[1] * INNER_R);
    const tilt = rng.range(0, POLYP.tiltDeg) * DEG;
    const az = rng.range(0, Math.PI * 2);
    this.up.set(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)).normalize();
    this.quat.setFromUnitVectors(new Vector3(0, 1, 0), this.up);

    this.profile = new DataTexture(new Float32Array((POLYP_PROFILE_N + 1) * 4), POLYP_PROFILE_N + 1, 1, RGBAFormat, FloatType);
    this.profile.minFilter = NearestFilter;
    this.profile.magFilter = NearestFilter;
    this.profile.generateMipmaps = false;
    this.shape = polypShape({ strobila: 0, discs: 0, released: 0, calyx: 1, contract: 0, discRadius: this.discRadius() }, {
      points: this.profile.image.data as Float32Array,
      rimR: 0,
      rimY: 0,
      discY: [],
      topDiscR: 0,
    });
    this.profile.needsUpdate = true;

    this.uniforms = {
      uTwitch: { value: new Vector3() },
      uLobeCut: { value: STROBILA.lobeCut },
      uTwitchDrop: { value: STROBILA.twitchDrop },
      uLobePhase: { value: yaw },
    };
    const tint = { value: new Vector3(...POLYP.body) };
    const geo = latheGrid(RINGS, SEGMENTS);
    const make = (side: Side): Mesh => {
      const m = new Mesh(
        geo,
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
          uniforms: {
            ...lampUniforms(shared),
            ...this.uniforms,
            tProfile: { value: this.profile },
            uGlowPass: shared.uGlowPass,
            uKey: shared.uKey,
            uKeyDir: shared.uKeyDir,
            uAmbient: shared.uAmbient,
            tRoom: shared.tRoom,
            uResolution: shared.uResolution,
            uTint: tint,
          },
        }),
      );
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      return m;
    };
    this.body = [make(BackSide), make(FrontSide)];
    const look = { uBody: tint, uGlow: { value: new Vector3() } };
    this.strands = createStrandMesh(shared, look, n, NODES, seeds, POLYP.tentacleWidthPx, POLYP.tentacleBrightness);
    this.group.add(this.body[0]!, this.strands, this.body[1]!);
    this.setRenderOrder(12);
  }

  /** 皿の半径（体の高さ = 1）。放されたエフィラの大きさに合わせる */
  private discRadius(): number {
    return (EPHYRA.radius * STROBILA.discRadius) / POLYP.height;
  }

  /** 描く順番（奥のものから先に）。体の奥側 → 触手 → 体の手前側 */
  setRenderOrder(base: number): void {
    this.body[0]!.renderOrder = base;
    this.strands.renderOrder = base + 0.1;
    this.body[1]!.renderOrder = base + 0.2;
  }

  /** 体のてっぺんのあたり（ワールド、触手の冠の上）。札を出す位置や、指で押せる所に使う */
  top(out: Vector3): Vector3 {
    return out.copy(this.up).multiplyScalar(this.height * 1.5).add(this.base);
  }

  /** 体の高さ（瓶の高さ単位） */
  get size(): number {
    return this.height;
  }

  /** エフィラを放しているところか（離れるのを待つ皿がある） */
  get isReleasing(): boolean {
    return this.releasing !== null;
  }

  /** 離れていく皿に、泳ぎはじめるエフィラを割り当てる（上の皿から順に） */
  queueLaunch(launch: Launch): void {
    this.queue.push(launch);
  }

  /** 状態に合わせる。sizeScale は大きさの倍率（確認用の実物大） */
  sync(info: PolypInfo, sizeScale: number): void {
    // ストロビラがポリプに戻った（エフィラを放した）：残っていた皿を1枚ずつ離す
    if (this.synced && this.stage === 'strobila' && info.stage === 'polyp' && this.discs > 0) {
      this.releasing = { total: this.discs, released: 0, timer: STROBILA.releaseInterval * 0.5 };
    }
    this.synced = true;
    this.stage = info.stage;
    this.progress = info.progress;
    if (info.stage === 'strobila') this.discs = info.discs;
    else if (!this.releasing) this.discs = 0;
    this.sizeScale = sizeScale;
    // 付いたばかりは小さく、半日ほどで育つ。エフィラを放したあとは、杯と触手が生え直す
    const fresh = info.age - info.stageAge < 60;
    this.grow = fresh ? POLYP.budScale + (1 - POLYP.budScale) * smooth(info.age / POLYP.growSeconds) : 1;
    this.calyx = info.stage === 'polyp' && !fresh ? smooth(info.stageAge / POLYP.regrowSeconds) : 1;
    this.reach = info.stage === 'strobila' ? 1 - within(info.progress, STROBILA.resorb) : this.calyx;
    this.restTarget = info.resting && info.stage === 'polyp' ? 1 : 0;
  }

  /** ガラスをつつかれた。近ければ縮み、ゆっくり伸び戻る。反応したら true */
  poke(point: Vector3): boolean {
    const d = point.distanceTo(this.base);
    if (d > POLYP.pokeRange) return false;
    this.contractHold = POLYP.pokeContract;
    return true;
  }

  update(dt: number): void {
    this.time += dt;
    // 縮みは速く、伸び戻りはゆっくり
    if (this.contractHold > 0) {
      this.contractHold -= dt;
      this.contract = Math.min(1, this.contract + dt / POLYP.pokeContract);
    } else {
      this.contract = Math.max(0, this.contract - dt / POLYP.pokeRelax);
    }
    this.rest += (this.restTarget - this.rest) * (1 - Math.exp(-dt / 3));
    this.stepTwitch(dt);
    this.stepRelease(dt);

    const rel = this.releasing;
    const k = smooth(this.contract);
    const input = rel
      ? { strobila: 1, discs: rel.total, released: rel.released, calyx: 1, contract: 0, discRadius: this.discRadius() }
      : {
          strobila: this.stage === 'strobila' ? this.progress : 0,
          discs: this.stage === 'strobila' ? this.discs : 0,
          released: 0,
          calyx: this.calyx,
          contract: k,
          discRadius: this.discRadius(),
        };
    this.shape = polypShape(input, this.shape);
    this.profile.needsUpdate = true;
    this.uniforms.uTwitch.value.set(this.twitch[0]!, this.twitch[1]!, this.twitch[2]!);

    this.height = POLYP.height * this.sizeScale * this.grow;
    this.scaleV.setScalar(this.height);
    this.matrix.compose(this.base, this.quat, this.scaleV);
    for (const m of this.body) m.matrix.copy(this.matrix);
    this.updateTentacles(k);
  }

  /** 終わりごろ、皿がぴくぴく動く（上の皿ほどよく動く） */
  private stepTwitch(dt: number): void {
    const n = this.releasing ? this.releasing.total - this.releasing.released : this.stage === 'strobila' ? this.discs : 0;
    const level = this.releasing ? 1 : this.stage === 'strobila' ? within(this.progress, STROBILA.twitch) : 0;
    for (let d = 0; d < 3; d++) {
      this.twitch[d] = this.twitch[d]! * Math.exp(-dt / 0.16);
      if (d >= n || level <= 0) continue;
      const top = d === n - 1;
      const rate = level * (top ? 1.3 : 0.45);
      if (this.rng.next() < rate * dt) this.twitch[d] = 1;
    }
  }

  /** 上の皿から1枚ずつ離し、割り当てられたエフィラを泳がせはじめる */
  private stepRelease(dt: number): void {
    const rel = this.releasing;
    if (!rel) return;
    rel.timer -= dt;
    if (rel.timer > 0) return;
    const left = rel.total - rel.released;
    const y = this.shape.discY[left - 1];
    if (y !== undefined) {
      const pos = this.local.set(0, y, 0).applyMatrix4(this.matrix);
      const launch = this.queue.shift();
      launch?.(pos.clone(), this.up.clone());
    }
    rel.released++;
    rel.timer = STROBILA.releaseInterval;
    if (rel.released >= rel.total) {
      this.releasing = null;
      this.discs = 0;
      this.queue.length = 0;
    }
  }

  /** 触手の形：根元から外へ開き、先が上へ反る。水の流れでそろって揺れ、1本ずつも少し揺れる */
  private updateTentacles(contract: number): void {
    const n = POLYP.tentacleCount;
    const s = this.shape;
    const x = this.x;
    const rest = this.rest;
    const slow = 1 - (1 - POLYP.restSlow) * rest;
    const t = this.time;
    // 伸びている割合：ストロビラで縮んで消え、休んでいると半分、つつかれると縮む
    const ext = this.reach * (1 - (1 - POLYP.restLength) * rest) * (1 - POLYP.pokeTentacle * contract);
    const rise = POLYP.tentacleRise * DEG;
    const curl = (POLYP.tentacleCurl + POLYP.restCurl * rest + 60 * contract) * DEG;
    const sway = POLYP.swayDeg * DEG;
    // 水の流れの向きと強さ（ゆっくり変わる）
    const flowAz = this.flowPhase + t * 0.05 + 0.6 * Math.sin(t * 0.021);
    const flow = 0.6 + 0.4 * Math.sin(t * 0.13 + this.flowPhase);
    const M = this.matrix;
    for (let i = 0; i < n; i++) {
      const a0 = this.angles[i]!;
      const L = this.lengths[i]! * ext;
      const seg = L / (NODES - 1);
      const own1 = Math.sin(t * this.speeds[i * 2]! * slow + this.phases[i * 2]!);
      const own2 = Math.sin(t * this.speeds[i * 2 + 1]! * slow + this.phases[i * 2 + 1]!);
      const shared = POLYP.swayShared * flow;
      const own = 1 - POLYP.swayShared;
      let px = s.rimR * Math.cos(a0);
      let py = s.rimY;
      let pz = s.rimR * Math.sin(a0);
      const base = i * NODES * 3;
      for (let j = 0; j < NODES; j++) {
        this.local.set(px, py, pz).applyMatrix4(M);
        x[base + j * 3] = this.local.x;
        x[base + j * 3 + 1] = this.local.y;
        x[base + j * 3 + 2] = this.local.z;
        if (j === NODES - 1) break;
        const u = (j + 0.5) / (NODES - 1);
        const w = u ** 1.5;
        // 仰角（水平から上）と方位。流れの向きへそろって傾き、1本ずつも揺れる
        const elev = rise + curl * u ** 1.3 + sway * w * (shared * Math.cos(flowAz - a0) * 0.5 + own * own2);
        const az = a0 + sway * w * (shared * Math.sin(flowAz - a0) + own * own1);
        px += seg * Math.cos(elev) * Math.cos(az);
        py += seg * Math.sin(elev);
        pz += seg * Math.cos(elev) * Math.sin(az);
      }
    }
    writeStrands(this.strands.geometry, x, n, NODES);
  }

  dispose(): void {
    this.body[0]!.geometry.dispose();
    for (const m of this.body) (m.material as ShaderMaterial).dispose();
    this.strands.geometry.dispose();
    (this.strands.material as ShaderMaterial).dispose();
    this.profile.dispose();
  }
}

function smooth(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}
