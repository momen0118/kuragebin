// 餌の粒（ブラインシュリンプの幼生）。スポイトの先から水の中へ出て、ふわっと広がってゆっくり沈み、ときどきぴくっと跳ねる。
// 海月は緩むときに傘の下へ吸い込む流れで、近くの粒を縁へ寄せて捕まえ、しばらく縁で持ってから胃へ運ぶ。
// ポリプは寄ってきた粒や、底に着いた粒を触手で拾って口へ運ぶ。
// 誰がどれだけ食べるかは餌をやった瞬間に決まっている（sim）。ここではその数だけ粒を食べて見せ、胃に届くたびに胃の色を濃くする。
// 食べられずに底へ着いた粒は、数分で薄れて消える。位置は餌をやった瓶の座標（その瓶の中心が原点）。
import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DynamicDrawUsage,
  GLSL3,
  Matrix4,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { BELL, FOOD, JAR, WATER } from '../config';
import type { Rng } from '../sim/rng';
import type { Jellyfish } from './jelly/jellyfish';
import type { Polyp } from './jelly/polyp';
import { LAMP_GLSL, lampUniforms } from './lamp';
import common from './shaders/common.glsl?raw';
import { frag } from './shaders/glsl';
import type { Stomach } from './stomach';
import type { SharedUniforms } from './uniforms';

const INNER_R = JAR.radius - JAR.glassThickness;
/** 粒が動ける範囲：瓶の内壁の少し内側、底、水面の少し下 */
const WALL_R = INNER_R - 0.008;
const FLOOR_Y = JAR.bottomThickness + 0.003;
const TOP_Y = JAR.waterLevel - 0.006;
/** 四つ葉（胃のふくろ）の向き（縁弁の間）と、傘のローカルでの四つ葉の中心・輪郭の半径（bell.ts の形から） */
const POUCH = [0.25, 0.75, 1.25, 1.75].map((k) => k * Math.PI);
const POUCH_CENTER = 0.157;
const POUCH_RING = 0.087;
/** 小さな個体でも、寄せる範囲と捕まえる距離はこれより小さくしない（瓶の高さ単位） */
const MIN_PULL = 0.05;
const MIN_CATCH = 0.012;

/** 見せ場で食べる個体（餌をやった瓶の全員）。泳ぐ個体なら jelly、瓶底の個体なら polyp */
export interface Eater {
  id: number;
  stomach: Stomach;
  jelly: Jellyfish | null;
  polyp: Polyp | null;
}

type State = 'free' | 'held' | 'carry' | 'absorb' | 'floor' | 'gone';

interface Grain {
  state: State;
  pos: Vector3;
  vel: Vector3;
  size: number;
  alpha: number;
  /** 次に跳ねるまで */
  hop: number;
  /** 自分で泳ぐ横の向きと速さ、向きの変わり方 */
  heading: number;
  swim: number;
  turn: number;
  /** 今の状態になってからの時間と、その長さ */
  t: number;
  dur: number;
  /** 捕まえた個体 */
  eater: number;
  /** 捕まえてから胃（口）までの道すじ。泳ぐ個体は傘のローカル（傘の半径単位）、ポリプは足もとからのずれ */
  a: Vector3;
  b: Vector3;
  c: Vector3;
  phase: number;
}

/** 泳ぐ個体ごとに、1フレームに一度だけ求めておくもの */
interface SwimFrame {
  eater: Eater;
  jelly: Jellyfish;
  inv: Matrix4;
  /** 縁の輪（傘のローカル）：半径と高さ */
  mr: number;
  my: number;
  /** 緩んで水を吸い込んでいる度合い（0〜1） */
  relax: number;
}

const DEFS = /* glsl */ `
#define INNER_R ${INNER_R.toFixed(5)}
#define SIZE ${FOOD.size.toFixed(5)}
#define APERTURE ${WATER.snowAperture.toFixed(5)}
#define COLOR vec3(${FOOD.color.map((v) => v.toFixed(3)).join(', ')})
`;

