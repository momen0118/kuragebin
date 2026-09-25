// GLSL3 のフラグメントシェーダは出力を自分で宣言する（three.js は宣言しない）
const FRAG_OUT = 'layout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n';

export function frag(src: string): string {
  return FRAG_OUT + src;
}
