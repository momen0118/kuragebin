// 部屋（背景写真）。時刻に合わせて隣り合う2枚を重ね、上ほど強くぼかす。
// 写真ごとのずれは PHOTO_ALIGN で昼の写真に合わせる。
// 写真より横長の画面では写真を高さいっぱいに置き、左右の端を暗くぼかして黒に溶かす。
// 写真の下端（天板の手前の縁と、その下の暗い帯）は見せず、天板が手前へ続いてぼけながら闇に溶けるようにする。
// ぼかした版は読み込み時に一度だけ作る。合成結果は光が変わったときだけ作り直す。
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { LAMP, PHOTO, PHOTO_ALIGN, ROOM, type PhotoName } from '../config';
import { FullscreenPass } from './fullscreen';
import type { LightState } from './lighting';
import { coverTransform, type PhotoCamera } from './camera';
import { LAMP_GLSL, lampUniforms, type LampUniforms } from './lamp';
import { createTarget } from './targets';
import common from './shaders/common.glsl?raw';

const PHOTO_NAMES: readonly PhotoName[] = ['day', 'dusk', 'night', 'sakura'];

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
${LAMP_GLSL}
#define FG_START ${ROOM.foregroundStart.toFixed(1)}
#define FG_BAND ${ROOM.foregroundBand.toFixed(1)}
#define FG_FADE ${ROOM.foregroundFade.toFixed(1)}
#define FG_DEFOCUS ${ROOM.foregroundDefocus.toFixed(1)}
uniform sampler2D tFull[4];
uniform sampler2D tMid[4];
uniform sampler2D tStrong[4];
/** 写真ごとの位置合わせ：UV のずれ (x, y) と倍率 (z, w) */
uniform vec4 uAlign[4];
uniform vec4 uWeights;
uniform float uDawn;
uniform vec3 uDawnTint;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;
uniform vec2 uCurve[${MAX_CURVE}];
uniform int uCurveCount;
uniform float uEdgeFade;
uniform int uOverlay;
uniform int uPattern;
/** 写真のカメラ（天板の上の点を求めるため） */
uniform vec3 uCamPos;
uniform float uPitch;
uniform float uTableBackZ, uTableLeftX;
/**
 * 瓶を切り替えるときの視差：写真を横にずらす量（写真の uv）。x は壁、y は手前の天板。
 * 見ている側が机に沿って横へずれたように、手前ほど大きく、奥の壁はほんの少し
 */
uniform vec2 uShift;
/** 天板に立っている瓶の横の位置（ワールド x）と数。デスクライトの光だまりは瓶ごとに落ちる */
uniform float uJarX[2];
uniform int uJarCount;
in vec2 vUv;

// 写真の uv を通る視線が天板（y = 0）に当たる点。天板の外なら w = 0
vec4 tablePoint(vec2 uv) {
  float a = (uv.x - 0.5) * ${PHOTO.width.toFixed(1)} / ${PHOTO.focalPx.toFixed(1)};
  float b = (uv.y - 0.5) * ${PHOTO.height.toFixed(1)} / ${PHOTO.focalPx.toFixed(1)};
  float cp = cos(uPitch);
  float sp = sin(uPitch);
  vec3 d = vec3(a, b * cp - sp, -b * sp - cp);
  if (d.y > -1e-4) return vec4(0.0);
  vec3 P = uCamPos + d * (-uCamPos.y / d.y);
  float on = smoothstep(uTableBackZ, uTableBackZ + 0.01, P.z) * smoothstep(uTableLeftX, uTableLeftX + 0.01, P.x);
  return vec4(P, on);
}

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

vec2 aligned(vec2 uv, vec4 al) {
  return (uv - 0.5 - al.xy) / al.zw + 0.5;
}

// 配列のサンプラーは定数の添字でしか読めないので、写真ごとに書く
vec3 photo(int i, vec2 uvRef, float b) {
  vec2 uv = clamp(aligned(uvRef, uAlign[i]), vec2(0.0005), vec2(0.9995));
  vec3 a;
  vec3 m;
  vec3 s;
  if (i == 0) { a = texture(tFull[0], uv).rgb; m = texture(tMid[0], uv).rgb; s = texture(tStrong[0], uv).rgb; }
  else if (i == 1) { a = texture(tFull[1], uv).rgb; m = texture(tMid[1], uv).rgb; s = texture(tStrong[1], uv).rgb; }
  else if (i == 2) { a = texture(tFull[2], uv).rgb; m = texture(tMid[2], uv).rgb; s = texture(tStrong[2], uv).rgb; }
  else { a = texture(tFull[3], uv).rgb; m = texture(tMid[3], uv).rgb; s = texture(tStrong[3], uv).rgb; }
  return b < 0.5 ? mix(a, m, b * 2.0) : mix(m, s, b * 2.0 - 1.0);
}

