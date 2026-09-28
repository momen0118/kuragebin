// 揺らしたときだけ出るもの。
// 飛沫：強く振ったときだけ、水面の縁から小さな水の粒が少し跳ねて、水に戻る（泡は作らない。水位は減らない）。
// 舞い上がる堆積：瓶底に溜まったものが流れで舞い上がり、ゆっくり沈み直す。舞っている分だけ瓶底の模様が薄くなる。
// どちらも表示中の瓶の分だけ持つ（瓶の座標。瓶は原点）。
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
  Vector2,
  Vector3,
} from 'three';
import { JAR, SEDIMENT, SPLASH, STIRRED_SEDIMENT, WATER } from '../config';
import type { Rng } from '../sim/rng';
import { LAMP_GLSL, lampUniforms } from './lamp';
import { flowAt, type WaterMotion } from './slosh';
import common from './shaders/common.glsl?raw';
import { frag } from './shaders/glsl';
import type { SharedUniforms } from './uniforms';

const INNER_R = JAR.radius - JAR.glassThickness;
const FLOOR_Y = JAR.bottomThickness + 0.003;

function premul(m: ShaderMaterial): ShaderMaterial {
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  return m;
}

/** 点の大きさ（ワールドの直径 aSize）を画面 px にする。小さすぎる粒は太さを保って薄くする */
const POINT_VERT = /* glsl */ `
in float aSize;
in float aAlpha;
uniform vec2 uResolution;
out float vAlpha;
out vec3 vWorld;
void main() {
  vWorld = position;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float proj = projectionMatrix[1][1] * uResolution.y * 0.5;
  float px = aSize * proj / -mv.z;
  gl_PointSize = max(px, 1.5) * 2.0;
  vAlpha = aAlpha * min(1.0, px * px / 2.25);
}
`;

/** 水の粒：縁が細く光り、光の側に小さなハイライト。自分では光らない */
const DROP_FRAG = /* glsl */ `
${common}
${LAMP_GLSL}
uniform vec3 uKey, uAmbient;
in float vAlpha;
in vec3 vWorld;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = length(q) * 2.0;
  if (d > 1.0 || vAlpha < 0.002) discard;
  float ring = smoothstep(0.45, 0.9, d) * (1.0 - smoothstep(0.9, 1.0, d));
  float hl = exp(-dot(q * 2.0 - vec2(-0.3, -0.35), q * 2.0 - vec2(-0.3, -0.35)) * 20.0);
  vec3 lightC = uAmbient * 1.2 + uKey * 0.6 + uLampColor * lampSpot(vWorld) * 0.8;
  vec3 col = lightC * (ring * 0.8 + hl * 1.8 + 0.08);
  float a = (ring * 0.35 + hl * 0.25 + 0.05) * vAlpha;
  gl_FragColor = vec4(col * vAlpha, a);
}
`;

/** 舞い上がった堆積の粒：マリンスノーと同じく自分では光らず、部屋の光とデスクライトを受けたぶんだけ見える */
const DUST_FRAG = /* glsl */ `
${common}
${LAMP_GLSL}
uniform vec3 uKey, uAmbient, uDust;
in float vAlpha;
in vec3 vWorld;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(q, q) * 4.0) * vAlpha;
  if (a < 0.002) discard;
  float side = saturate(0.5 - 0.5 * vWorld.x / ${INNER_R.toFixed(4)});
  vec3 lightC = uAmbient * ${WATER.snowAmbient.toFixed(3)} * 1.4 + uKey * ${WATER.snowWindow.toFixed(3)} * side * side + uLampColor * lampSpot(vWorld) * ${WATER.snowLamp.toFixed(3)};
  gl_FragColor = vec4(uDust * lightC * a, a * ${WATER.snowOcclusion.toFixed(3)});
}
`;

function pointsOf(shared: SharedUniforms, n: number, fragment: string, extra: Record<string, { value: unknown }> = {}): Points {
  const geo = new BufferGeometry();
  const pos = new Float32BufferAttribute(new Float32Array(n * 3), 3);
  const size = new Float32BufferAttribute(new Float32Array(n), 1);
  const alpha = new Float32BufferAttribute(new Float32Array(n), 1);
  for (const a of [pos, size, alpha]) a.setUsage(DynamicDrawUsage);
  geo.setAttribute('position', pos);
  geo.setAttribute('aSize', size);
  geo.setAttribute('aAlpha', alpha);
  const pts = new Points(
    geo,
    premul(
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: POINT_VERT,
        fragmentShader: frag(fragment),
        uniforms: {
          ...lampUniforms(shared),
          uResolution: shared.uResolution,
          uKey: shared.uKey,
          uAmbient: shared.uAmbient,
          ...extra,
        },
      }),
    ),
  );
  pts.frustumCulled = false;
  return pts;
}

interface Drop {
  pos: Vector3;
  vel: Vector3;
  alive: boolean;
}

