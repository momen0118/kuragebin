// 瓶。厚いガラスの円筒で、口は開いたまま蓋はない。
// 奥側のガラス・瓶底・水面は海月と同じ画像に描き、手前のガラスは最後にその画像を屈折させて描く。
import {
  BackSide,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  GLSL3,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Vector3,
  type Texture,
} from 'three';
import { JAR, WATER } from '../config';
import type { SharedUniforms } from './uniforms';
import common from './shaders/common.glsl?raw';
import output from './shaders/output.glsl?raw';
import { frag } from './shaders/glsl';

type P2 = [number, number];

/** 瓶の外側の断面（半径, 高さ）。底の中心から縁を回って口の内側まで */
export function jarProfile(): P2[] {
  const R = JAR.radius;
  const rc = JAR.bottomCornerRadius;
  const pts: P2[] = [];
  for (let i = 0; i <= 6; i++) pts.push([((R - rc) * i) / 6, 0]);
  for (let i = 1; i <= 10; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / 10);
    pts.push([R - rc + rc * Math.cos(a), rc + rc * Math.sin(a)]);
  }
  const wallSteps = 24;
  for (let i = 1; i <= wallSteps; i++) pts.push([R, rc + ((JAR.shoulderStart - rc) * i) / wallSteps]);
  const sh = 22;
  for (let i = 1; i <= sh; i++) {
    const t = i / sh;
    const u = t * t * (3 - 2 * t);
    pts.push([R + (JAR.neckRadius - R) * u, JAR.shoulderStart + (JAR.shoulderEnd - JAR.shoulderStart) * t]);
  }
  const lipStart = JAR.height - JAR.glassThickness * 0.6;
  const neckSteps = 36;
  for (let i = 1; i <= neckSteps; i++) {
    const y = JAR.shoulderEnd + ((lipStart - JAR.shoulderEnd) * i) / neckSteps;
    let r = JAR.neckRadius;
    for (const ty of JAR.threads) {
      const d = (y - ty) / JAR.threadWidth;
      r += JAR.threadBulge * Math.exp(-d * d * 2.5);
    }
    pts.push([r, y]);
  }
  // 口の縁は丸く
  const t = JAR.glassThickness;
  const cx = JAR.neckRadius - t / 2;
  const cy = lipStart;
  const rr = t / 2;
  for (let i = 1; i <= 12; i++) {
    const a = (Math.PI * i) / 12;
    pts.push([cx + rr * Math.cos(a) * 1.08, cy + rr * Math.sin(a) * 1.25]);
  }
  return pts;
}

/** 断面を回して回転体を作る。法線は断面の傾きから決める */
export function lathe(profile: P2[], segments: number): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const prev = profile[Math.max(i - 1, 0)]!;
    const next = profile[Math.min(i + 1, n - 1)]!;
    let tr = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const tl = Math.hypot(tr, ty) || 1;
    tr /= tl;
    ty /= tl;
    const [r, y] = profile[i]!;
    for (let j = 0; j <= segments; j++) {
      const th = (j / segments) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      pos.push(r * c, y, r * s);
      nrm.push(ty * c, -tr, ty * s);
    }
  }
  const row = segments + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      const b = a + row;
      // 外から見て反時計回り（表）になる向き
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** 円盤（極座標の格子）。uv.x = 半径の割合、uv.y = 角度の割合 */
function disk(radius: number, rings: number, segments: number, y: number): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const r = (i / rings) * radius;
    for (let j = 0; j <= segments; j++) {
      const th = (j / segments) * Math.PI * 2;
      pos.push(r * Math.cos(th), y, r * Math.sin(th));
      uv.push(i / rings, j / segments);
    }
  }
  const row = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      const b = a + row;
      // 上から見て反時計回り（上向きが表）
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const JAR_DEFINES = /* glsl */ `
#define JAR_R ${JAR.radius.toFixed(5)}
#define JAR_T ${JAR.glassThickness.toFixed(5)}
#define JAR_BOTTOM ${JAR.bottomThickness.toFixed(5)}
#define JAR_H ${JAR.height.toFixed(5)}
#define WATER_Y ${JAR.waterLevel.toFixed(5)}
#define WAVE_H ${WATER.waveHeight.toFixed(5)}
#define CAUSTIC_SCALE ${WATER.causticScale.toFixed(3)}
#define CAUSTIC_SPEED ${WATER.causticSpeed.toFixed(3)}
`;

