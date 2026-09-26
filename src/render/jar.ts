// 瓶。厚いガラスの円筒で、口は開いたまま蓋はない。
// 奥のガラス・瓶底・水面は海月と同じ「中身」の画像に描き、手前のガラスが最後に
// 背景と中身をそれぞれの曲がり方で読んで重ねる（シェーダは jarShaders.ts）。
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
  Vector2,
  Vector3,
  type Texture,
} from 'three';
import { JAR } from '../config';
import {
  BACK_FRAG,
  FLOOR_FRAG,
  FLOOR_VERT,
  FRONT_FRAG,
  GLASS_VERT,
  SURFACE_FRAG,
  SURFACE_VERT,
} from './jarShaders';
import { frag } from './shaders/glsl';
import { lampUniforms } from './lamp';
import type { SharedUniforms } from './uniforms';

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

export interface Jar {
  back: Mesh;
  floor: Mesh;
  surface: Mesh;
  front: Mesh;
  frontUniforms: {
    tBg: { value: Texture | null };
    /** 写真全体（画面の外も含む）。縁の視線が画面の外を映すときに読む */
    tRoomWide: { value: Texture | null };
    /** 画面の uv → 写真の uv */
    uCoverScale: { value: Vector2 };
    uCoverOffset: { value: Vector2 };
    /** 瓶の切り替えの視差で、部屋の写真がずれている量（写真の uv） */
    uParallax: { value: number };
    uWindowSide: { value: number };
    tContents: { value: Texture | null };
    tBloom: { value: Texture | null };
    uBloomStrength: { value: number };
    uFade: { value: number };
  };
  /** 瓶底が天板を映すための背景 */
  floorBg: { value: Texture | null };
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
  const glassTint = { value: new Vector3(...JAR.glassTint) };
  const highlightSoft = { value: JAR.highlightSoft };
  const sparkle = { value: JAR.sparkleStrength };

  const back = new Mesh(
    outer,
    premultiplied(
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: GLASS_VERT,
        fragmentShader: frag(BACK_FRAG),
        side: BackSide,
        uniforms: {
          ...lampUniforms(shared),
          uKey: shared.uKey,
          uKeyDir: shared.uKeyDir,
          uAmbient: shared.uAmbient,
          uGlowPos: shared.uGlowPos,
          uGlowColor: shared.uGlowColor,
          uRimWarm: shared.uRimWarm,
          uRimWarmColor: rimWarm,
          uHighlightSoft: highlightSoft,
        },
      }),
    ),
  );
  back.renderOrder = 10;

  const inner = JAR.radius - JAR.glassThickness;
  const floorBg = { value: null as Texture | null };
  const floor = new Mesh(
    disk(inner, 16, 96, JAR.bottomThickness),
    premultiplied(
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: FLOOR_VERT,
        fragmentShader: frag(FLOOR_FRAG),
        side: DoubleSide,
        uniforms: {
          ...lampUniforms(shared),
          tBg: floorBg,
          uViewProj: shared.uViewProj,
          uTime: shared.uTime,
          uAgitation: shared.uAgitation,
          uLensLight: shared.uLensLight,
          uSparkle: sparkle,
          uKey: shared.uKey,
          uKeyDir: shared.uKeyDir,
          uAmbient: shared.uAmbient,
          uGlowPos: shared.uGlowPos,
          uGlowColor: shared.uGlowColor,
          uGlassTint: glassTint,
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
          ...lampUniforms(shared),
          uTime: shared.uTime,
          uAgitation: shared.uAgitation,
          uRipples: shared.uRipples,
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
    tBg: { value: null as Texture | null },
    tRoomWide: { value: null as Texture | null },
    uCoverScale: { value: new Vector2(1, 1) },
    uCoverOffset: { value: new Vector2(0, 0) },
    uParallax: { value: 0 },
    uWindowSide: { value: 1 },
    tContents: { value: null as Texture | null },
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
        ...lampUniforms(shared),
        uResolution: shared.uResolution,
        uViewProj: shared.uViewProj,
        uTime: shared.uTime,
        uAgitation: shared.uAgitation,
        uRipples: shared.uRipples,
        uLensLight: shared.uLensLight,
        uKey: shared.uKey,
        uKeyDir: shared.uKeyDir,
        uAmbient: shared.uAmbient,
        uGlowPos: shared.uGlowPos,
        uGlowColor: shared.uGlowColor,
        uRimWarm: shared.uRimWarm,
        uRimWarmColor: rimWarm,
        uWaterTint: { value: new Vector3(...JAR.waterTint) },
        uGlassTint: glassTint,
        uWaterHaze: { value: JAR.waterHaze },
        uHighlightSharp: { value: JAR.highlightSharp },
        uHighlightSoft: highlightSoft,
        uSparkle: sparkle,
        uWindowBand: { value: JAR.windowBand },
      },
    }),
  );
  front.frustumCulled = false;

  return { back, floor, surface, front, frontUniforms, floorBg };
}