// 写真の uv の点の部屋の色：時刻の写真の重ね合わせ、明け方の青み、夜のデスクライトの光だまり。
// uv は写真を読む所（視差でずらしたあと）、geo はその画素が見ている天板の上の点を求める所（ずらす前）
vec3 roomAt(vec2 uv, vec2 geo, float b) {
  vec3 c = vec3(0.0);
  if (uWeights.x > 0.0005) c += uWeights.x * photo(0, uv, b);
  if (uWeights.y > 0.0005) c += uWeights.y * photo(1, uv, b);
  if (uWeights.z > 0.0005) c += uWeights.z * photo(2, uv, b);
  if (uWeights.w > 0.0005) c += uWeights.w * photo(3, uv, b);
  c *= mix(vec3(1.0), uDawnTint, uDawn);
  // 夜のデスクライト：天板に楕円の光だまり。昼の写真の天板（木目）を、ライトの色で照らす
  if (uLampLevel > 0.001) {
    vec4 tp = tablePoint(geo);
    if (tp.w > 0.0) {
      // ライトは瓶ごとにあり、光だまりは瓶と一緒に動く。すれ違う間は2つの光だまりが重なる
      float lit = 0.0;
      for (int i = 0; i < 2; i++) {
        if (i >= uJarCount) break;
        vec3 q = tp.xyz - vec3(uJarX[i], 0.0, 0.0);
        lit += lampSpot(q) * saturate(lampDir(q).y);
      }
      c += photo(0, uv, b) * uLampColor * min(lit, 1.5) * tp.w * ${LAMP.poolGain.toFixed(3)};
    }
  }
  // 確認用：別の写真を半透明で重ねる
  if (uOverlay >= 0) c = mix(c, photo(uOverlay, uv, b), 0.5);
  return c;
}

// 手前の天板。写真の下端（天板の手前の縁と、その下の暗い帯）の代わりに、縁より少し上から下は
// 天板のいちばん下の帯を下へ引き伸ばす（手前ほど大きく写る）。下ほど横に強くぼかし、暗くして黒に溶かす。
// t は引き伸ばしの始まりからの距離（写真px）
vec3 foreground(float x, float t, float b0, vec2 geo) {
  // 引き伸ばし：始まりでは写真そのまま、下へ行くほど帯の下端（縁の手前）へ寄って大きく写る
  float ys = FG_START + FG_BAND * (1.0 - exp(-t / FG_BAND));
  float k = saturate(t / FG_FADE);
  float b = mix(b0, 1.0, smoothstep(0.0, 0.6, k));
  // ピントの外れ：手前ほど横に大きくぼける
  float sigma = FG_DEFOCUS * k / ${PHOTO.width.toFixed(1)};
  vec2 uv = vec2(x, 1.0 - ys / ${PHOTO.height.toFixed(1)});
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float o = float(i) * 0.5;
    float w = exp(-o * o * 0.5);
    sum += roomAt(uv + vec2(o * sigma, 0.0), geo, b) * w;
    wsum += w;
  }
  // 下ほど暗く、黒に溶かす
  return sum / wsum * (1.0 - smoothstep(0.0, 1.0, k));
}

