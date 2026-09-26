// 瓶のシェーダ。水の入った円筒は横方向のレンズとして振る舞う。
// 背景は瓶を丸ごと通り抜けた視線（4つの面で曲がる）で、中身は手前の面だけで曲がった視線で映す。
import { CAUSTIC, JAR, JELLY_LOOK, LAMP, WATER } from '../config';
import { CAUSTIC_SWAY } from './caustic';
import { LAMP_GLSL } from './lamp';
import common from './shaders/common.glsl?raw';
import output from './shaders/output.glsl?raw';

export const JAR_DEFINES = /* glsl */ `
#define JAR_R ${JAR.radius.toFixed(5)}
#define JAR_T ${JAR.glassThickness.toFixed(5)}
#define JAR_BOTTOM ${JAR.bottomThickness.toFixed(5)}
#define JAR_H ${JAR.height.toFixed(5)}
#define WATER_Y ${JAR.waterLevel.toFixed(5)}
#define WAVE_H ${WATER.waveHeight.toFixed(5)}
#define IOR_G ${JAR.iorGlass.toFixed(4)}
#define IOR_W ${JAR.iorWater.toFixed(4)}
#define LENS_BACK ${JAR.lensBackdrop.toFixed(4)}
#define LENS_BACK_EDGE ${JAR.lensBackdropEdge.toFixed(4)}
#define LENS_FLIP ${JAR.lensFlipAt.toFixed(4)}
#define CHROMA ${JAR.chromatic.toFixed(4)}
#define SPARKLE_CELL ${JAR.sparkleCell.toFixed(5)}
#define SPARKLE_RATE ${JAR.sparkleRate.toFixed(4)}
#define RING_SWAY ${CAUSTIC.ringSway.toFixed(4)}
`;

/**
 * 海月の光が届く度合い（海月のすぐそばで 1）。離れると急に弱まり、瓶の反対側ではほぼ闇に戻る。
 * JELLY_LOOK.lightFalloff の距離で 1/4
 */
export const GLOW_FALL = /* glsl */ `
float glowFall(vec3 p, vec3 glowPos) {
  vec3 d = p - glowPos;
  float k = 1.0 + dot(d, d) / ${(JELLY_LOOK.lightFalloff ** 2).toFixed(6)};
  return 1.0 / (k * k);
}
`;

/** 水面の高さ。海月の拍動で揺れたときだけ波立つ（ag は 0〜1） */
export const WATER_HEIGHT = /* glsl */ `
float waterHeight(vec2 xz, float t, float ag) {
  float w = sin(xz.x * 23.0 + t * 1.3) * cos(xz.y * 19.0 - t * 1.05)
          + 0.6 * sin((xz.x - xz.y) * 31.0 + t * 1.9)
          + 0.4 * cos((xz.x * 0.7 + xz.y) * 43.0 - t * 2.4);
  return WATER_Y + WAVE_H * w * 0.5 * ag;
}
`;

/** 部屋の映り込みの代わり。部屋は暗く、窓（左）の方向だけが明るい */
const ENV = /* glsl */ `
vec3 envColor(vec3 R, vec3 ambient, vec3 key, vec3 keyDir) {
  float up = R.y * 0.5 + 0.5;
  vec3 base = ambient * (0.12 + 0.3 * up);
  float win = pow(saturate(dot(R, keyDir)), 14.0);
  return base + key * win * 0.7;
}
`;

/**
 * 光の粒。升目ごとに一つ置くかどうかを決め、位置・大きさ・明るさをばらつかせる。
 * q は升目単位の座標。ゆっくり瞬き、水面が揺れるとわずかに揺らぐ
 */
