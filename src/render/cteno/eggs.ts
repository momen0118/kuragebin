// カブトクラゲの卵（瓶1つ分）。透き通った小さな粒が、産んだ所に固まって現れ、水に漂いながら広がって、孵るころまでに瓶底の近くへ沈む。
// 粒の場所は卵の種（sim の EggClutch.seed）と、産んでからの時間（ゲーム内）で決まる（閉じて開き直しても同じ所）。
// 孵らない粒は、孵るまでの間のどこかで淡くなって消える。孵るときに残っている粒の所から幼生が泳ぎ出す（takeHatchPoint）。
// 揺らされた瓶では、粒は水と一緒に流され、収まるとゆっくり元の漂い方へ戻る
import {
  BufferGeometry,
  CustomBlending,
  DynamicDrawUsage,
  Float32BufferAttribute,
  GLSL3,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { CTENO, CTENO_EGGS, JAR, SIM } from '../../config';
import { createRng } from '../../sim/rng';
import type { EggClutch } from '../../sim/state';
import { swimBounds } from '../jelly/swim';
import { LAMP_GLSL, lampUniforms } from '../lamp';
import common from '../shaders/common.glsl?raw';
import { frag } from '../shaders/glsl';
import { flowAt, type WaterField } from '../slosh';
import type { SharedUniforms } from '../uniforms';

const E = CTENO_EGGS;
const INNER_R = JAR.radius - JAR.glassThickness;
const FLOOR_Y = JAR.bottomThickness + E.radius * 2;
/** 一度に描ける粒の数（瓶に卵が何腹あっても、ふつうはこれで足りる） */
const MAX = CTENO.eggs.shown[1] * 6;
/** 流された分が元の漂い方へ戻る速さ（秒） */
const SETTLE = 30;

const VERT = /* glsl */ `
${common}
${LAMP_GLSL}
in float aAlpha;
in float aSize;
uniform vec2 uResolution;
uniform vec3 uKey, uKeyDir, uAmbient;
out float vAlpha;
out vec3 vColor;
out vec2 vLight;
out float vEdge;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float proj = projectionMatrix[1][1] * uResolution.y * 0.5;
  float px = aSize * proj / -mv.z;
  // 小さすぎる粒は大きさを保ったまま淡くする（ちらつかないように）
  float d = max(px * 2.0, 2.0);
  gl_PointSize = d + 2.0;
  // 粒の大きさは、点の大きさより 1px ずつ小さい（縁をなめらかにする分）
  vEdge = 1.0 + 2.0 / d;
  vAlpha = aAlpha * min(1.0, px * 2.0 / d);
  // 窓の光とライトの光が粒の縁で光る（前から抜ける光ほど明るい）
  vec3 toCam = normalize(cameraPosition - position);
  float through = 0.4 + 0.6 * saturate(dot(-uKeyDir, toCam) * 0.5 + 0.5);
  float forward = saturate(dot(-lampDir(position), toCam));
  vColor = uAmbient * 0.8 + uKey * 0.45 * through + uLampColor * lampSpot(position) * (0.5 + 0.8 * forward * forward);
  // 光の来る向き（画面の上で）。粒の縁のその側が少し明るい
  vec3 l = mat3(viewMatrix) * uKeyDir;
  vLight = length(l.xy) > 1e-4 ? normalize(l.xy) : vec2(0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
in float vAlpha;
in vec3 vColor;
in vec2 vLight;
in float vEdge;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  q.y = -q.y;
  float r = length(q) * vEdge;
  if (r > 1.0) discard;
  // 透き通った粒：中は淡く、縁が細く光る。光の来る側の縁が少し明るい。真ん中に胚の小さな芯（泡に見えないように）
  float rim = smoothstep(0.55, 0.88, r) * (1.0 - smoothstep(0.88, 1.0, r));
  float side = 0.6 + 0.4 * dot(normalize(q + 1e-4), vLight);
  float core = exp(-r * r * 14.0);
  float a = (${E.fill.toFixed(3)} + ${E.rim.toFixed(3)} * rim * side + ${E.core.toFixed(3)} * core) * vAlpha;
  gl_FragColor = vec4(vColor * a, a * 0.35);
}
`;

interface Egg {
  /** 固まりの中での向きと離れ方（-1〜1）、沈みきる高さ、揺れの位相と周期、大きさの倍率 */
  off: Vector3;
  floor: number;
  phase: number;
  period: number;
  size: number;
  /** 孵らない粒：消えはじめる所（孵るまでの割合）。孵る粒は -1 */
  dud: number;
  /** 流された分（ワールド） */
  drift: Vector3;
  /** 今の場所（ワールド） */
  pos: Vector3;
}

interface Clutch {
  clutch: EggClutch;
  center: Vector3;
  eggs: Egg[];
  /** 見ている間に産んだ卵なら、現れた時刻（描画の時間）。ふわっと広がりながら現れる。前からあった卵は null */
  bornAt: number | null;
}

/** 卵を見分ける名前（産んだ親と時刻） */
const keyOf = (e: EggClutch): string => `${e.parent ?? 'x'}:${e.laidAt}`;

/** 産んだ所（見ている間に産んだときの、親のいた所）。閉じて開き直しても同じ所から漂うように覚えておく */
const laidAtPos = new Map<string, Vector3>();

export class EggCloud {
  readonly points: Points;
  private readonly geo: BufferGeometry;
  private readonly clutches = new Map<string, Clutch>();
  /** 孵ったばかりの卵の、残っていた粒の場所（親の番号ごと）。幼生がここから泳ぎ出す */
  private readonly hatched = new Map<number | null, Vector3[]>();
  /** ゲーム内の今（sync で受け取る）と、描画の時間（揺れ） */
  private time = 0;
  private clock = 0;
  private readonly tmp = new Vector3();

  constructor(shared: SharedUniforms) {
    const geo = new BufferGeometry();
    const position = new Float32BufferAttribute(new Float32Array(MAX * 3), 3);
    const alpha = new Float32BufferAttribute(new Float32Array(MAX), 1);
    const size = new Float32BufferAttribute(new Float32Array(MAX), 1);
    for (const a of [position, alpha, size]) a.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', position);
    geo.setAttribute('aAlpha', alpha);
    geo.setAttribute('aSize', size);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.points = new Points(
      geo,
      new ShaderMaterial({
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
          uKeyDir: shared.uKeyDir,
          uAmbient: shared.uAmbient,
        },
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 29;
  }

  /**
   * 瓶の卵に合わせる。time はゲーム内の今。parentPos は親のいる所（見ていて、今産んだばかりなら、そこから漂いはじめる）。
   * なくなった卵（孵った）は、残っていた粒の場所を覚えておく
   */
  sync(eggs: readonly EggClutch[], time: number, parentPos: (id: number) => Vector3 | null): void {
    this.time = time;
    this.hatched.clear();
    const seen = new Set<string>();
    for (const e of eggs) {
      const key = keyOf(e);
      seen.add(key);
      if (this.clutches.has(key)) continue;
      // 見ている間に産んだ（産んでから sim の一刻みもたっていない）なら、親のいる所から
      const fresh = time - e.laidAt < SIM.stepSeconds;
      let center = laidAtPos.get(key);
      if (!center) {
        const p = fresh && e.parent !== null ? parentPos(e.parent) : null;
        center = p ? p.clone() : this.homeOf(e);
        laidAtPos.set(key, center);
      }
      this.clutches.set(key, { clutch: e, center, eggs: this.makeEggs(e), bornAt: fresh ? this.clock : null });
    }
    for (const [key, c] of this.clutches) {
      if (seen.has(key)) continue;
      // 孵った：残っていた粒（孵る粒）の場所
      const list = this.hatched.get(c.clutch.parent) ?? [];
      for (const egg of c.eggs) if (egg.dud < 0) list.push(egg.pos.clone());
      this.hatched.set(c.clutch.parent, list);
      this.clutches.delete(key);
      laidAtPos.delete(key);
    }
  }

  /** 孵ったばかりの卵の粒の場所を一つ取る（親 parent の卵）。なければ null */
  takeHatchPoint(parent: number | null): Vector3 | null {
    return this.hatched.get(parent)?.shift() ?? null;
  }

  /** 粒を動かして描く。water は揺らされた瓶の水 */
  update(dt: number, water: WaterField | null): void {
    this.clock += dt;
    const P = (this.geo.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
    const A = (this.geo.getAttribute('aAlpha') as Float32BufferAttribute).array as Float32Array;
    const S = (this.geo.getAttribute('aSize') as Float32BufferAttribute).array as Float32Array;
    const settle = Math.exp(-dt / SETTLE);
    let n = 0;
    for (const c of this.clutches.values()) {
      const e = c.clutch;
      const span = Math.max(e.hatchAt - e.laidAt, 1);
      const age = Math.max(0, this.time - e.laidAt);
      const f = Math.min(age / span, 1);
      // 見ている間に産んだ卵は、親のそばからふわっと広がりながら現れる
      const born = c.bornAt === null ? 1 : Math.min(1, (this.clock - c.bornAt) / E.fadeIn);
      const puff = born * born * (3 - 2 * born);
      const spread = (E.clump + (E.spread - E.clump) * Math.sqrt(f)) * (0.35 + 0.65 * puff);
      const sink = Math.min(f / E.sinkBy, 1);
      for (const egg of c.eggs) {
        if (n >= MAX) break;
        let alpha = puff;
        if (egg.dud >= 0) alpha *= 1 - Math.min(Math.max((f - egg.dud) / E.dudFadeLength, 0), 1);
        const w = (Math.PI * 2) / egg.period;
        const t = this.clock * w + egg.phase;
        const p = egg.pos;
        p.set(c.center.x + egg.off.x * spread, c.center.y + egg.off.y * spread * 0.6, c.center.z + egg.off.z * spread);
        p.y += (egg.floor - p.y) * sink;
        p.x += E.wobble * Math.sin(t);
        p.y += E.wobble * 0.5 * Math.sin(t * 1.3 + 1.7);
        p.z += E.wobble * Math.cos(t * 0.8 + 0.4);
        // 揺らされた水に流された分（収まるとゆっくり戻る）
        if (water?.moving) egg.drift.addScaledVector(flowAt(water, p.x, p.y, p.z, this.tmp), dt);
        egg.drift.multiplyScalar(settle);
        p.add(egg.drift);
        // 瓶の中に収める
        const r = Math.hypot(p.x, p.z);
        const lim = INNER_R - E.radius * 3;
        if (r > lim) {
          p.x *= lim / r;
          p.z *= lim / r;
        }
        p.y = Math.min(Math.max(p.y, FLOOR_Y), JAR.waterLevel - 0.01);
        if (alpha <= 0.002) continue;
        P[n * 3] = p.x;
        P[n * 3 + 1] = p.y;
        P[n * 3 + 2] = p.z;
        A[n] = alpha;
        S[n] = E.radius * egg.size;
        n++;
      }
    }
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'aAlpha', 'aSize']) this.geo.getAttribute(name).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    (this.points.material as ShaderMaterial).dispose();
  }

  /** 見ていない間に産んだ卵の現れる所（卵の種で決める。瓶の中ほど） */
  private homeOf(e: EggClutch): Vector3 {
    const rng = createRng((e.seed ^ 0x2545f491) >>> 0);
    const b = swimBounds(CTENO.length * 0.5);
    const r = Math.sqrt(rng.next()) * b.radius * E.reach;
    const th = rng.range(0, Math.PI * 2);
    const y = b.bottom + (b.top - b.bottom) * rng.range(E.height[0], E.height[1]);
    return new Vector3(r * Math.cos(th), y, r * Math.sin(th));
  }

  /** 粒を作る（卵の種で決める）。はじめの count 粒が孵る粒 */
  private makeEggs(e: EggClutch): Egg[] {
    const rng = createRng(e.seed >>> 0);
    const out: Egg[] = [];
    // 固まりの中の場所：向きは球の上にむらなく（ゆらぎを足す）、離れ方は中ほどが多い。偏って二つの固まりに見えないように
    const turn = rng.range(0, Math.PI * 2);
    for (let i = 0; i < e.shown; i++) {
      const u = Math.min(Math.max(1 - (2 * (i + 0.5)) / e.shown + rng.range(-0.08, 0.08), -1), 1);
      const th = turn + i * 2.39996 + rng.range(-0.3, 0.3);
      const s = Math.sqrt(1 - u * u);
      const k = 0.35 + 0.65 * Math.sqrt(rng.next());
      out.push({
        off: new Vector3(s * Math.cos(th) * k, u * k, s * Math.sin(th) * k),
        floor: FLOOR_Y + rng.range(0, 0.02),
        phase: rng.range(0, Math.PI * 2),
        period: rng.range(E.wobblePeriod[0], E.wobblePeriod[1]),
        size: rng.range(0.8, 1.15),
        dud: i < e.count ? -1 : rng.range(E.dudFade[0], E.dudFade[1]),
        drift: new Vector3(),
        pos: new Vector3(),
      });
    }
    return out;
  }
}
