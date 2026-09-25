// 画面へ出す直前の変換。合成パスと瓶の手前のガラスで同じものを使う
uniform float uFade;

vec3 outputTransform(vec3 c, vec2 fragCoord) {
  c = softClip(c) * uFade;
  vec3 s = linearToSrgb(c);
  // 暗部の縞を消すための三角分布ディザ
  float n = hash12(fragCoord) + hash12(fragCoord + 17.31) - 1.0;
  return s + n / 255.0;
}