const VERT = /* glsl */ `
${common}
${DEFS}
${LAMP_GLSL}
// 大きさの倍率と濃さ
in vec2 aInfo;
uniform vec2 uResolution;
uniform vec3 uKey, uAmbient;
out float vAlpha;
out vec3 vColor;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 p = wp.xyz;
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  // マリンスノーと同じく、瓶の軸にピントが合い、外れるほどぼけて淡く広がる
  float depth = -mv.z;
  float focus = -(viewMatrix * vec4(0.0, p.y, 0.0, 1.0)).z;
  float proj = projectionMatrix[1][1] * uResolution.y * 0.5;
  float sizePx = SIZE * aInfo.x * proj / depth;
  float cocPx = APERTURE * abs(depth - focus) / depth * proj / focus;
  float diam = max(length(vec2(sizePx, cocPx)), 1.5);
  gl_PointSize = diam * 2.0;
  float cover = min(1.0, (sizePx * sizePx) / (diam * diam));
  vAlpha = aInfo.y * cover;
  // 自分では光らない。部屋の光と窓の光（窓の側ほど）、夜はデスクライトの円錐の中だけ
  float side = saturate(0.5 - 0.5 * p.x / INNER_R);
  vec3 toCam = normalize(cameraPosition - p);
  float forward = saturate(dot(-lampDir(p), toCam));
  float lamp = lampSpot(p) * (0.6 + 0.8 * forward * forward);
  vColor = COLOR * (uAmbient * 0.9 + uKey * (0.18 + 0.4 * side * side) + uLampColor * lamp * 0.9);
}
`;

const FRAG = /* glsl */ `
in float vAlpha;
in vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(q, q) * 4.0) * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, a * 0.85);
}
`;

const ease = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

/** 2次のベジェ曲線 */
function bezier(a: Vector3, b: Vector3, c: Vector3, t: number, out: Vector3): Vector3 {
  const u = 1 - t;
  return out.set(
    u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    u * u * a.z + 2 * u * t * b.z + t * t * c.z,
  );
}

export class Food {
  readonly points: Points;
  private readonly grains: Grain[] = [];
  private readonly positions: Float32Array;
  private readonly info: Float32Array;
  private readonly geo: BufferGeometry;
  private readonly frames: SwimFrame[] = [];
  private readonly byId = new Map<number, Eater>();
  private time = 0;
  private readonly local = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly margin: [number, number] = [0, 0];