const WATER_HEIGHT = /* glsl */ `
float waterHeight(vec2 xz, float t) {
  float w = sin(xz.x * 23.0 + t * 1.3) * cos(xz.y * 19.0 - t * 1.05)
          + 0.6 * sin((xz.x - xz.y) * 31.0 + t * 1.9)
          + 0.4 * cos((xz.x * 0.7 + xz.y) * 43.0 - t * 2.4);
  return WATER_Y + WAVE_H * w * 0.5;
}
`;

const WATER_FUNCS = /* glsl */ `
${WATER_HEIGHT}
// 部屋の映り込みの代わり。部屋は暗く、窓（左）の方向だけが明るい
vec3 envColor(vec3 R, vec3 ambient, vec3 key, vec3 keyDir) {
  float up = R.y * 0.5 + 0.5;
  vec3 base = ambient * (0.12 + 0.3 * up);
  float win = pow(saturate(dot(R, keyDir)), 14.0);
  return base + key * win * 0.7;
}
`;

const GLASS_VERT = /* glsl */ `
out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec3 vViewNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// 奥側のガラス：内側から見た奥の壁。映り込みとハイライトをうっすら足す
const BACK_FRAG = /* glsl */ `
${common}
${JAR_DEFINES}
${WATER_FUNCS}
uniform float uTime;
uniform vec3 uKey, uKeyDir, uAmbient, uGlowPos, uGlowColor;
uniform float uRimWarm;
uniform vec3 uRimWarmColor;
in vec3 vWorldPos;
in vec3 vWorldNormal;
void main() {
  vec3 N = -normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float NdV = saturate(dot(N, V));
  float e = sqrt(1.0 - NdV * NdV);
  float inWater = step(vWorldPos.y, waterHeight(vWorldPos.xz, uTime));
  float F = 0.03 + 0.97 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  vec3 col = envColor(R, uAmbient, uKey, uKeyDir) * F * mix(0.7, 0.35, inWater);
  vec3 H = normalize(uKeyDir + V);
  float sp = pow(saturate(dot(N, H)), 160.0);
  col += uKey * sp * mix(0.5, 0.25, inWater);
  // 縁の厚み
  float rr = length(vWorldPos.xz);
  float eIn = (rr - JAR_T) / rr;
  col += (uAmbient * 0.6 + uKey * 0.08) * exp(-pow((e - eIn) / 0.01, 2.0)) * 0.5;
  // 海月の光が奥のガラスにぼんやり当たる。縁ではガラスの中を光が回り込む
  vec3 gd = uGlowPos - vWorldPos;
  float gl2 = dot(gd, gd);
  col += uGlowColor * (0.012 / (1.0 + gl2 * 60.0) + 0.05 * pow(e, 8.0) * exp(-gd.y * gd.y / 0.015));
  col += uRimWarm * uRimWarmColor * pow(e, 12.0) * 0.1;
  float a = 0.04 + 0.2 * pow(e, 6.0);
  // 底の面は瓶底のシェーダに任せ、ここでは側面だけを描く
  float wall = 1.0 - smoothstep(0.4, 0.85, abs(N.y));
  gl_FragColor = vec4(col, a) * wall;
}
`;

// 瓶底：ガラス越しの天板にコースティクスが揺れる。夜は海月の光が落ちる
const FLOOR_VERT = /* glsl */ `
out vec3 vWorldPos;
out vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FLOOR_FRAG = /* glsl */ `
${common}
${JAR_DEFINES}
uniform float uTime, uCaustics;
uniform vec3 uKey, uKeyDir, uAmbient, uGlowPos, uGlowColor;
in vec3 vWorldPos;
in vec2 vUv;
void main() {
  float r = vUv.x;
  vec2 p = vWorldPos.xz - uKeyDir.xz / max(uKeyDir.y, 0.2) * (WATER_Y - JAR_BOTTOM) * 0.15;
  float c = caustics(p * CAUSTIC_SCALE, uTime * CAUSTIC_SPEED);
  c = c / (1.0 + 0.5 * c);
  float edge = 1.0 - smoothstep(0.8, 1.0, r);
  vec3 col = uKey * c * uCaustics * 0.09 * edge;
  vec3 gd = vWorldPos - uGlowPos;
  float g = 1.0 / (dot(gd, gd) * 40.0 + 1.0);
  col += uGlowColor * g * 0.035;
  col += (uAmbient * 0.35 + uKey * 0.05) * smoothstep(0.86, 0.99, r) * 0.5;
  gl_FragColor = vec4(col, 0.1 + 0.1 * smoothstep(0.7, 1.0, r));
}
`;

