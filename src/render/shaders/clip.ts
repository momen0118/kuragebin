// 瓶の口を境に、描く所を分ける。カップで運ぶ海月やカップ・注ぐ水は、瓶の中（口より下）にある部分は
// 瓶の中身として（手前のガラス越しに曲がって見える）、外にある部分は背景に重ねて描く。
// uClipMode：0 は分けない、1 は瓶の中だけ描く（中身のパス）、2 は瓶の外だけ描く（背景に重ねるパス）
import { JAR } from '../../config';

export const CLIP_GLSL = /* glsl */ `
uniform float uClipMode;
bool insideJar(vec3 p) {
  return p.y < ${JAR.height.toFixed(4)} && dot(p.xz, p.xz) < ${(JAR.radius * JAR.radius).toFixed(6)};
}
void clipToJar(vec3 p) {
  if (uClipMode < 0.5) return;
  if ((uClipMode < 1.5) != insideJar(p)) discard;
}
`;