const SPECKS = /* glsl */ `
float specks(vec2 q, float t, float ag) {
  vec2 id = floor(q);
  vec2 f = fract(q);
  float s = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = id + vec2(float(i), float(j));
      float h = hash12(c);
      if (h > SPARKLE_RATE) continue;
      float k = h / SPARKLE_RATE;
      vec2 o = vec2(hash12(c + 17.3), hash12(c + 41.7));
      vec2 d = vec2(float(i), float(j)) + o - f;
      float r = mix(0.07, 0.17, hash12(c + 5.1));
      float tw = 0.5 + 0.5 * sin(t * (0.25 + 0.5 * k) + k * 60.0 + ag * 3.0 * sin(k * 20.0 + t * 2.0));
      s += exp(-dot(d, d) / (r * r)) * tw * tw * mix(0.3, 1.0, hash12(c + 9.9));
    }
  }
  return s;
}
`;

/**
 * 瓶底のガラスに溜まる光。窓の光（日が直接差す間）とデスクライトが、それぞれ光と反対の側に溜まる。
 * dir は瓶の軸から見た水平の向き（正規化済み）
 */
const POOL_LIGHT = /* glsl */ `
vec3 poolLight(vec3 p, vec2 dir, vec3 key, vec3 keyDir, float lensLight) {
  vec2 awaySun = -normalize(keyDir.xz + vec2(1e-5));
  float sun = 0.2 + 0.8 * smoothstep(-0.2, 0.9, dot(dir, awaySun));
  vec2 awayLamp = -normalize(lampDir(p).xz + vec2(1e-5));
  float lamp = 0.2 + 0.8 * smoothstep(-0.2, 0.9, dot(dir, awayLamp));
  return key * lensLight * sun + uLampColor * lampSpot(p) * ${LAMP.lensLight.toFixed(3)} * lamp;
}
`;

/** 水平面での円筒レンズ。b は視線と軸の距離、R は外半径、nIn は内側の屈折率 */
const LENS = /* glsl */ `
// front: 内側へ入るまでの曲がり / total: 通り抜けたあとの曲がり / sweep: 入射点から軸に一番近づく所までの角度
// 戻り値は、ガラスの内側の面で全反射して中へ入れない度合い（0〜1）。
// 空気の部分の縁だけで起きる。境目で像が急に跳ばないよう、曲がりを頭打ちにしてぼかす
float cylinderLens(float b, float R, float nIn, bool solid, out float front, out float total, out float sweep) {
  float Ri = R - JAR_T;
  float i1 = asin(min(b / R, 0.9999));
  float pg = b / IOR_G;
  float t1 = asin(min(pg / R, 0.9999));
  if (solid) {
    // 底：中まで詰まったガラス
    front = i1 - t1;
    total = 2.0 * front;
    sweep = acos(min(pg / R, 1.0));
    return 0.0;
  }
  float i2 = asin(min(pg / Ri, 0.9999));
  float sinT2 = b / (nIn * Ri);
  float s2 = min(sinT2, 0.95);
  float t2 = asin(s2);
  front = (i1 - t1) + (i2 - t2);
  total = 2.0 * front;
  sweep = acos(min(pg / R, 1.0)) - acos(min(pg / Ri, 1.0)) + acos(s2);
  return smoothstep(0.9, 1.0, sinT2);
}

vec2 rot2(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
`;

export const GLASS_VERT = /* glsl */ `
out vec3 vWorldPos;
out vec3 vWorldNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** 手前のガラス。背景と中身を、それぞれの曲がり方で読んで重ね、ガラスの光を足す */
export const FRONT_FRAG = /* glsl */ `
${common}
${output}
${JAR_DEFINES}
${WATER_HEIGHT}
${ENV}
${LENS}
${SPECKS}
${CAUSTIC_SWAY}
${GLOW_FALL}
${LAMP_GLSL}
${POOL_LIGHT}
uniform sampler2D tBg;
uniform sampler2D tRoomWide;
uniform sampler2D tContents;
uniform sampler2D tBloom;
uniform float uBloomStrength;
uniform vec2 uResolution;
uniform vec2 uCoverScale, uCoverOffset;
// 瓶の切り替えの視差で、部屋の写真が横にずれている量（写真の uv、奥の壁）
uniform float uParallax;
// 写真の外の左を窓の光にする度合い。見ている瓶は 1。すれ違って横へ離れた瓶は 0 で、写真を折り返して読む
// （離れた瓶の縁が写真の外ばかり映して、白い板のように光らないように）
uniform float uWindowSide;
uniform mat4 uViewProj;
uniform float uTime, uAgitation, uLensLight;
uniform vec3 uKey, uKeyDir, uAmbient, uGlowPos, uGlowColor;
uniform float uRimWarm;
uniform vec3 uRimWarmColor;
uniform vec3 uWaterTint, uGlassTint;
uniform float uWaterHaze, uHighlightSharp, uHighlightSoft, uSparkle, uWindowBand;
in vec3 vWorldPos;
in vec3 vWorldNormal;