// 水面を下から見上げる。全反射で銀色に光る揺れる境界が、うっすら見える
const SURFACE_VERT = /* glsl */ `
${JAR_DEFINES}
${WATER_HEIGHT}
uniform float uTime;
out vec3 vWorldPos;
out vec2 vUv;
out vec3 vNormal;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h = waterHeight(wp.xz, uTime);
  float hx = waterHeight(wp.xz + vec2(0.002, 0.0), uTime);
  float hz = waterHeight(wp.xz + vec2(0.0, 0.002), uTime);
  // 縁（ガラスに接するところ）ではメニスカスで少し持ち上がる
  float rr = uv.x;
  wp.y = h + 0.004 * smoothstep(0.93, 1.0, rr);
  vNormal = normalize(vec3(-(hx - h) / 0.002, 1.0, -(hz - h) / 0.002));
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SURFACE_FRAG = /* glsl */ `
${common}
${JAR_DEFINES}
uniform float uTime;
uniform vec3 uKey, uAmbient, uGlowPos, uGlowColor;
in vec3 vWorldPos;
in vec2 vUv;
in vec3 vNormal;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float cosI = abs(dot(N, V));
  // 臨界角を越えると全反射で鏡のようになる
  float tir = smoothstep(0.7, 0.5, cosI);
  // 水面に映る水の中（暗い）と、海月の光
  vec3 gd = uGlowPos - vWorldPos;
  float g = 1.0 / (dot(gd.xz, gd.xz) * 40.0 + 1.0);
  vec3 refl = uAmbient * 0.35 + uKey * 0.12 + uGlowColor * g * 0.3;
  float rip = valueNoise(vWorldPos.xz * 60.0 + vec2(uTime * 0.7, -uTime * 0.5));
  rip = pow(rip, 5.0);
  vec3 col = refl * tir * (0.35 + 0.9 * rip);
  float rim = smoothstep(0.9, 1.0, vUv.x);
  col += (uAmbient * 0.6 + uKey * 0.15 + uGlowColor * g * 0.2) * rim * 0.6;
  gl_FragColor = vec4(col, 0.08 * tir + 0.08 * rim);
}
`;

// 手前のガラス。手前以外を描いた画像を、法線に合わせてずらして読む（スクリーン空間の屈折）
const FRONT_FRAG = /* glsl */ `
${common}
${output}
${JAR_DEFINES}
${WATER_FUNCS}
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloomStrength;
uniform vec2 uResolution;
uniform float uTime;
uniform float uRefractWater, uRefractGlass, uChromatic;
uniform vec3 uKey, uKeyDir, uAmbient, uGlowPos, uGlowColor;
uniform float uRimWarm;
uniform vec3 uRimWarmColor;
uniform vec3 uWaterTint, uGlassTint;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vViewNormal;

