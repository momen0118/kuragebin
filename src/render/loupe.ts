// 虫眼鏡のレンズ。レンズの所だけを、狭い画角（カメラの視野の一部）でもう一度描いた画像を、丸く重ねる。
// 縁ほど少し大きく見え（ゆがみ）、縁に色がわずかににじみ、縁のガラスに部屋の光がうっすら映る。
// 画質「低」では描き直さず、描いた画面のその所を写し取って引き伸ばす。
// 描く画像は、レンズより少し広く（ガラスの屈折で、レンズの外の所を読むことがあるので）。
import {
  CustomBlending,
  FramebufferTexture,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { LOUPE } from '../config';
import { FullscreenPass } from './fullscreen';
import common from './shaders/common.glsl?raw';
import { createTarget } from './targets';
import type { SharedUniforms } from './uniforms';

const FRAG = /* glsl */ `
${common}
uniform sampler2D tLens;
/** レンズの真ん中と半径：描く先の画素（左下が原点）と、画面の画素（左下が原点） */
uniform vec3 uDst, uLook;
/** tLens が写している所（画面の画素で、左下と大きさ） */
uniform vec2 uSrcOrigin, uSrcSize;
uniform float uZoom, uAlpha;
uniform vec3 uKey, uAmbient;
in vec2 vUv;

vec3 at(vec2 d, float k) {
  vec2 p = uLook.xy + d * k * uLook.z / uZoom;
  return texture(tLens, clamp((p - uSrcOrigin) / uSrcSize, vec2(0.001), vec2(0.999))).rgb;
}

void main() {
  vec2 d = (gl_FragCoord.xy - uDst.xy) / uDst.z;
  float r = length(d);
  if (r > 1.0) discard;
  // 縁ほど大きく見える。縁では色がわずかにずれる
  float r2 = r * r;
  float k = 1.0 - ${LOUPE.distort.toFixed(3)} * r2;
  float ch = ${LOUPE.chroma.toFixed(4)} * r2 * r2;
  vec3 col = vec3(at(d, k - ch).r, at(d, k).g, at(d, k + ch).b);
  // ガラスの縁：少し暗く、窓の側（左上）の縁に部屋の光が細く映る。面にもごく淡い映り込み
  float rim = smoothstep(0.8, 1.0, r);
  col *= 1.0 - 0.2 * rim;
  vec2 n = d / max(r, 1e-4);
  float side = saturate(dot(n, normalize(vec2(-0.6, 0.8))));
  vec3 room = uKey * 0.7 + uAmbient;
  col += room * ${LOUPE.reflection.toFixed(3)} * (pow(rim, 2.0) * (0.25 + 0.75 * side * side) + 0.05 * smoothstep(0.3, 1.0, dot(d, vec2(-0.6, 0.8))));
  // 縁は枠の下に隠れるが、念のためなめらかに
  float a = uAlpha * (1.0 - smoothstep(1.0 - 2.0 / uDst.z, 1.0, r));
  gl_FragColor = vec4(col * a, a);
}
`;

export interface LensView {
  /** レンズの真ん中（CSS px、左上が原点）と半径（CSS px）、倍率、濃さ（0〜1） */
  x: number;
  y: number;
  radius: number;
  zoom: number;
  alpha: number;
}

export class LoupeLens {
  /** 描き直す画像：部屋、背景、中身、できあがり */
  room: WebGLRenderTarget;
  bg: WebGLRenderTarget;
  content: WebGLRenderTarget;
  out: WebGLRenderTarget;
  private size = 0;
  /** 画質「低」：画面から写し取った画像 */
  private grab: FramebufferTexture | null = null;
  private readonly pass;

  constructor(shared: SharedUniforms) {
    this.room = createTarget(1, 1);
    this.bg = createTarget(1, 1);
    this.content = createTarget(1, 1);
    this.out = createTarget(1, 1);
    this.pass = new FullscreenPass(FRAG, {
      tLens: { value: null as Texture | null },
      uDst: { value: new Vector3() },
      uLook: { value: new Vector3() },
      uSrcOrigin: { value: new Vector2() },
      uSrcSize: { value: new Vector2(1, 1) },
      uZoom: { value: 1 },
      uAlpha: { value: 1 },
      uKey: shared.uKey,
      uAmbient: shared.uAmbient,
    });
    const m = this.pass.material;
    m.transparent = true;
    m.blending = CustomBlending;
    m.blendSrc = OneFactor;
    m.blendDst = OneMinusSrcAlphaFactor;
  }

  /** 描き直す画像の大きさ（一辺の画素）をそろえる */
  ensure(px: number): void {
    const n = Math.max(8, Math.round(px));
    if (n === this.size) return;
    this.size = n;
    for (const rt of [this.room, this.bg, this.content, this.out]) rt.dispose();
    this.room = createTarget(n, n);
    this.bg = createTarget(n, n);
    this.content = createTarget(n, n);
    this.out = createTarget(n, n);
  }

  /**
   * 画質「低」：今の画面の、画面の画素で左下 (x, y)・一辺 n の所を写し取る（画面からはみ出さないよう寄せる）。
   * 写し取った所の左下を返す
   */
  grabScreen(renderer: WebGLRenderer, x: number, y: number, n: number, screenW: number, screenH: number): Vector2 {
    const size = Math.max(8, Math.min(Math.round(n), screenW, screenH));
    if (!this.grab || this.grab.image.width !== size) {
      this.grab?.dispose();
      this.grab = new FramebufferTexture(size, size);
    }
    const at = new Vector2(Math.min(Math.max(Math.round(x), 0), screenW - size), Math.min(Math.max(Math.round(y), 0), screenH - size));
    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(this.grab, at);
    return at;
  }

  get grabbed(): Texture | null {
    return this.grab;
  }

  get grabSize(): number {
    return this.grab?.image.width ?? 1;
  }

  /**
   * レンズを重ねる（画面へ）。src は写っている画像、origin・size はそれが写している所（画面の画素、左下が原点）、
   * ratio は CSS px から画面の画素への倍率、height は画面の高さ（画素）
   */
  draw(renderer: WebGLRenderer, view: LensView, src: Texture, origin: Vector2, size: number, ratio: number, height: number): void {
    const look = this.pass.uniforms.uLook.value.set(view.x * ratio, height - view.y * ratio, view.radius * ratio);
    this.pass.uniforms.uDst.value.copy(look);
    this.run(renderer, view, src, origin, size, null);
  }

  /** レンズの中を1枚の画像に（あとで写真として取り出すため。今は使わない）。一辺 px の正方形、レンズの外は透明 */
  capture(renderer: WebGLRenderer, view: LensView, src: Texture, origin: Vector2, size: number, ratio: number, height: number, px: number): ImageData {
    const rt = new WebGLRenderTarget(px, px, { type: UnsignedByteType, format: RGBAFormat, depthBuffer: false });
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    this.pass.uniforms.uLook.value.set(view.x * ratio, height - view.y * ratio, view.radius * ratio);
    this.pass.uniforms.uDst.value.set(px / 2, px / 2, px / 2);
    this.run(renderer, { ...view, alpha: 1 }, src, origin, size, rt);
    const data = new Uint8ClampedArray(px * px * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, px, px, data);
    rt.dispose();
    // 読み出しは下の行から。上下を返す
    const out = new ImageData(px, px);
    for (let y = 0; y < px; y++) out.data.set(data.subarray((px - 1 - y) * px * 4, (px - y) * px * 4), y * px * 4);
    return out;
  }

  private run(renderer: WebGLRenderer, view: LensView, src: Texture, origin: Vector2, size: number, target: WebGLRenderTarget | null): void {
    const u = this.pass.uniforms;
    u.tLens.value = src;
    u.uSrcOrigin.value.copy(origin);
    u.uSrcSize.value.set(size, size);
    u.uZoom.value = view.zoom;
    u.uAlpha.value = view.alpha;
    this.pass.render(renderer, target);
  }
}