/** ワールドの点を画面の uv へ。画面の外もそのまま返す */
vec2 toScreenRaw(vec3 p) {
  vec4 c = uViewProj * vec4(p, 1.0);
  return c.xy / max(c.w, 0.05) * 0.5 + 0.5;
}

vec2 toScreen(vec3 p) {
  return clamp(toScreenRaw(p), vec2(0.001), vec2(0.999));
}

/**
 * 屈折した視線の先の背景。s は画面の uv（外もありうる）。
 * 画面の中は背景の画像、画面の外は写真全体の画像を読む。
 * 写真の外は、左（窓の側）は窓の光で明るく、右は暗い部屋
 */
vec3 backdrop(vec2 s) {
  vec2 p = s * uCoverScale + uCoverOffset + vec2(uParallax, 0.0);
  vec2 q = vec2(mix(abs(p.x), p.x, uWindowSide), p.y);
  vec3 wide = texture(tRoomWide, clamp(q, vec2(0.001), vec2(0.999))).rgb;
  float left = smoothstep(0.02, 0.1, -p.x) * uWindowSide;
  float right = smoothstep(0.0, 0.2, p.x - 1.0);
  wide = mix(wide, uKey * uWindowBand + uAmbient * 0.3, left);
  wide *= 1.0 - 0.75 * right;
  vec2 e = min(s, 1.0 - s);
  float onScreen = smoothstep(0.0, 0.015, min(e.x, e.y));
  vec3 scr = textureLod(tBg, clamp(s, vec2(0.001), vec2(0.999)), 0.0).rgb;
  return mix(wide, scr, onScreen);
}