vec3 sampleScene(vec2 uv, vec2 off, float ca) {
  vec3 c;
  c.r = texture(tScene, uv + off * (1.0 + ca)).r;
  c.g = texture(tScene, uv + off).g;
  c.b = texture(tScene, uv + off * (1.0 - ca)).b;
  return c;
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float NdV = saturate(dot(N, V));
  float e = sqrt(1.0 - NdV * NdV);
  vec3 nv = normalize(vViewNormal);
  vec2 uv = gl_FragCoord.xy / uResolution;
  float y = vWorldPos.y;
  float wl = waterHeight(vWorldPos.xz, uTime);
  float inWater = step(y, wl);
  float inBase = 1.0 - smoothstep(JAR_BOTTOM - 0.012, JAR_BOTTOM + 0.004, y);
  float lip = smoothstep(JAR_H - 0.03, JAR_H - 0.005, y);

  float k = mix(uRefractGlass, uRefractWater, inWater);
  k = mix(k, uRefractWater * 1.4, inBase);
  vec2 dir = -nv.xy * vec2(uResolution.y / uResolution.x, 1.0);
  vec2 off = dir * k * (1.0 + 1.2 * pow(e, 4.0));
  vec3 col = sampleScene(uv, off, uChromatic);

  // ガラスの壁を横から見るところ（縁の帯）
  float rr = length(vWorldPos.xz);
  float eIn = (rr - JAR_T) / rr;
  float band = smoothstep(eIn - 0.018, eIn + 0.004, e);
  vec3 edgeCol = texture(tScene, uv + off * 1.25).rgb * uGlassTint * 0.45;
  col = mix(col, edgeCol, band);
  // いちばん外の縁は光が逃げて暗い
  col *= 1.0 - 0.6 * smoothstep(0.975, 0.998, e);
  col *= mix(vec3(1.0), uWaterTint, inWater * (1.0 - band));
  col = mix(col, col * uGlassTint * 0.75, inBase * 0.7);

  // 映り込み
  float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  col += envColor(R, uAmbient, uKey, uKeyDir) * F;

  // 窓の光の細いハイライト（外側の面と内側の面で2本）
  vec3 H = normalize(uKeyDir + V);
  float sp1 = pow(saturate(dot(N, H)), 260.0);
  float c = cos(0.07), s = sin(0.07);
  vec3 N2 = vec3(N.x * c - N.z * s, N.y, N.x * s + N.z * c);
  float sp2 = pow(saturate(dot(N2, H)), 400.0);
  col += uKey * (sp1 * 0.5 + sp2 * 0.25);

  // 内側の輪郭の線
  float line = exp(-pow((e - eIn) / 0.006, 2.0));
  col += (uAmbient * 0.9 + uKey * 0.18) * line * mix(1.0, 0.45, inWater);

  // 夕方、縁に一瞬だけ乗る温度（口の縁と、輪郭の細い線と、ハイライト）
  col += uRimWarm * uRimWarmColor * (pow(e, 24.0) * 0.3 + lip * 0.45 + sp1 * 0.8 + line * 0.25);

  // 海月の光が、同じ高さのガラスの縁に回り込む
  vec3 gd = vWorldPos - uGlowPos;
  float g = exp(-gd.y * gd.y / 0.02) / (1.0 + dot(gd, gd) * 10.0);
  col += uGlowColor * g * pow(e, 4.0) * 0.08;

  // 水面がガラスに接する線（メニスカス）
  float men = exp(-pow((y - wl - 0.002) / 0.0024, 2.0));
  col += (uAmbient * 0.45 + uKey * 0.08 + uGlowColor * 0.06) * men;

  // 口の縁と底の縁の明るい線
  col += (uAmbient * 0.7 + uKey * 0.15) * lip * (0.3 + 0.7 * pow(e, 2.0));
  float baseLine = exp(-pow((y - JAR_BOTTOM) / 0.004, 2.0)) + exp(-pow((y - 0.004) / 0.004, 2.0)) * 0.6;
  col += (uAmbient * 0.5 + uKey * 0.12 + uGlowColor * g * 0.05) * baseLine;

  col += texture(tBloom, uv).rgb * uBloomStrength;
  gl_FragColor = vec4(outputTransform(col, gl_FragCoord.xy), 1.0);
}
`;

export interface Jar {
  back: Mesh;
  floor: Mesh;
  surface: Mesh;
  front: Mesh;
  frontUniforms: {
    tScene: { value: Texture | null };
    tBloom: { value: Texture | null };
    uBloomStrength: { value: number };
    uFade: { value: number };
  };
}

function premultiplied(m: ShaderMaterial): ShaderMaterial {
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  return m;
}

export function createJar(shared: SharedUniforms, rimWarmColor: readonly [number, number, number]): Jar {
  const outer = lathe(jarProfile(), JAR.radialSegments);
  const rimWarm = { value: new Vector3(...rimWarmColor) };

  const back = new Mesh(
    outer,
    premultiplied(
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: GLASS_VERT,
        fragmentShader: frag(BACK_FRAG),
        side: BackSide,
        uniforms: {
          uTime: shared.uTime,
          uKey: shared.uKey,
          uKeyDir: shared.uKeyDir,
          uAmbient: shared.uAmbient,
          uGlowPos: shared.uGlowPos,
          uGlowColor: shared.uGlowColor,
          uRimWarm: shared.uRimWarm,
          uRimWarmColor: rimWarm,
        },
      }),
    ),
  );
  back.renderOrder = 10;

  const inner = JAR.radius - JAR.glassThickness;
  const floor = new Mesh(
    disk(inner, 16, 96, JAR.bottomThickness),
    premultiplied(
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: FLOOR_VERT,
        fragmentShader: frag(FLOOR_FRAG),
        side: DoubleSide,
        uniforms: {
          uTime: shared.uTime,
          uCaustics: shared.uCaustics,
          uKey: shared.uKey,
          uKeyDir: shared.uKeyDir,
          uAmbient: shared.uAmbient,
          uGlowPos: shared.uGlowPos,
          uGlowColor: shared.uGlowColor,
        },
      }),
    ),
  );
  floor.renderOrder = 11;

  const surface = new Mesh(
    disk(inner, 20, 128, JAR.waterLevel),
    premultiplied(
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: SURFACE_VERT,
        fragmentShader: frag(SURFACE_FRAG),
        side: DoubleSide,
        uniforms: {
          uTime: shared.uTime,
          uKey: shared.uKey,
          uAmbient: shared.uAmbient,
          uGlowPos: shared.uGlowPos,
          uGlowColor: shared.uGlowColor,
        },
      }),
    ),
  );
  surface.renderOrder = 60;

  const frontUniforms = {
    tScene: { value: null as Texture | null },
    tBloom: { value: null as Texture | null },
    uBloomStrength: { value: 0 },
    uFade: { value: 1 },
  };
  const front = new Mesh(
    outer,
    new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: GLASS_VERT,
      fragmentShader: frag(FRONT_FRAG),
      side: FrontSide,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        ...frontUniforms,
        uResolution: shared.uResolution,
        uTime: shared.uTime,
        uRefractWater: { value: JAR.refractWater },
        uRefractGlass: { value: JAR.refractGlass },
        uChromatic: { value: JAR.chromatic },
        uKey: shared.uKey,
        uKeyDir: shared.uKeyDir,
        uAmbient: shared.uAmbient,
        uGlowPos: shared.uGlowPos,
        uGlowColor: shared.uGlowColor,
        uRimWarm: shared.uRimWarm,
        uRimWarmColor: rimWarm,
        uWaterTint: { value: new Vector3(...JAR.waterTint) },
        uGlassTint: { value: new Vector3(...JAR.glassTint) },
      },
    }),
  );
  front.frustumCulled = false;

  return { back, floor, surface, front, frontUniforms };
}
