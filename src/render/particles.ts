// 水の中の粒。マリンスノーは手前ほど大きく速く、奥ほど小さく遅く沈む。泡はたまに一つだけ上がる。
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
} from 'three';
import { JAR, WATER } from '../config';
import type { Rng } from '../sim/rng';
import type { SharedUniforms } from './uniforms';
import common from './shaders/common.glsl?raw';
import { frag } from './shaders/glsl';

const INNER_R = JAR.radius - JAR.glassThickness;

const DEFINES = /* glsl */ `
#define INNER_R ${INNER_R.toFixed(5)}
#define FLOOR_Y ${(JAR.bottomThickness + 0.004).toFixed(5)}
#define TOP_Y ${(JAR.waterLevel - 0.006).toFixed(5)}
#define FALL_NEAR ${WATER.snowFallNear.toFixed(5)}
#define FALL_FAR ${WATER.snowFallFar.toFixed(5)}
#define SIZE_NEAR ${WATER.snowSizeNear.toFixed(3)}
#define SIZE_FAR ${WATER.snowSizeFar.toFixed(3)}
`;

const SNOW_VERT = /* glsl */ `
${common}
${DEFINES}
in vec4 aSeed;
uniform float uTime, uPixelRatio;
uniform vec3 uKey, uAmbient, uGlowPos, uGlowColor;
out float vAlpha;
out vec3 vColor;
void main() {
  float r = sqrt(aSeed.x) * (INNER_R - 0.014);
  float th = aSeed.y * TAU + uTime * 0.01 * (aSeed.w - 0.5);
  vec3 p = vec3(r * cos(th), 0.0, r * sin(th));
  // 手前（カメラ側）ほど大きく速い
  float front = saturate((p.z + INNER_R) / (2.0 * INNER_R));
  float speed = mix(FALL_FAR, FALL_NEAR, front) * (0.7 + 0.6 * fract(aSeed.w * 7.31));
  float range = TOP_Y - FLOOR_Y;
  float y = mod(aSeed.z * range - uTime * speed, range);
  p.y = FLOOR_Y + y;
  p.x += 0.005 * sin(uTime * 0.37 + aSeed.w * 40.0);
  p.z += 0.005 * cos(uTime * 0.29 + aSeed.x * 50.0);
  float fade = smoothstep(0.0, 0.05, y) * smoothstep(range, range - 0.06, y);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = mix(SIZE_FAR, SIZE_NEAR, front) * (0.55 + 0.9 * fract(aSeed.x * 13.7));
  gl_PointSize = max(size * uPixelRatio, 1.0);
  vec3 gd = p - uGlowPos;
  float g = 1.0 / (dot(gd, gd) * 70.0 + 1.0);
  float tw = pow(0.5 + 0.5 * sin(uTime * (0.5 + aSeed.w) + aSeed.y * 30.0), 10.0);
  vColor = uAmbient * 0.55 + uKey * (0.1 + 0.45 * tw) + uGlowColor * g * 1.1;
  vAlpha = fade * mix(0.35, 0.85, front);
}
`;

const SNOW_FRAG = /* glsl */ `
in float vAlpha;
in vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  float a = exp(-d * 3.2) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, a * 0.12);
}
`;

const BUBBLE_VERT = /* glsl */ `
uniform float uRadius;
uniform vec2 uResolution;
out float vDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float proj = projectionMatrix[1][1] * uResolution.y * 0.5;
  gl_PointSize = max(2.0 * uRadius * proj / -mv.z, 2.0);
  vDepth = -mv.z;
}
`;

const BUBBLE_FRAG = /* glsl */ `
${common}
uniform vec3 uKey, uAmbient, uGlowColor;
uniform float uAlpha;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = length(q);
  if (d > 1.0) discard;
  float ring = smoothstep(0.6, 0.92, d) * (1.0 - smoothstep(0.92, 1.0, d));
  float hl = exp(-dot(q - vec2(-0.32, -0.36), q - vec2(-0.32, -0.36)) * 28.0);
  vec3 lightC = uAmbient * 1.2 + uKey * 0.5 + uGlowColor * 0.25;
  vec3 col = lightC * (ring * 0.9 + hl * 1.6);
  float a = (ring * 0.35 + hl * 0.2) * uAlpha;
  gl_FragColor = vec4(col * uAlpha, a);
}
`;

function premul(m: ShaderMaterial): ShaderMaterial {
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  return m;
}

export function createSnow(shared: SharedUniforms, rng: Rng): Points {
  const n = WATER.snowCount;
  const seeds = new Float32Array(n * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rng.next();
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSeed', new Float32BufferAttribute(seeds, 4));
  const pts = new Points(
    geo,
    premul(
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: SNOW_VERT,
        fragmentShader: frag(SNOW_FRAG),
        uniforms: {
          uTime: shared.uTime,
          uPixelRatio: shared.uPixelRatio,
          uKey: shared.uKey,
          uAmbient: shared.uAmbient,
          uGlowPos: shared.uGlowPos,
          uGlowColor: shared.uGlowColor,
        },
      }),
    ),
  );
  pts.frustumCulled = false;
  pts.renderOrder = 20;
  return pts;
}

/** 泡。一度に一つだけ、間をあけて瓶底から上がる */
export class Bubble {
  readonly points: Points;
  private active = false;
  private timeToNext: number;
  private readonly pos = new Vector3();
  /** 上がりはじめてからの時間と、揺れの位相 */
  private age = 0;
  private phase = 0;
  private readonly alpha = { value: 0 };

  constructor(shared: SharedUniforms, private readonly rng: Rng) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
    this.points = new Points(
      geo,
      premul(
        new ShaderMaterial({
          glslVersion: GLSL3,
          vertexShader: BUBBLE_VERT,
          fragmentShader: frag(BUBBLE_FRAG),
          uniforms: {
            uRadius: { value: WATER.bubbleRadius },
            uResolution: shared.uResolution,
            uKey: shared.uKey,
            uAmbient: shared.uAmbient,
            uGlowColor: shared.uGlowColor,
            uAlpha: this.alpha,
          },
        }),
      ),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 55;
    this.points.visible = false;
    this.timeToNext = rng.range(WATER.bubbleIntervalMin * 0.3, WATER.bubbleIntervalMax * 0.6);
  }

  update(dt: number): void {
    if (!this.active) {
      this.timeToNext -= dt;
      if (this.timeToNext <= 0) {
        this.active = true;
        const r = Math.sqrt(this.rng.next()) * INNER_R * 0.75;
        const th = this.rng.next() * Math.PI * 2;
        this.pos.set(r * Math.cos(th), JAR.bottomThickness + 0.008, r * Math.sin(th));
        this.age = 0;
        this.phase = this.rng.next() * 10;
      }
    }
    if (this.active) {
      this.age += dt;
      this.phase += dt;
      const speed = WATER.bubbleRiseSpeed * Math.min(1, this.age * 2.5);
      this.pos.y += speed * dt;
      this.pos.x += Math.sin(this.phase * 9.0) * 0.012 * dt;
      this.pos.z += Math.cos(this.phase * 7.3) * 0.01 * dt;
      const top = JAR.waterLevel - 0.004;
      this.alpha.value = WATER.bubbleOpacity * Math.min(1, this.age * 4) * Math.min(1, (top - this.pos.y) / 0.01);
      if (this.pos.y >= top) {
        this.active = false;
        this.timeToNext = this.rng.range(WATER.bubbleIntervalMin, WATER.bubbleIntervalMax);
      }
    }
    this.points.visible = this.active;
    this.points.position.copy(this.pos);
  }
}