void main() {
  vec3 P = vWorldPos;
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - P);
  float NdV = saturate(dot(N, V));
  vec2 uv = gl_FragCoord.xy / uResolution;

  // 視線を水平面と上下の傾きに分ける
  vec3 d = -V;
  float hl = max(length(d.xz), 1e-4);
  vec2 dh = d.xz / hl;
  float slope = d.y / hl;
  vec2 E = P.xz;
  float R = max(length(E), 1e-3);
  float cr = E.x * dh.y - E.y * dh.x;
  float b = min(abs(cr), R * 0.9999);
  // 軸のどちら側を通るか。曲がる向き（軸へ寄る向き）と、瓶の中を回る向きを決める
  float sgn = cr >= 0.0 ? 1.0 : -1.0;
  float y = P.y;
  float wl = waterHeight(E, uTime, uAgitation);
  bool base = y <= JAR_BOTTOM;
  bool water = !base && y < wl;
  float nIn = water ? IOR_W : 1.0;

  float front;
  float total;
  float sweep;
  float tir = cylinderLens(b, R, nIn, base, front, total, sweep);

  // 背景：瓶を通り抜けた視線が、瓶の奥の仮の背景に当たる所。
  // 真ん中の視線は近くを映して拡大に、縁の視線ほど遠くまで届いて像が反転して詰まる
  float thE = atan(E.y, E.x);
  float thX = thE + sgn * 2.0 * sweep;
  vec2 X = R * vec2(cos(thX), sin(thX));
  vec2 dX = rot2(dh, sgn * total);
  float inside = base ? IOR_G : nIn;
  float yX = y + slope * length(X - E) / inside;
  float xb = max(b / R - LENS_FLIP, 0.0) / (1.0 - LENS_FLIP);
  float back = LENS_BACK + LENS_BACK_EDGE * xb * xb;
  float tb = clamp((-back - X.y) / min(dX.y, -0.05), 0.0, 6.0);
  vec3 B = vec3(X.x + dX.x * tb, yX + slope * tb, X.y + dX.y * tb);
  vec2 sB = toScreenRaw(B);
  vec2 dB = sB - uv;
  vec3 bg;
  bg.r = backdrop(uv + dB * (1.0 + CHROMA)).r;
  bg.g = backdrop(sB).g;
  bg.b = backdrop(uv + dB * (1.0 - CHROMA)).b;

  // 中身：手前の面だけで曲がった視線が、瓶の軸を通る面に当たる所
  vec4 cont = vec4(0.0);
  if (!base && tir < 1.0) {
    vec2 dIn = rot2(dh, sgn * front);
    vec2 fwd = normalize(-cameraPosition.xz);
    float sQ = -dot(E, fwd) / max(dot(dIn, fwd), 1e-3);
    vec2 Q = E + dIn * sQ;
    cont = textureLod(tContents, toScreen(vec3(Q.x, y + slope * sQ / nIn, Q.y)), 0.0);
  }

  vec3 col;
  if (water) {
    // 水の部分は空気の部分より少し暗く、密度があるように
    vec3 tint = uWaterTint;
    col = cont.rgb * mix(vec3(1.0), tint, 0.4) + bg * tint * (1.0 - cont.a);
    col += uAmbient * uWaterHaze;
  } else if (base) {
    col = bg * uGlassTint * 0.8;
  } else {
    // 空気の部分。縁ではガラスの壁の中で全反射して、中は見えず少し暗い帯になる
    col = mix(cont.rgb + bg * (1.0 - cont.a), bg * uGlassTint * 0.7, tir);
  }

  // 厚いガラス（底の縁と口の縁）はわずかに緑がかる
  float lip = smoothstep(JAR_H - 0.04, JAR_H - 0.012, y);
  col *= mix(vec3(1.0), uGlassTint, lip * 0.7);

  // 映り込み（縁ほど強い）。輪郭は線ではなく、これで浮かび上がる
  float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  vec3 Rv = reflect(-V, N);
  col = col * (1.0 - F) + envColor(Rv, uAmbient, uKey, uKeyDir) * F;

  // 窓側からの縦のハイライト。円筒なので水平面で考える。鋭い線と、ぼやけた帯
  vec2 Nh = normalize(N.xz + vec2(1e-5));
  vec2 Hh = normalize(normalize(uKeyDir.xz + vec2(1e-5)) + normalize(V.xz + vec2(1e-5)));
  float ch = saturate(dot(Nh, Hh));
  float sharp = pow(ch, 4000.0) * uHighlightSharp;
  float soft = pow(ch, 40.0) * uHighlightSoft;
  float vert = 1.0 - 0.6 * float(base);
  col += uKey * (sharp + soft) * vert;
  // 口の縁の光
  vec3 H3 = normalize(uKeyDir + V);
  col += uKey * pow(saturate(dot(N, H3)), 50.0) * lip * 0.7;
  // 夕方、縁に一瞬だけ乗る温度
  col += uRimWarm * uRimWarmColor * (lip * 0.3 + sharp * 0.6 + soft * 0.3);

  // 夜のデスクライト：左上から、口と窓側のガラスへ差す。小さなヘッドが丸い光として映り、
  // 光の当たる側のガラスの縁と口の縁が光を受ける。円錐の外は暗いまま
  float lampAt = lampSpot(P);
  vec3 Ll = lampDir(P);
  vec3 lampC = uLampColor * lampAt;
  col += lampC * pow(saturate(dot(N, normalize(Ll + V))), 900.0) * 1.4;
  float rimGlow = pow(1.0 - NdV, 2.5);
  col += lampC * (pow(1.0 - NdV, 5.0) * 0.35 + 0.002) * (0.35 + 0.65 * saturate(dot(N, Ll)));
  col += lampC * lip * 0.2;

  // 水面がガラスに接するところ（メニスカス）：細く光り、すぐ下はわずかに暗い
  float men = exp(-pow((y - wl - 0.003) / 0.0022, 2.0));
  col *= 1.0 - 0.16 * exp(-pow((y - wl + 0.006) / 0.004, 2.0));
  col += (uAmbient * 0.5 + uKey * 0.1 + uGlowColor * 0.06) * men;

  // 厚い底ガラス：窓と反対の側に光が溜まり、ところどころ粒になってきらっと光る。
  // 溜まった光は天板の弧と同じように、弱くゆっくり揺らめく
  float glow = glowFall(P, uGlowPos);
  if (base) {
    vec3 light = poolLight(P, E / R, uKey, uKeyDir, uLensLight) + uGlowColor * glow + uAmbient * 0.4;
    vec2 sw = causticSway(E.x / R * 1.5, uTime, uAgitation);
    float swayK = RING_SWAY;
    float band = exp(-pow((y - JAR_BOTTOM * 0.45 - sw.x * swayK) / 0.018, 2.0));
    col += light * band * 0.05 * mix(1.0, sw.y, swayK);
    float sp = specks(vec2(thE * R, y) / SPARKLE_CELL, uTime, uAgitation);
    col += light * sp * uSparkle;
  }

  // 光る種がいるとき：その光がガラスに回り込む。近いところだけほのかに明るく（縁ほど）、離れるほど闇に戻る
  col += uGlowColor * glow * (rimGlow * 0.45 + 0.03);

  col += texture(tBloom, uv).rgb * uBloomStrength;
  gl_FragColor = vec4(outputTransform(col, gl_FragCoord.xy), 1.0);
}
`;

/** 奥のガラス（内側から見た奥の壁）。中身の画像に描く。うっすらした映り込みと光 */
export const BACK_FRAG = /* glsl */ `
${common}
${JAR_DEFINES}
${ENV}
${GLOW_FALL}
${LAMP_GLSL}
uniform vec3 uKey, uKeyDir, uAmbient, uGlowPos, uGlowColor;
uniform float uRimWarm;
uniform vec3 uRimWarmColor;
uniform float uHighlightSoft;
in vec3 vWorldPos;
in vec3 vWorldNormal;
void main() {
  vec3 N = -normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float NdV = saturate(dot(N, V));
  float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  vec3 col = envColor(R, uAmbient, uKey, uKeyDir) * F * 0.4;
  // 奥の壁の内側にも窓の光がぼんやり映る（鋭い線は手前の窓側だけにする）
  vec2 Nh = normalize(N.xz + vec2(1e-5));
  vec2 Hh = normalize(normalize(uKeyDir.xz + vec2(1e-5)) + normalize(V.xz + vec2(1e-5)));
  float ch = saturate(dot(Nh, Hh));
  col += uKey * pow(ch, 20.0) * uHighlightSoft * 0.15;
  col += uRimWarm * uRimWarmColor * pow(1.0 - NdV, 8.0) * 0.08;
  // デスクライトの光が奥のガラスの内側にうっすら回り込む（円錐の中だけ）
  vec3 Ll = lampDir(vWorldPos);
  col += uLampColor * lampSpot(vWorldPos) * (pow(1.0 - NdV, 5.0) * 0.25 + 0.0015) * (0.35 + 0.65 * saturate(dot(N, Ll)));
  // 光る種がいるときは、その光が近いところにだけ回り込む
  col += uGlowColor * glowFall(vWorldPos, uGlowPos) * (pow(1.0 - NdV, 2.5) * 0.35 + 0.03);
  float a = 0.02 + 0.12 * F;
  // 底の面は瓶底のシェーダに任せ、ここでは側面だけ
  float wall = 1.0 - smoothstep(0.4, 0.85, abs(N.y));
  // 奥の壁の輪郭（視線がかすめる所）は出さない。手前の輪郭と二重に見えないように
  wall *= smoothstep(0.12, 0.45, NdV);
  gl_FragColor = vec4(col, a) * wall;
}
`;

export const FLOOR_VERT = /* glsl */ `
out vec3 vWorldPos;
out vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** 瓶底（水越しに上から見る）。厚い底ガラスがレンズになり、下の天板がゆがんで見え、光の粒が縁に溜まる */
export const FLOOR_FRAG = /* glsl */ `
${common}
${JAR_DEFINES}
${SPECKS}
${CAUSTIC_SWAY}
${GLOW_FALL}
${LAMP_GLSL}
${POOL_LIGHT}
uniform sampler2D tBg;
uniform mat4 uViewProj;
uniform float uTime, uAgitation, uLensLight, uSparkle;
uniform vec3 uKey, uKeyDir, uAmbient, uGlowPos, uGlowColor, uGlassTint;
in vec3 vWorldPos;
in vec2 vUv;
void main() {
  float r = vUv.x;
  // 底ガラス越しの天板。中央ほど拡大されて見える
  float k = 0.7 + 0.25 * r * r;
  vec4 c = uViewProj * vec4(vWorldPos.x * k, 0.0, vWorldPos.z * k, 1.0);
  vec2 sp = clamp(c.xy / c.w * 0.5 + 0.5, vec2(0.001), vec2(0.999));
  vec3 under = texture(tBg, sp).rgb * uGlassTint * 0.8;
  // 縁に溜まる光の輪と粒。窓やデスクライトと反対の側ほど強い
  vec2 dir = vWorldPos.xz / max(length(vWorldPos.xz), 1e-4);
  float glow = glowFall(vWorldPos, uGlowPos);
  vec3 light = poolLight(vWorldPos, dir, uKey, uKeyDir, uLensLight) + uGlowColor * glow + uAmbient * 0.4;
  float pool = 1.0;
  // 光の輪は天板の弧と同じ揺れを弱めに受ける
  vec2 sw = causticSway(dir.x * 1.5 + dir.y * 0.5, uTime, uAgitation);
  float ring = exp(-pow((r - 0.92 - sw.x * RING_SWAY * 3.0) / 0.05, 2.0)) * mix(1.0, sw.y, RING_SWAY);
  // 斜めに見下ろすので、奥行き方向を縮めて粒が丸く見えるように
  float sk = specks(vec2(vWorldPos.x, vWorldPos.z * 0.32) / SPARKLE_CELL, uTime + 17.0, uAgitation);
  sk *= smoothstep(0.55, 0.85, r);
  vec3 col = under * 0.9 + light * pool * (ring * 0.07 + sk * uSparkle * 0.6);
  // デスクライトの光が水越しに底へ落ちる。光る種がいるときは、その光も近いところだけ
  col += uLampColor * lampSpot(vWorldPos) * 0.03 + uGlowColor * glow * 0.12;
  float a = 0.9 * (1.0 - smoothstep(0.985, 1.0, r));
  gl_FragColor = vec4(col * a, a);
}
`;