/** 飛沫。強く振ったときだけ、水面の縁の上がっていく側から少し跳ねて、水に戻る */
export class Splash {
  readonly points: Points;
  private readonly drops: Drop[];
  private cooldown = 0;
  /** 跳ねている粒があるか */
  active = false;
  /** 強い一回を振ってから跳ねるまでの残り（秒）と、水が寄る側 */
  private kickDelay = -1;
  private readonly kickDir = new Vector2(1, 0);

  constructor(
    shared: SharedUniforms,
    private readonly rng: Rng,
    /** 水に戻った所に小さな波紋を立てる */
    private readonly ripple: (x: number, z: number, strength: number) => void,
  ) {
    this.drops = Array.from({ length: SPLASH.max }, () => ({ pos: new Vector3(), vel: new Vector3(), alive: false }));
    this.points = pointsOf(shared, SPLASH.max, DROP_FRAG);
    this.points.renderOrder = 61;
  }

  clear(): void {
    for (const d of this.drops) d.alive = false;
    this.active = false;
  }

  update(dt: number, water: WaterMotion): void {
    this.cooldown -= dt;
    const surface = (x: number, z: number): number => JAR.waterLevel + water.slope.x * x + water.slope.y * z;
    // 強い一回を振った直後は、水が寄る側から跳ねる（少し遅れて、水が縁へ寄ったころ）
    const kicked = water.splashKick >= SPLASH.kickAt;
    if (kicked) {
      this.kickDelay = SPLASH.kickDelay;
      this.kickDir.copy(water.splashDir);
    }
    water.splashKick = 0;
    this.kickDelay -= dt;
    const fromKick = this.kickDelay <= 0 && this.kickDelay > -dt - 1e-6;
    if ((water.rimSpeed > SPLASH.threshold || fromKick) && this.cooldown <= 0) {
      this.cooldown = SPLASH.interval;
      const [lo, hi] = SPLASH.count;
      const n = lo + Math.floor(this.rng.next() * (hi - lo + 1));
      for (let i = 0; i < n; i++) {
        const d = this.drops.find((x) => !x.alive);
        if (!d) break;
        // 水面の縁が上がっていく側から
        const side = fromKick ? this.kickDir : water.rimDir;
        const th = Math.atan2(side.y, side.x) + this.rng.range(-0.6, 0.6);
        const r = INNER_R - 0.006;
        const x = r * Math.cos(th);
        const z = r * Math.sin(th);
        d.pos.set(x, surface(x, z) + 0.002, z);
        const up = this.rng.range(SPLASH.speed[0], SPLASH.speed[1]);
        const down = water.field.down;
        d.vel.copy(down).multiplyScalar(-up);
        // 少し内側へ、横へばらける
        d.vel.x += -Math.cos(th) * up * 0.3 + this.rng.range(-0.05, 0.05);
        d.vel.z += -Math.sin(th) * up * 0.3 + this.rng.range(-0.05, 0.05);
        d.alive = true;
      }
    }
    const P = (this.points.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
    const S = (this.points.geometry.getAttribute('aSize') as Float32BufferAttribute).array as Float32Array;
    const A = (this.points.geometry.getAttribute('aAlpha') as Float32BufferAttribute).array as Float32Array;
    let any = false;
    this.drops.forEach((d, i) => {
      if (d.alive) {
        d.vel.addScaledVector(water.field.down, SPLASH.gravity * dt);
        d.pos.addScaledVector(d.vel, dt);
        const rr = Math.hypot(d.pos.x, d.pos.z);
        if (rr > INNER_R - 0.004) {
          d.pos.x *= (INNER_R - 0.004) / rr;
          d.pos.z *= (INNER_R - 0.004) / rr;
        }
        // 水に戻った
        if (d.vel.dot(water.field.down) > 0 && d.pos.y <= surface(d.pos.x, d.pos.z)) {
          d.alive = false;
          this.ripple(d.pos.x, d.pos.z, SPLASH.ripple);
        }
      }
      P[i * 3] = d.pos.x;
      P[i * 3 + 1] = d.pos.y;
      P[i * 3 + 2] = d.pos.z;
      S[i] = SPLASH.radius * 2;
      A[i] = d.alive ? SPLASH.opacity : 0;
      any ||= d.alive;
    });
    for (const k of ['position', 'aSize', 'aAlpha']) this.points.geometry.getAttribute(k).needsUpdate = true;
    this.active = any;
  }
}

interface Mote {
  pos: Vector3;
  vel: Vector3;
  fall: number;
  size: number;
  alive: boolean;
}

/** 瓶底から舞い上がった堆積。流れに運ばれて、ゆっくり沈み直す */
export class StirredSediment {
  readonly points: Points;
  private readonly motes: Mote[];
  /** 今回の揺れで舞い上がる数（すべて沈みきったら、また数えなおす）と、舞い上がった数 */
  private budget = 0;
  private lifted = 0;
  private liftAcc = 0;
  private readonly tmp = new Vector3();
  /** 舞っている粒があるか */
  active = false;

