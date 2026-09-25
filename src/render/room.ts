// 部屋（背景写真）。時刻に合わせて隣り合う2枚を重ね、上ほど強くぼかす。
// ぼかした版は読み込み時に一度だけ作る。合成結果は光が変わったときだけ作り直す。
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { PHOTO, ROOM } from '../config';
import { FullscreenPass } from './fullscreen';
import type { LightState } from './lighting';
import { coverTransform } from './camera';
import { createTarget } from './targets';
import common from './shaders/common.glsl?raw';

const PHOTO_NAMES = ['day', 'dusk', 'night'] as const;
type PhotoName = (typeof PHOTO_NAMES)[number];

interface PhotoSet {
  full: Texture;
  mid: WebGLRenderTarget;
  strong: WebGLRenderTarget;
}

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uStep;
uniform float uSigma;
in vec2 vUv;
void main() {
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = -16; i <= 16; i++) {
    float x = float(i);
    float w = exp(-x * x / (2.0 * uSigma * uSigma));
    sum += texture(tSrc, vUv + uStep * x).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, 1.0);
}
`;

const MAX_CURVE = 8;

const COMPOSITE_FRAG = /* glsl */ `
${common}
uniform sampler2D tDay, tDayMid, tDayStrong;
uniform sampler2D tDusk, tDuskMid, tDuskStrong;
uniform sampler2D tNight, tNightMid, tNightStrong;
uniform vec3 uWeights;
uniform float uDawn;
uniform vec3 uDawnTint;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;
uniform vec2 uCurve[${MAX_CURVE}];
uniform int uCurveCount;
in vec2 vUv;

float blurAmount(float py) {
  if (py <= uCurve[0].x) return uCurve[0].y;
  for (int i = 1; i < ${MAX_CURVE}; i++) {
    if (i >= uCurveCount) break;
    vec2 a = uCurve[i - 1];
    vec2 b = uCurve[i];
    if (py <= b.x) return mix(a.y, b.y, smoothstep(a.x, b.x, py));
  }
  return uCurve[uCurveCount - 1].y;
}

vec3 photo(sampler2D full, sampler2D mid, sampler2D strong, vec2 uv, float b) {
  vec3 a = texture(full, uv).rgb;
  vec3 m = texture(mid, uv).rgb;
  vec3 s = texture(strong, uv).rgb;
  return b < 0.5 ? mix(a, m, b * 2.0) : mix(m, s, b * 2.0 - 1.0);
}

void main() {
  vec2 uv = vUv * uCoverScale + uCoverOffset;
  float py = (1.0 - uv.y) * ${PHOTO.height.toFixed(1)};
  float b = blurAmount(py);
  vec3 c = vec3(0.0);
  if (uWeights.x > 0.0005) c += uWeights.x * photo(tDay, tDayMid, tDayStrong, uv, b);
  if (uWeights.y > 0.0005) c += uWeights.y * photo(tDusk, tDuskMid, tDuskStrong, uv, b);
  if (uWeights.z > 0.0005) c += uWeights.z * photo(tNight, tNightMid, tNightStrong, uv, b);
  c *= mix(vec3(1.0), uDawnTint, uDawn);
  gl_FragColor = vec4(c, 1.0);
}
`;

function loadTexture(url: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    new TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = SRGBColorSpace;
        // 縮小してぼかすときのちらつきを防ぐためミップマップを持たせる
        tex.generateMipmaps = true;
        tex.minFilter = LinearMipmapLinearFilter;
        tex.magFilter = LinearFilter;
        resolve(tex);
      },
      undefined,
      () => reject(new Error(`背景を読み込めませんでした: ${url}`)),
    );
  });
}


export class Room {
  private photos = new Map<PhotoName, PhotoSet>();
  private blurPass = new FullscreenPass(BLUR_FRAG, {
    tSrc: { value: null as Texture | null },
    uStep: { value: new Vector2() },
    uSigma: { value: 1 },
  });
  private composite = new FullscreenPass(COMPOSITE_FRAG, {
    tDay: { value: null as Texture | null },
    tDayMid: { value: null as Texture | null },
    tDayStrong: { value: null as Texture | null },
    tDusk: { value: null as Texture | null },
    tDuskMid: { value: null as Texture | null },
    tDuskStrong: { value: null as Texture | null },
    tNight: { value: null as Texture | null },
    tNightMid: { value: null as Texture | null },
    tNightStrong: { value: null as Texture | null },
    uWeights: { value: new Vector3(1, 0, 0) },
    uDawn: { value: 0 },
    uDawnTint: { value: new Vector3(...ROOM.dawnTint) },
    uCoverScale: { value: new Vector2(1, 1) },
    uCoverOffset: { value: new Vector2(0, 0) },
    // シェーダ側の配列の長さにそろえる
    uCurve: {
      value: Array.from({ length: MAX_CURVE }, (_, i) => {
        const [y, a] = ROOM.blurCurve[Math.min(i, ROOM.blurCurve.length - 1)]!;
        return new Vector2(y, a);
      }),
    },
    uCurveCount: { value: ROOM.blurCurve.length },
  });

  async load(renderer: WebGLRenderer, baseUrl: string): Promise<void> {
    const textures = await Promise.all(PHOTO_NAMES.map((n) => loadTexture(`${baseUrl}bg/bg-${n}.webp`)));
    PHOTO_NAMES.forEach((name, i) => {
      const full = textures[i]!;
      const mid = this.blurred(renderer, full, 2, ROOM.blurSigmaMid / 2);
      const strong = this.blurred(renderer, full, 4, ROOM.blurSigmaStrong / 4);
      this.photos.set(name, { full, mid, strong });
    });
    const u = this.composite.uniforms;
    const set = (name: PhotoName, a: 'tDay' | 'tDusk' | 'tNight'): void => {
      const p = this.photos.get(name)!;
      u[a].value = p.full;
      u[`${a}Mid` as 'tDayMid'].value = p.mid.texture;
      u[`${a}Strong` as 'tDayStrong'].value = p.strong.texture;
    };
    set('day', 'tDay');
    set('dusk', 'tDusk');
    set('night', 'tNight');
  }

  /** 縮小してから縦横にガウスぼかしをかけた版を作る。sigma は縮小後の画素単位 */
  private blurred(renderer: WebGLRenderer, src: Texture, down: number, sigma: number): WebGLRenderTarget {
    const w = Math.round(PHOTO.width / down);
    const h = Math.round(PHOTO.height / down);
    const a = createTarget(w, h);
    const b = createTarget(w, h);
    const u = this.blurPass.uniforms;
    u.uSigma.value = Math.max(sigma, 0.5);
    u.tSrc.value = src;
    u.uStep.value.set(1 / w, 0);
    this.blurPass.render(renderer, a);
    u.tSrc.value = a.texture;
    u.uStep.value.set(0, 1 / h);
    this.blurPass.render(renderer, b);
    a.dispose();
    return b;
  }

  render(renderer: WebGLRenderer, target: WebGLRenderTarget, light: LightState, aspect: number): void {
    const u = this.composite.uniforms;
    const cover = coverTransform(aspect);
    u.uCoverScale.value.set(cover.scale[0], cover.scale[1]);
    u.uCoverOffset.value.set(cover.offset[0], cover.offset[1]);
    u.uWeights.value.set(light.day, light.dusk, light.night);
    u.uDawn.value = light.dawnTint;
    this.composite.render(renderer, target);
  }
}
