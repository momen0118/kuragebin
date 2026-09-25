// 水の中の粒。マリンスノーはほとんどが細かい粒で、ゆっくり沈む。瓶の軸にピントが合い、手前と奥はぼける。
// 泡はたまに一つだけ上がる。
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
import { GLOW_FALL } from './jarShaders';
import common from './shaders/common.glsl?raw';
import { frag } from './shaders/glsl';

const INNER_R = JAR.radius - JAR.glassThickness;

const DEFINES = /* glsl */ `
#define INNER_R ${INNER_R.toFixed(5)}
#define FLOOR_Y ${(JAR.bottomThickness + 0.004).toFixed(5)}
#define TOP_Y ${(JAR.waterLevel - 0.006).toFixed(5)}
#define FALL_MIN ${WATER.snowFallMin.toFixed(5)}
#define FALL_MAX ${WATER.snowFallMax.toFixed(5)}
#define SIZE_MIN ${WATER.snowSizeMin.toFixed(5)}
#define SIZE_MAX ${WATER.snowSizeMax.toFixed(5)}
#define SIZE_SKEW ${WATER.snowSizeSkew.toFixed(3)}
#define BRIGHT_MIN ${WATER.snowBrightnessMin.toFixed(3)}
#define APERTURE ${WATER.snowAperture.toFixed(5)}
#define FAR_FADE ${WATER.snowFarFade.toFixed(3)}
#define SNOW_AMBIENT ${WATER.snowAmbient.toFixed(3)}
#define SNOW_WINDOW ${WATER.snowWindow.toFixed(3)}
#define SNOW_GLOW ${WATER.snowGlow.toFixed(3)}
#define SNOW_OCCLUSION ${WATER.snowOcclusion.toFixed(3)}
`;

const SNOW_VERT = /* glsl */ `
${common}
${DEFINES}
${GLOW_FALL}
in vec4 aSeed;
in vec4 aSeed2;
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uKey, uAmbient, uGlowPos, uGlowColor;
out float vAlpha;
out vec3 vColor;
void main() {
  // 大きさは偏らせる：ほとんどが細かい粒で、大きい粒はまれ
  float sizeT = pow(aSeed2.x, SIZE_SKEW);
  float size = mix(SIZE_MIN, SIZE_MAX, sizeT);

  float r = sqrt(aSeed.x) * (INNER_R - 0.014);
  float th = aSeed.y * TAU + uTime * 0.01 * (aSeed.w - 0.5);
  vec3 p = vec3(r * cos(th), 0.0, r * sin(th));
  // 大きい粒ほど速く沈む
  float speed = mix(FALL_MIN, FALL_MAX, sqrt(sizeT)) * (0.7 + 0.6 * aSeed2.z);
  float range = TOP_Y - FLOOR_Y;
  float y = mod(aSeed.z * range - uTime * speed, range);
  p.y = FLOOR_Y + y;
  p.x += 0.005 * sin(uTime * 0.37 + aSeed2.w * 40.0);
  p.z += 0.005 * cos(uTime * 0.29 + aSeed.x * 50.0);
  float fade = smoothstep(0.0, 0.05, y) * smoothstep(range, range - 0.06, y);

  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  // 瓶の軸にピントが合う。外れるほどぼけて、そのぶん淡く広がる
  float focus = -(viewMatrix * vec4(0.0, p.y, 0.0, 1.0)).z;
  float proj = projectionMatrix[1][1] * uResolution.y * 0.5;
  float sizePx = size * proj / depth;
  float cocPx = APERTURE * abs(depth - focus) / depth * proj / focus;
  float diam = max(length(vec2(sizePx, cocPx)), 1.5);
  gl_PointSize = diam * 2.0;
  float cover = min(1.0, (sizePx * sizePx) / (diam * diam));

  // 奥の粒ほど淡い
  float front = saturate((p.z + INNER_R) / (2.0 * INNER_R));
  float bright = mix(BRIGHT_MIN, 1.0, aSeed2.y);
  vAlpha = fade * cover * bright * mix(FAR_FADE, 1.0, front);

  // 粒は自分では光らない。昼は部屋の光と、窓の側（左）にだけ当たる窓の光。
  // 夜は海月の光が届く粒だけが見え、海月から離れると闇に消える
  float side = saturate(0.5 - 0.5 * p.x / INNER_R);
  float lit = glowFall(p, uGlowPos);
  vColor = uAmbient * SNOW_AMBIENT + uKey * SNOW_WINDOW * side * side
         + uGlowColor * lit * sqrt(lit) * SNOW_GLOW;
}
`;

const SNOW_FRAG = /* glsl */ `
${DEFINES}
in float vAlpha;
in vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(q, q) * 4.0) * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, a * SNOW_OCCLUSION);
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
  // 大きさ・明るさ・沈む速さ・揺れの位相
  const seeds2 = new Float32Array(n * 4);
  for (let i = 0; i < seeds2.length; i++) seeds2[i] = rng.next();
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSeed', new Float32BufferAttribute(seeds, 4));
  geo.setAttribute('aSeed2', new Float32BufferAttribute(seeds2, 4));
  const pts = new Points(
    geo,
    premul(
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: SNOW_VERT,
        fragmentShader: frag(SNOW_FRAG),
        uniforms: {
          uTime: shared.uTime,
          uResolution: shared.uResolution,
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
