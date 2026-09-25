// 口腕。傘の中心から垂れる4本の厚みのあるリボン。短めで傘の下に寄り添い、
// はためかずに、傘の動きに重たく遅れてついていくだけ。ふちのひだは形として持つ（動かさない）。
import {
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  GLSL3,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Vector3,
} from 'three';
import { BELL, JAR, JELLY_LOOK, ORAL_ARMS } from '../../config';
import type { Rng } from '../../sim/rng';
import type { SharedUniforms } from '../uniforms';
import { LAMP_GLSL, lampUniforms } from '../lamp';
import type { BellLook } from './bell';
import type { RootFrame } from './tentacles';
import common from '../shaders/common.glsl?raw';
import { frag } from '../shaders/glsl';

const INNER_R = JAR.radius - JAR.glassThickness;
/** 幅方向の頂点の位置（-1〜1） */
const ACROSS = [-1, -0.6, -0.25, 0, 0.25, 0.6, 1];

const VERT = /* glsl */ `
in float aU;
in float aS;
out vec3 vWorldPos;
out vec3 vNormal;
out float vU;
out float vS;
void main() {
  vWorldPos = position;
  vNormal = normal;
  vU = aU;
  vS = aS;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
${common}
${LAMP_GLSL}
uniform float uGlowPass;
uniform vec3 uKey, uKeyDir, uAmbient;
uniform vec3 uBody, uGlow, uGonad;
uniform sampler2D tRoom;
uniform vec2 uResolution;
in vec3 vWorldPos;
in vec3 vNormal;
in float vU;
in float vS;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float NdV = abs(dot(N, V));
  float fres = pow(1.0 - NdV, 2.0);
  float edge = smoothstep(0.5, 1.0, abs(vU));
  float tip = 1.0 - smoothstep(0.8, 1.0, vS);
  float root = smoothstep(0.0, 0.08, vS);
  float wrap = saturate(dot(N * sign(dot(N, V)), uKeyDir) * 0.5 + 0.5);
  float trans = pow(saturate(dot(-V, uKeyDir) * 0.5 + 0.5), 3.0);
  vec3 light = uAmbient * 0.9 + uKey * (0.2 * wrap + 0.35 * trans);
  // 夜のデスクライト（円錐の中だけ）
  vec3 Ll = lampDir(vWorldPos);
  float wrapL = saturate(dot(N * sign(dot(N, V)), Ll) * 0.5 + 0.5);
  float transL = pow(saturate(dot(-V, Ll) * 0.5 + 0.5), 3.0);
  light += uLampColor * lampSpot(vWorldPos) * (0.2 * wrapL + 0.35 * transL);
  // 厚みのある、乳白色の半透明
  vec3 tint = mix(uBody, uGonad, 0.2 + 0.3 * edge);
  float density = (0.018 + 0.1 * fres + 0.08 * edge) * tip * root;
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec3 bg = texture(tRoom, suv + N.xy * 0.008 * fres).rgb;
  float refr = fres * 0.1 * tip;
  vec3 col = tint * light * density * 1.6 + bg * refr;
  float scatter = (0.015 + 0.05 * edge + 0.025 * fres) * tip * root;
  vec3 glow = mix(uGlow, uGonad, 0.45) * scatter;
  if (uGlowPass > 0.5) {
    gl_FragColor = vec4(glow, 0.0);
    return;
  }
  // 夜はデスクライトの光がひだの縁で散る
  col += tint * uLampColor * lampSpot(vWorldPos) * scatter * ${JELLY_LOOK.lampScatter.toFixed(3)};
  gl_FragColor = vec4(col + glow, density * 0.6 + refr);
}
`;

export class OralArms {
  readonly mesh: Mesh;
  readonly count = ORAL_ARMS.count;
  readonly nodes = ORAL_ARMS.nodes;
  /** 根元の角度（傘のローカル） */
  readonly angles: Float32Array;
  private readonly x: Float32Array;
  private readonly px: Float32Array;
  private readonly seg: number;
  private readonly phase: Float32Array;
  private readonly geo: BufferGeometry;
  private initialized = false;
  private readonly radials: Vector3[] = [];

  constructor(shared: SharedUniforms, look: BellLook, rng: Rng) {
    const n = this.count;
    const m = this.nodes;
    this.angles = new Float32Array(n);
    this.phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.angles[i] = Math.PI * 0.25 + (i * Math.PI * 2) / n + rng.range(-0.08, 0.08);
      this.phase[i] = rng.range(0, Math.PI * 2);
      this.radials.push(new Vector3(1, 0, 0));
    }
    this.seg = (ORAL_ARMS.length * BELL.radius) / (m - 1);
    this.x = new Float32Array(n * m * 3);
    this.px = new Float32Array(n * m * 3);