  constructor(shared: SharedUniforms, private readonly rng: Rng) {
    this.motes = Array.from({ length: STIRRED_SEDIMENT.max }, () => ({ pos: new Vector3(), vel: new Vector3(), fall: 0, size: 0, alive: false }));
    this.points = pointsOf(shared, STIRRED_SEDIMENT.max, DUST_FRAG, { uDust: { value: new Vector3(...SEDIMENT.color) } });
    this.points.renderOrder = 21;
  }

  clear(): void {
    for (const m of this.motes) m.alive = false;
    this.budget = 0;
    this.lifted = 0;
    this.active = false;
  }

  /** 舞っている割合（0〜1）。瓶底の模様をそのぶん薄くする */
  get suspended(): number {
    if (this.budget <= 0) return 0;
    let n = 0;
    for (const m of this.motes) if (m.alive) n++;
    return Math.min(1, n / this.budget);
  }

  /** sediment はその瓶の瓶底に溜まったもの（sim の sediment） */
  update(dt: number, water: WaterMotion, sediment: number): void {
    const f = water.field;
    const L = STIRRED_SEDIMENT;
    let alive = 0;
    for (const m of this.motes) if (m.alive) alive++;
    if (alive === 0) {
      this.budget = 0;
      this.lifted = 0;
    }
    if (f.stir > L.liftAt && sediment > 0.02) {
      if (this.budget === 0) this.budget = Math.round(Math.min(Math.max(sediment * L.perSediment, L.min), L.max));
      this.liftAcc += dt * L.liftRate * this.budget * ((f.stir - L.liftAt) / (1 - L.liftAt));
      while (this.liftAcc >= 1 && this.lifted < this.budget) {
        this.liftAcc -= 1;
        const m = this.motes.find((x) => !x.alive);
        if (!m) break;
        this.lifted++;
        // 縁の角に多く溜まっているので、外寄りから
        const r = Math.sqrt(this.rng.next()) ** 0.6 * (INNER_R - 0.01);
        const th = this.rng.range(0, Math.PI * 2);
        m.pos.set(r * Math.cos(th), FLOOR_Y + 0.002, r * Math.sin(th));
        m.vel.copy(f.down).multiplyScalar(-this.rng.range(L.lift[0], L.lift[1]));
        m.fall = this.rng.range(L.fall[0], L.fall[1]);
        m.size = this.rng.range(L.size[0], L.size[1]);
        m.alive = true;
      }
    } else this.liftAcc = 0;

    const P = (this.points.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
    const S = (this.points.geometry.getAttribute('aSize') as Float32BufferAttribute).array as Float32Array;
    const A = (this.points.geometry.getAttribute('aAlpha') as Float32BufferAttribute).array as Float32Array;
    const couple = 1 - Math.exp(-1.5 * dt);
    let any = false;
    this.motes.forEach((m, i) => {
      if (m.alive) {
        // 流れについていき（舞い上がった勢いは少しずつ流れに馴染む）、ゆっくり沈む
        const u = flowAt(f, m.pos.x, m.pos.y, m.pos.z, this.tmp).multiplyScalar(L.follow);
        m.vel.lerp(u, couple);
        m.pos.addScaledVector(m.vel, dt).addScaledVector(f.down, m.fall * dt);
        const rr = Math.hypot(m.pos.x, m.pos.z);
        const lim = INNER_R - 0.006;
        if (rr > lim) {
          m.pos.x *= lim / rr;
          m.pos.z *= lim / rr;
        }
        // 水面の近くでは、上へ運ばれにくい（水面の下に溜まらないように）
        const room = JAR.waterLevel - 0.02 - m.pos.y;
        if (room < STIRRED_SEDIMENT.topSoft) {
          const k = Math.max(room, 0) / STIRRED_SEDIMENT.topSoft;
          const up = -m.vel.dot(f.down);
          if (up > 0) m.vel.addScaledVector(f.down, up * (1 - k));
        }
        // 瓶底に戻った
        if (m.pos.y <= FLOOR_Y) m.alive = false;
      }
      P[i * 3] = m.pos.x;
      P[i * 3 + 1] = m.pos.y;
      P[i * 3 + 2] = m.pos.z;
      S[i] = m.size;
      // 底の近くでは、瓶底に溶けこむように薄い
      A[i] = m.alive ? Math.min(1, (m.pos.y - FLOOR_Y) / 0.01) * STIRRED_SEDIMENT.opacity : 0;
      any ||= m.alive;
    });
    for (const k of ['position', 'aSize', 'aAlpha']) this.points.geometry.getAttribute(k).needsUpdate = true;
    this.active = any;
  }
}