export const SURFACE_VERT = /* glsl */ `
${JAR_DEFINES}
${WATER_HEIGHT}
uniform float uTime, uAgitation;
out vec3 vWorldPos;
out vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // 縁（ガラスに接するところ）ではメニスカスで少し持ち上がる
  wp.y = waterHeight(wp.xz, uTime, uAgitation) + 0.003 * smoothstep(0.93, 1.0, uv.x);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** 水面。少し見下ろす構図なので、縁が細く光る程度。夜は裏側に海月の光がうっすら映る */
export const SURFACE_FRAG = /* glsl */ `
${common}
${JAR_DEFINES}
${GLOW_FALL}
${LAMP_GLSL}
uniform vec3 uKey, uAmbient, uGlowPos, uGlowColor;
in vec3 vWorldPos;
in vec2 vUv;
void main() {
  float rim = smoothstep(0.9, 1.0, vUv.x);
  // 光る種がいるときは、水面の裏にその光がうっすら映る
  float g = glowFall(vWorldPos, uGlowPos);
  // デスクライトが差すと、水面の縁が細く光り、光の当たる所がほんのり明るい
  vec3 lampC = uLampColor * lampSpot(vWorldPos);
  vec3 col = (uAmbient * 0.5 + uKey * 0.1 + lampC * 0.25) * rim * 0.6 + uGlowColor * g * 0.08 + lampC * 0.012;
  gl_FragColor = vec4(col, 0.03 + 0.05 * rim);
}
`;