    const w = ACROSS.length;
    const verts = n * m * w;
    const geo = new BufferGeometry();
    const position = new Float32BufferAttribute(new Float32Array(verts * 3), 3);
    const normal = new Float32BufferAttribute(new Float32Array(verts * 3), 3);
    position.setUsage(DynamicDrawUsage);
    normal.setUsage(DynamicDrawUsage);
    const au = new Float32Array(verts);
    const as = new Float32Array(verts);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        for (let k = 0; k < w; k++) {
          const v = (i * m + j) * w + k;
          au[v] = ACROSS[k]!;
          as[v] = j / (m - 1);
          if (j < m - 1 && k < w - 1) {
            const a = v;
            const b = v + w;
            idx.push(a, b, a + 1, b, b + 1, a + 1);
          }
        }
      }
    }
    geo.setAttribute('position', position);
    geo.setAttribute('normal', normal);
    geo.setAttribute('aU', new Float32BufferAttribute(au, 1));
    geo.setAttribute('aS', new Float32BufferAttribute(as, 1));
    geo.setIndex(idx);
    this.geo = geo;

    this.mesh = new Mesh(
      geo,
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VERT,
        fragmentShader: frag(FRAG),
        side: DoubleSide,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        uniforms: {
          ...lampUniforms(shared),
          uGlowPass: shared.uGlowPass,
          uKey: shared.uKey,
          uKeyDir: shared.uKeyDir,
          uAmbient: shared.uAmbient,
          tRoom: shared.tRoom,
          uResolution: shared.uResolution,
          uBody: look.uBody,
          uGlow: look.uGlow,
          uGonad: look.uGonad,
        },
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 31;
  }

  /** roots(i) は根元の位置と垂れる向き、radial(i) は根元での外向き（リボンの幅の向き） */
  step(dt: number, roots: (i: number) => RootFrame, radial: (i: number) => Vector3, jet: Vector3, jetOrigin: Vector3): void {
    const n = this.count;
    const m = this.nodes;
    const x = this.x;
    const px = this.px;
    const L = this.seg;
    const dt2 = dt * dt;
    const keep = 1 - ORAL_ARMS.drag;
    const g = -ORAL_ARMS.gravity;
    const bellR = BELL.radius;

    for (let i = 0; i < n; i++) {
      const root = roots(i);
      this.radials[i]!.copy(radial(i));
      const base = i * m * 3;
      if (!this.initialized) {
        for (let j = 0; j < m; j++) {
          const k = base + j * 3;
          x[k] = px[k] = root.pos.x + root.dir.x * L * j;
          x[k + 1] = px[k + 1] = root.pos.y + root.dir.y * L * j;
          x[k + 2] = px[k + 2] = root.pos.z + root.dir.z * L * j;
        }
      }
      x[base] = px[base] = root.pos.x;
      x[base + 1] = px[base + 1] = root.pos.y;
      x[base + 2] = px[base + 2] = root.pos.z;

      for (let j = 1; j < m; j++) {
        const k = base + j * 3;
        const ox = x[k]! - jetOrigin.x;
        const oy = x[k + 1]! - jetOrigin.y;
        const oz = x[k + 2]! - jetOrigin.z;
        const near = 1 / (1 + (ox * ox + oy * oy + oz * oz) / (bellR * bellR * 3));
        const vx = (x[k]! - px[k]!) * keep;
        const vy = (x[k + 1]! - px[k + 1]!) * keep;
        const vz = (x[k + 2]! - px[k + 2]!) * keep;
        px[k] = x[k]!;
        px[k + 1] = x[k + 1]!;
        px[k + 2] = x[k + 2]!;
        x[k] = x[k]! + vx + jet.x * near * dt2;
        x[k + 1] = x[k + 1]! + vy + (jet.y * near + g) * dt2;
        x[k + 2] = x[k + 2]! + vz + jet.z * near * dt2;
      }

      for (let iter = 0; iter < 4; iter++) {
        // 根元の2節は向きをしっかり保つ
        for (let j = 1; j <= 2; j++) {
          const k = base + j * 3;
          const s = j === 1 ? 0.6 : 0.25;
          x[k] = x[k]! + (root.pos.x + root.dir.x * L * j - x[k]!) * s;
          x[k + 1] = x[k + 1]! + (root.pos.y + root.dir.y * L * j - x[k + 1]!) * s;
          x[k + 2] = x[k + 2]! + (root.pos.z + root.dir.z * L * j - x[k + 2]!) * s;
        }
        // 曲げにくさ：前の2節の延長に寄せる
        const bs = ORAL_ARMS.bendStiffness;
        for (let j = 2; j < m; j++) {
          const a = base + (j - 2) * 3;
          const b = base + (j - 1) * 3;
          const c = base + j * 3;
          x[c] = x[c]! + (2 * x[b]! - x[a]! - x[c]!) * bs;
          x[c + 1] = x[c + 1]! + (2 * x[b + 1]! - x[a + 1]! - x[c + 1]!) * bs;
          x[c + 2] = x[c + 2]! + (2 * x[b + 2]! - x[a + 2]! - x[c + 2]!) * bs;
        }
        for (let j = 1; j < m; j++) {
          const a = base + (j - 1) * 3;
          const b = base + j * 3;
          const dx = x[b]! - x[a]!;
          const dy = x[b + 1]! - x[a + 1]!;
          const dz = x[b + 2]! - x[a + 2]!;
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (l - L) / l;
          if (j === 1) {
            x[b] = x[b]! - dx * diff;
            x[b + 1] = x[b + 1]! - dy * diff;
            x[b + 2] = x[b + 2]! - dz * diff;
          } else {
            x[a] = x[a]! + dx * diff * 0.5;
            x[a + 1] = x[a + 1]! + dy * diff * 0.5;
            x[a + 2] = x[a + 2]! + dz * diff * 0.5;
            x[b] = x[b]! - dx * diff * 0.5;
            x[b + 1] = x[b + 1]! - dy * diff * 0.5;
            x[b + 2] = x[b + 2]! - dz * diff * 0.5;
          }
        }
      }
      for (let j = 1; j < m; j++) {
        const k = base + j * 3;
        const r = Math.hypot(x[k]!, x[k + 2]!);
        const lim = INNER_R - 0.012;
        if (r > lim) {
          x[k] = (x[k]! / r) * lim;
          x[k + 2] = (x[k + 2]! / r) * lim;
        }
        const floorY = JAR.bottomThickness + 0.006;
        if (x[k + 1]! < floorY) x[k + 1] = floorY;
      }
    }
    this.initialized = true;
  }

  updateGeometry(): void {
    const n = this.count;
    const m = this.nodes;
    const w = ACROSS.length;
    const x = this.x;
    const P = (this.geo.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
    const Nn = (this.geo.getAttribute('normal') as Float32BufferAttribute).array as Float32Array;
    const T = new Vector3();
    const W = new Vector3();
    const B = new Vector3();
    const tmp = new Vector3();
    const width = ORAL_ARMS.width * BELL.radius;
    const frillAmp = ORAL_ARMS.frillAmp * BELL.radius;

    for (let i = 0; i < n; i++) {
      const base = i * m * 3;
      W.copy(this.radials[i]!);
      for (let j = 0; j < m; j++) {
        const s = j / (m - 1);
        const k = base + j * 3;
        const a = base + Math.max(j - 1, 0) * 3;
        const b = base + Math.min(j + 1, m - 1) * 3;
        T.set(x[b]! - x[a]!, x[b + 1]! - x[a + 1]!, x[b + 2]! - x[a + 2]!).normalize();
        // 幅の向きを鎖に沿って運び、少しずつねじる
        W.addScaledVector(T, -W.dot(T)).normalize();
        if (j > 0) W.applyAxisAngle(T, (ORAL_ARMS.twist / (m - 1)) * (0.7 + 0.3 * Math.sin(this.phase[i]! + s * 2)));
        B.crossVectors(T, W).normalize();
        // 付け根から少し下が一番幅広く、先へ細る
        const wid = width * (1 - 0.6 * s * s) * Math.min(1, 0.45 + s * 4);
        for (let q = 0; q < w; q++) {
          const u = ACROSS[q]!;
          // 断面は内へ丸まった樋の形。厚みがあるように見せる
          const curl = ORAL_ARMS.curl * u * u * wid;
          const frill = frillAmp * u ** 4 * (0.4 + 0.6 * s) * Math.sin(ORAL_ARMS.frillFreq * s + this.phase[i]! + u * 1.3);
          const v = ((i * m + j) * w + q) * 3;
          P[v] = x[k]! + W.x * u * wid + B.x * (curl + frill);
          P[v + 1] = x[k + 1]! + W.y * u * wid + B.y * (curl + frill);
          P[v + 2] = x[k + 2]! + W.z * u * wid + B.z * (curl + frill);
          tmp.copy(B).addScaledVector(W, -2 * ORAL_ARMS.curl * u).normalize();
          Nn[v] = tmp.x;
          Nn[v + 1] = tmp.y;
          Nn[v + 2] = tmp.z;
        }
      }
    }
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('normal').needsUpdate = true;
  }
}
