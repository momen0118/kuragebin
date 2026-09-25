// 描画先（オフスクリーンの画像）。暗部の縞を避けるため、使えるなら半精度浮動小数にする
import {
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  UnsignedByteType,
  WebGLRenderTarget,
  type TextureDataType,
  type WebGLRenderer,
} from 'three';

let targetType: TextureDataType = HalfFloatType;

/** 端末が浮動小数の描画先に対応していなければ 8bit に落とす */
export function chooseTargetType(renderer: WebGLRenderer): void {
  const ok = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  targetType = ok ? HalfFloatType : UnsignedByteType;
}

/** mipmaps: 縮めて読むときにちらつかないよう、描くたびに縮小版も作る */
export function createTarget(w: number, h: number, mipmaps = false): WebGLRenderTarget {
  return new WebGLRenderTarget(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), {
    type: targetType,
    depthBuffer: false,
    minFilter: mipmaps ? LinearMipmapLinearFilter : LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: mipmaps,
  });
}