void main() {
  vec2 geo = vUv * uCoverScale + uCoverOffset;
  float py = (1.0 - geo.y) * ${PHOTO.height.toFixed(1)};
  // 視差：奥の壁はほんの少し、天板は手前ほど大きくずれる
  float near = smoothstep(${ROOM.parallaxFrom.toFixed(1)}, ${ROOM.parallaxTo.toFixed(1)}, py);
  vec2 uv = geo + vec2(mix(uShift.x, uShift.y, near), 0.0);
  // 横長の画面：写真の左右の端ほどぼかし、暗くして黒に溶かす
  float edge = 1.0;
  float extra = 0.0;
  if (uEdgeFade > 0.0) {
    float e = min(uv.x, 1.0 - uv.x);
    edge = smoothstep(0.0, uEdgeFade, e);
    extra = 1.0 - edge;
  }
  vec3 c;
  if (py > FG_START) {
    c = foreground(uv.x, py - FG_START, min(1.0, blurAmount(FG_START) + extra), geo);
  } else {
    c = roomAt(uv, geo, min(1.0, blurAmount(py) + extra));
  }
  c *= edge * edge;
  // 確認用：屈折の写り方を見るための縦縞
  if (uPattern == 1) {
    float px = uv.x * ${PHOTO.width.toFixed(1)};
    float band = mod(floor(px / 24.0), 6.0);
    vec3 cols[6] = vec3[6](vec3(0.8, 0.1, 0.1), vec3(0.9, 0.6, 0.1), vec3(0.9, 0.9, 0.9), vec3(0.1, 0.6, 0.2), vec3(0.1, 0.3, 0.9), vec3(0.05));
    c = cols[int(band)] * (0.4 + 0.6 * step(0.5, fract(py / 60.0)));
  }
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

function alignUniform(name: PhotoName): Vector4 {
  const a = PHOTO_ALIGN[name];
  // 写真px → UV（v は上向き）
  return new Vector4(a.offset[0] / PHOTO.width, -a.offset[1] / PHOTO.height, a.scale[0], a.scale[1]);
}

/** 瓶の切り替えで変わる部屋の描き方 */
export interface RoomView {
  /** 写真の横のずれ（写真の uv）：奥の壁、手前の天板 */
  shift: readonly [number, number];
  /** 天板に立っている瓶の横の位置（ワールド x） */
  jars: readonly number[];
}

export class Room {
  /** 確認用：この写真だけを出す */
  debugOnly: PhotoName | null = null;
  /** 確認用：この写真を半透明で重ねる */
  debugOverlay: PhotoName | null = null;
  /** 確認用：写真の代わりに縦縞を出す */
  debugPattern = false;
  private photos = new Map<PhotoName, PhotoSet>();
  private blurPass = new FullscreenPass(BLUR_FRAG, {
    tSrc: { value: null as Texture | null },
    uStep: { value: new Vector2() },
    uSigma: { value: 1 },
  });
  private readonly composite;

  constructor(lamp: LampUniforms, cam: PhotoCamera) {
    this.composite = new FullscreenPass(COMPOSITE_FRAG, {
      ...lampUniforms(lamp),
      uCamPos: { value: new Vector3(...cam.position) },
      uPitch: { value: cam.pitch },
      uTableBackZ: { value: cam.tableBackZ },
      uTableLeftX: { value: cam.tableLeftX },
      tFull: { value: [] as Texture[] },
      tMid: { value: [] as Texture[] },
      tStrong: { value: [] as Texture[] },
      uAlign: { value: PHOTO_NAMES.map(alignUniform) },
      uWeights: { value: new Vector4(1, 0, 0, 0) },
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
      uEdgeFade: { value: 0 },
      uOverlay: { value: -1 },
      uPattern: { value: 0 },
      uShift: { value: new Vector2(0, 0) },
      uJarX: { value: [0, 0] },
      uJarCount: { value: 1 },
    });
  }

  async load(renderer: WebGLRenderer, baseUrl: string): Promise<void> {
    const textures = await Promise.all(PHOTO_NAMES.map((n) => loadTexture(`${baseUrl}bg/bg-${n}.webp`)));
    PHOTO_NAMES.forEach((name, i) => {
      const full = textures[i]!;
      const mid = this.blurred(renderer, full, 2, ROOM.blurSigmaMid / 2);
      const strong = this.blurred(renderer, full, 4, ROOM.blurSigmaStrong / 4);
      this.photos.set(name, { full, mid, strong });
    });
    const u = this.composite.uniforms;
    u.tFull.value = PHOTO_NAMES.map((n) => this.photos.get(n)!.full);
    u.tMid.value = PHOTO_NAMES.map((n) => this.photos.get(n)!.mid.texture);
    u.tStrong.value = PHOTO_NAMES.map((n) => this.photos.get(n)!.strong.texture);
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

  /**
   * 画面に合わせて描く。aspect が null なら写真全体をそのまま描く（瓶のレンズが画面の外を映すため）。
   * view は瓶の切り替えの視差（写真の uv のずれ：壁, 手前の天板）と、天板に立っている瓶の横の位置（ワールド x、2つまで）
   */
  render(
    renderer: WebGLRenderer,
    target: WebGLRenderTarget,
    light: LightState,
    aspect: number | null,
    view: RoomView = { shift: [0, 0], jars: [0] },
  ): void {
    const u = this.composite.uniforms;
    u.uShift.value.set(view.shift[0], view.shift[1]);
    u.uJarCount.value = Math.min(view.jars.length, 2);
    u.uJarX.value[0] = view.jars[0] ?? 0;
    u.uJarX.value[1] = view.jars[1] ?? 0;
    const cover = aspect === null ? { scale: [1, 1], offset: [0, 0] } : coverTransform(aspect);
    u.uCoverScale.value.set(cover.scale[0]!, cover.scale[1]!);
    u.uCoverOffset.value.set(cover.offset[0]!, cover.offset[1]!);
    // 写真が画面より狭いとき（横長の画面）だけ端を溶かす
    u.uEdgeFade.value = cover.scale[0]! > 1.0001 ? ROOM.edgeFade : 0;
    if (this.debugOnly) {
      const i = PHOTO_NAMES.indexOf(this.debugOnly);
      u.uWeights.value.set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0, i === 3 ? 1 : 0);
      u.uDawn.value = 0;
    } else {
      u.uWeights.value.set(light.day, light.dusk, light.night, 0);
      u.uDawn.value = light.dawnTint;
    }
    u.uOverlay.value = this.debugOverlay ? PHOTO_NAMES.indexOf(this.debugOverlay) : -1;
    u.uPattern.value = this.debugPattern ? 1 : 0;
    this.composite.render(renderer, target);
  }
}