  constructor(
    shared: SharedUniforms,
    private readonly rng: Rng,
  ) {
    this.positions = new Float32Array(FOOD.max * 3);
    this.info = new Float32Array(FOOD.max * 2);
    this.geo = new BufferGeometry();
    // 配列はそのまま使う（毎フレーム書き換える）
    this.geo.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('aInfo', new BufferAttribute(this.info, 2).setUsage(DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new ShaderMaterial({
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
      },
    });
    this.points = new Points(this.geo, mat);
    this.points.frustumCulled = false;
    // マリンスノーのあと、海月の前（傘の中の粒は、傘の面越しに見える）
    this.points.renderOrder = 25;
    this.points.visible = false;
  }

  /** まだ見えている粒があるか */
  get active(): boolean {
    return this.grains.some((g) => g.state !== 'gone');
  }

  /** 水の中を漂っている粒や、食べられている途中の粒があるか（底に着いた粒と消えた粒は除く） */
  get moving(): boolean {
    return this.grains.some((g) => g.state !== 'gone' && g.state !== 'floor');
  }

  /** 確認用：状態ごとの粒の数 */
  counts(): Record<State, number> {
    const out: Record<State, number> = { free: 0, held: 0, carry: 0, absorb: 0, floor: 0, gone: 0 };
    for (const g of this.grains) out[g.state]++;
    return out;
  }

  /** 粒をすべて片付ける */
  clear(): void {
    this.grains.length = 0;
    this.time = 0;
    this.geo.setDrawRange(0, 0);
  }

  /** スポイトの先 tip から n 粒出す。下へ向かってふわっと広がる */
  emit(tip: Vector3, n: number): void {
    const r = this.rng;
    for (let k = 0; k < n && this.grains.length < FOOD.max; k++) {
      const th = r.range(0, Math.PI * 2);
      const out = r.range(0.2, 0.9);
      const dir = new Vector3(Math.cos(th) * out, -1, Math.sin(th) * out).normalize();
      this.grains.push({
        state: 'free',
        pos: tip.clone().add(new Vector3(r.range(-1, 1), r.range(-1, 0), r.range(-1, 1)).multiplyScalar(0.002)),
        vel: dir.multiplyScalar(FOOD.emitSpeed * r.range(0.4, 1)),
        size: 1 + FOOD.sizeJitter * (r.next() * 2 - 1),
        alpha: 1,
        hop: r.range(0.3, FOOD.hopInterval[1]),
        heading: th,
        swim: r.range(FOOD.swim[0], FOOD.swim[1]),
        turn: r.range(-FOOD.swimTurn, FOOD.swimTurn),
        t: 0,
        dur: 0,
        eater: -1,
        a: new Vector3(),
        b: new Vector3(),
        c: new Vector3(),
        phase: r.range(0, Math.PI * 2),
      });
    }
  }

  /** 粒を動かす。eaters は餌をやった瓶の個体（食べたい粒が残っているかは stomach が知っている） */
  update(dt: number, eaters: readonly Eater[]): void {
    if (!this.grains.length) return;
    this.time += dt;
    this.prepare(eaters);
    for (const g of this.grains) {
      g.t += dt;
      switch (g.state) {
        case 'free':
          this.stepFree(g, dt);
          break;
        case 'floor':
          this.stepFloor(g, dt);
          break;
        case 'held':
        case 'carry':
        case 'absorb':
          this.stepCaught(g);
          break;
        default:
          break;
      }
    }
    this.write();
  }

  /** 泳ぐ個体の傘の向きと縁の輪を、このフレームの分だけ求めておく */
  private prepare(eaters: readonly Eater[]): void {
    this.byId.clear();
    let n = 0;
    for (const e of eaters) {
      this.byId.set(e.id, e);
      if (!e.jelly) continue;
      let f = this.frames[n];
      if (!f) {
        f = { eater: e, jelly: e.jelly, inv: new Matrix4(), mr: 1, my: 0, relax: 0 };
        this.frames[n] = f;
      }
      f.eater = e;
      f.jelly = e.jelly;
      f.inv.copy(e.jelly.frame).invert();
      e.jelly.marginLocal(this.margin);
      f.mr = this.margin[0];
      f.my = this.margin[1];
      f.relax = Math.min(Math.max(-e.jelly.pulse.rate(), 0), 1);
      n++;
    }
    this.frames.length = n;
  }

  /** 漂う粒：沈み、跳ね、近くの海月の流れに寄せられ、触れたら捕まる。底に着いたら止まる */
  private stepFree(g: Grain, dt: number): void {
    const r = this.rng;
    g.hop -= dt;
    if (g.hop <= 0) {
      g.hop = r.range(FOOD.hopInterval[0], FOOD.hopInterval[1]);
      const th = r.range(0, Math.PI * 2);
      const u = r.range(-1, 1);
      const s = Math.sqrt(1 - u * u);
      const d = this.tmp.set(s * Math.cos(th), u * 0.5 + FOOD.hopUp, s * Math.sin(th)).normalize();
      g.vel.addScaledVector(d, FOOD.hopSpeed * r.range(0.6, 1.2));
      g.turn = r.range(-FOOD.swimTurn, FOOD.swimTurn);
    }
    g.vel.multiplyScalar(Math.exp(-FOOD.drag * dt));
    g.pos.addScaledVector(g.vel, dt);
    g.pos.y -= FOOD.sink * dt;
    g.heading += g.turn * dt;
    g.pos.x += Math.cos(g.heading) * g.swim * dt;
    g.pos.z += Math.sin(g.heading) * g.swim * dt;
    if (this.pullAndCatch(g, dt)) return;
    // 瓶の壁と水面の内側に収める
    const rr = Math.hypot(g.pos.x, g.pos.z);
    if (rr > WALL_R) {
      g.pos.x *= WALL_R / rr;
      g.pos.z *= WALL_R / rr;
      g.vel.multiplyScalar(0.3);
    }
    if (g.pos.y > TOP_Y) {
      g.pos.y = TOP_Y;
      g.vel.y = Math.min(g.vel.y, 0);
    }
    if (g.pos.y <= FLOOR_Y) {
      g.pos.y = FLOOR_Y;
      g.vel.set(0, 0, 0);
      g.state = 'floor';
      g.t = 0;
      this.pickFromFloor(g);
    }
  }

  /** 近くの食べたい個体へ寄せ、触れたら捕まえる。捕まったら true */
  private pullAndCatch(g: Grain, dt: number): boolean {
    const p = g.pos;
    for (const f of this.frames) {
      if (!f.eater.stomach.hungry) continue;
      const q = this.local.copy(p).applyMatrix4(f.inv);
      const rho = Math.hypot(q.x, q.z);
      const dx = rho > 1e-6 ? q.x / rho : 1;
      const dz = rho > 1e-6 ? q.z / rho : 0;
      const dRing = Math.hypot(rho - f.mr, q.y - f.my);
      const R = f.jelly.radius;
      const range = Math.max(FOOD.pullRange, MIN_PULL / R);
      if (dRing > range) continue;
      const reach = Math.max(FOOD.catchRange, MIN_CATCH / R);
      // 縁に触れた、または傘の下の触手の間に入った
      const under = rho < f.mr * 1.05 && q.y < f.my + 0.12 && q.y > f.my - 0.55;
      if (dRing < reach || under) {
        this.catchBySwimmer(g, f, q, dx, dz, under);
        return true;
      }
      // 緩むときに傘の下へ吸い込む流れで、縁へ寄っていく
      const target = this.tmp.set(f.mr * dx, f.my, f.mr * dz).applyMatrix4(f.jelly.frame).sub(p);
      const len = target.length();
      if (len > 1e-6) {
        // 流れは縁の近くほど強い（遠くの粒まで一緒に引き寄せない）
        const k = 1 - dRing / range;
        const speed = FOOD.pull * Math.max(R / BELL.radius, 0.3) * k * k * k * (0.35 + 0.65 * f.relax);
        p.addScaledVector(target, (Math.min(speed * dt, len) / len));
      }
    }
    for (const e of this.byId.values()) {
      if (!e.polyp || !e.stomach.hungry) continue;
      const crown = e.polyp.top(this.tmp2);
      const H = e.polyp.size;
      const d = p.distanceTo(crown);
      if (d < H * FOOD.polypCatch) {
        this.catchByPolyp(g, e);
        return true;
      }
      // 底の近くを沈んでくる粒は、ポリプの起こすゆるい流れで冠のほうへ寄る
      if (p.y < crown.y + 0.12) {
        const hd = Math.hypot(p.x - crown.x, p.z - crown.z);
        if (hd < FOOD.polypPullRange && d > 1e-6) {
          const speed = FOOD.polypPull * (1 - hd / FOOD.polypPullRange);
          const toward = this.tmp.copy(crown).sub(p);
          p.addScaledVector(toward, Math.min(speed * dt, d) / d);
        }
      }
    }
    return false;
  }

  /** 海月が粒を捕まえた：縁（または触手）で持ち、口腕のほうを通って胃のふくろへ運ぶ道すじを決める */
  private catchBySwimmer(g: Grain, f: SwimFrame, q: Vector3, dx: number, dz: number, under: boolean): void {
    const r = this.rng;
    g.state = 'held';
    g.t = 0;
    g.dur = r.range(FOOD.holdSeconds[0], FOOD.holdSeconds[1]);
    g.eater = f.eater.id;
    g.vel.set(0, 0, 0);
    if (under) {
      const rho = Math.min(Math.hypot(q.x, q.z), f.mr * 0.98);
      g.a.set(rho * dx, Math.min(Math.max(q.y, f.my - 0.5), f.my + 0.08), rho * dz);
    } else {
      g.a.set(f.mr * 0.97 * dx, f.my, f.mr * 0.97 * dz);
    }
    g.b.set(0.42 * dx, f.my - 0.08, 0.42 * dz);
    // いちばん近い四つ葉の、輪郭の外側の弧の上（色づくのは輪郭だけ）。四つ葉のまだないエフィラは真ん中の胃
    const th = Math.atan2(dz, dx);
    let best = POUCH[0]!;
    for (const a of POUCH) if (Math.abs(Math.atan2(Math.sin(th - a), Math.cos(th - a))) < Math.abs(Math.atan2(Math.sin(th - best), Math.cos(th - best)))) best = a;
    const k = f.jelly.gonads;
    const along = best + r.range(-1, 1);
    g.c.set(
      k * (POUCH_CENTER * Math.cos(best) + POUCH_RING * Math.cos(along)),
      0.29,
      k * (POUCH_CENTER * Math.sin(best) + POUCH_RING * Math.sin(along)),
    );
    f.eater.stomach.catch();
  }

  /** ポリプが粒を捕まえた：触手の冠へ寄せてから口へ運ぶ */
  private catchByPolyp(g: Grain, e: Eater): void {
    const polyp = e.polyp!;
    const r = this.rng;
    g.state = 'held';
    g.t = 0;
    g.dur = r.range(FOOD.holdSeconds[0], FOOD.holdSeconds[1]) * 0.6;
    g.eater = e.id;
    g.vel.set(0, 0, 0);
    g.a.copy(g.pos).sub(polyp.base);
    g.b.copy(polyp.top(this.tmp)).sub(polyp.base);
    g.c.copy(polyp.axis).multiplyScalar(polyp.size * 1.0);
    e.stomach.catch();
  }

  /** 底に着いた粒を、近くの食べたいポリプが拾う */
  private pickFromFloor(g: Grain): boolean {
    for (const e of this.byId.values()) {
      if (!e.polyp || !e.stomach.hungry) continue;
      const b = e.polyp.base;
      if (Math.hypot(g.pos.x - b.x, g.pos.z - b.z) < e.polyp.size * FOOD.polypReach) {
        this.catchByPolyp(g, e);
        return true;
      }
    }
    return false;
  }

  /** 底の粒：ときどき小さく動き、数分で薄れて消える。近くのポリプが食べたければ拾う */
  private stepFloor(g: Grain, dt: number): void {
    if (this.pickFromFloor(g)) return;
    g.hop -= dt;
    if (g.hop <= 0) {
      g.hop = this.rng.range(FOOD.hopInterval[0], FOOD.hopInterval[1]) * 2;
      g.pos.x += this.rng.range(-1, 1) * 0.0015;
      g.pos.z += this.rng.range(-1, 1) * 0.0015;
    }
    const F = FOOD.floorFadeSeconds;
    g.alpha = 1 - ease((g.t - 0.4 * F) / (0.6 * F));
    if (g.t >= F) g.state = 'gone';
  }

  /** 捕まった粒：持っている → 胃へ運ぶ → 胃で見えなくなる。持ち主がいなくなったら、その場から漂いはじめる */
  private stepCaught(g: Grain): void {
    const e = this.byId.get(g.eater);
    const jelly = e?.jelly ?? null;
    const polyp = e?.polyp ?? null;
    if (!e || (!jelly && !polyp)) {
      g.state = 'free';
      g.t = 0;
      g.alpha = 1;
      return;
    }
    if (g.state === 'held' && g.t >= g.dur) {
      g.state = 'carry';
      g.t = 0;
      g.dur = this.rng.range(FOOD.carrySeconds[0], FOOD.carrySeconds[1]) * (polyp ? 0.7 : 1);
    } else if (g.state === 'carry' && g.t >= g.dur) {
      g.state = 'absorb';
      g.t = 0;
    } else if (g.state === 'absorb' && g.t >= FOOD.absorbSeconds) {
      g.state = 'gone';
      e.stomach.eat();
      return;
    }
    const p = this.local;
    if (g.state === 'held') {
      // 生きているので、捕まっていても少し動く（泳ぐ個体は傘の半径単位、ポリプは瓶の高さ単位）
      const w = polyp ? polyp.size * 0.1 : 0.02;
      p.copy(g.a);
      p.x += Math.sin(g.t * 11 + g.phase) * w;
      p.y += Math.sin(g.t * 7.3 + g.phase * 2) * w;
    } else if (g.state === 'carry') {
      bezier(g.a, g.b, g.c, ease(g.t / g.dur), p);
    } else {
      p.copy(g.c);
      g.alpha = 1 - ease(g.t / FOOD.absorbSeconds);
    }
    if (jelly) g.pos.copy(p).applyMatrix4(jelly.frame);
    else g.pos.copy(p).add(polyp!.base);
  }

  /** 見えている粒だけを詰めて書く */
  private write(): void {
    let n = 0;
    for (const g of this.grains) {
      if (g.state === 'gone') continue;
      this.positions[n * 3] = g.pos.x;
      this.positions[n * 3 + 1] = g.pos.y;
      this.positions[n * 3 + 2] = g.pos.z;
      this.info[n * 2] = g.size;
      this.info[n * 2 + 1] = g.alpha;
      n++;
    }
    this.geo.setDrawRange(0, n);
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('aInfo').needsUpdate = true;
    if (n === 0) this.grains.length = 0;
  }
}
