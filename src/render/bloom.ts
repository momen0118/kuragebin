// 発光部分だけのブルーム。縮小しながらぼかし、拡大しながら重ねる（デュアルフィルタ）。
import { Vector2, type Texture, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { FullscreenPass } from './fullscreen';
import { createTarget } from './targets';

const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
in vec2 vUv;
void main() {
  vec2 h = uTexel * 0.5;
  vec3 s = texture(tSrc, vUv).rgb * 4.0;
  s += texture(tSrc, vUv - h).rgb;
  s += texture(tSrc, vUv + h).rgb;
  s += texture(tSrc, vUv + vec2(h.x, -h.y)).rgb;
  s += texture(tSrc, vUv - vec2(h.x, -h.y)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}
`;

const UP = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tBase;
uniform vec2 uTexel;
in vec2 vUv;
void main() {
  vec2 h = uTexel;
  vec3 s = texture(tSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  s += texture(tSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture(tSrc, vUv + vec2(0.0, h.y * 2.0)).rgb;
  s += texture(tSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture(tSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  s += texture(tSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture(tSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  s += texture(tSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  gl_FragColor = vec4(texture(tBase, vUv).rgb + s / 12.0, 1.0);
}
`;

export class Bloom {
  private down: WebGLRenderTarget[] = [];
  private up: WebGLRenderTarget[] = [];
  private readonly downPass = new FullscreenPass(DOWN, {
    tSrc: { value: null as Texture | null },
    uTexel: { value: new Vector2() },
  });
  private readonly upPass = new FullscreenPass(UP, {
    tSrc: { value: null as Texture | null },
    tBase: { value: null as Texture | null },
    uTexel: { value: new Vector2() },
  });

  constructor(private readonly levels: number) {}

  /** glowWidth/Height は入力（発光だけの画像）の大きさ */
  setSize(glowWidth: number, glowHeight: number): void {
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.down = [];
    this.up = [];
    let w = glowWidth;
    let h = glowHeight;
    for (let i = 0; i < this.levels; i++) {
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
      this.down.push(createTarget(w, h));
      this.up.push(createTarget(w, h));
    }
  }

  /** 結果のテクスチャ（入力の1/2の大きさ） */
  get texture(): Texture {
    return this.up[0]!.texture;
  }

  render(renderer: WebGLRenderer, glow: WebGLRenderTarget): void {
    const d = this.downPass.uniforms;
    let src: WebGLRenderTarget = glow;
    for (const t of this.down) {
      d.tSrc.value = src.texture;
      d.uTexel.value.set(1 / src.width, 1 / src.height);
      this.downPass.render(renderer, t);
      src = t;
    }
    const u = this.upPass.uniforms;
    const n = this.levels;
    // 一番小さい段はそのまま
    let low = this.down[n - 1]!;
    for (let i = n - 2; i >= 0; i--) {
      u.tSrc.value = low.texture;
      u.tBase.value = this.down[i]!.texture;
      u.uTexel.value.set(1 / low.width, 1 / low.height);
      this.upPass.render(renderer, this.up[i]!);
      low = this.up[i]!;
    }
  }
}
