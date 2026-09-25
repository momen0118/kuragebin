// 調整用の数値はすべてここに集める。
// 長さの単位は「瓶の高さ = 1」。色はリニア RGB。

export type Vec3 = readonly [number, number, number];

/** 背景写真の座標系（写真の px）。4枚とも同じ構図・同じサイズ */
export const PHOTO = {
  width: 1122,
  height: 1402,
  /** 焦点距離（写真px）。写真の画角の推定値 */
  focalPx: 1500,
  /** 目の高さ（地平線）の y。天板の左の縁の消失点から推定 */
  horizonY: 582,
  /** 瓶の接地点（底の中心）。天板の中央、壁の光の帯の前 */
  jarBaseX: 561,
  jarBaseY: 1100,
  /** 瓶の高さ（写真px、中心軸で測る） */
  jarHeightPx: 740,
  /** 天板の奥の左角。影や照り返しをこの外へはみ出させない */
  tableBackLeft: [243, 948] as const,
} as const;

export type PhotoName = 'day' | 'dusk' | 'night' | 'sakura';

/**
 * 写真ごとの位置合わせ（昼の写真が基準）。天板の奥の縁が全部の写真で揃うようにする。
 * offset は写真px（右・下が正）、scale は写真の中心まわりの倍率 [横, 縦]
 */
export const PHOTO_ALIGN: Record<PhotoName, { offset: readonly [number, number]; scale: readonly [number, number] }> = {
  day: { offset: [0, 0], scale: [1, 1] },
  dusk: { offset: [0, 1], scale: [1, 1] },
  night: { offset: [0, 20.6], scale: [1, 1.0432] },
  sakura: { offset: [0, 7.9], scale: [1, 1.009] },
};

/** 部屋（背景写真）の見せ方 */
export const ROOM = {
  /** 事前にかけるぼかしの強さ（写真px） */
  blurSigmaMid: 2.2,
  blurSigmaStrong: 6.0,
  /**
   * ぼかし量（0〜1）を写真の y で決める。壁ほど強く、瓶の接地する天板付近は弱く。
   * [y, 量] の折れ線をなめらかにつなぐ
   */
  blurCurve: [
    [0, 1.0],
    [700, 0.85],
    [940, 0.55],
    [1060, 0.12],
    [1140, 0.1],
    [1402, 0.45],
  ] as ReadonlyArray<readonly [number, number]>,
  /** 明け方に乗せる青み（掛け算） */
  dawnTint: [0.78, 0.88, 1.14] as Vec3,
  /** 写真より横長の画面で、写真の左右の端を暗くぼかして黒に溶かす幅（写真の幅に対する割合） */
  edgeFade: 0.18,
} as const;

/** 瓶の形 */
export const JAR = {
  height: 1.0,
  radius: 0.33,
  glassThickness: 0.02,
  bottomThickness: 0.07,
  bottomCornerRadius: 0.045,
  /** 肩のはじまりと終わり（高さ） */
  shoulderStart: 0.8,
  shoulderEnd: 0.885,
  neckRadius: 0.29,
  /** 口のねじ山（高さ） */
  threads: [0.918, 0.95] as readonly number[],
  threadBulge: 0.008,
  threadWidth: 0.011,
  /** 水面の高さ */
  waterLevel: 0.775,
  radialSegments: 128,
  /** 屈折率（ガラス、水） */
  iorGlass: 1.5,
  iorWater: 1.333,
  /**
   * 水の円筒レンズで背景を映すときの、背景までの仮の距離（瓶の軸から奥へ）。
   * 真ん中あたりを通る視線は近くを映して拡大に見える。
   * 軸からの距離が半径の lensFlipAt 倍を越える視線ほど遠くまで届かせ（lensBackdropEdge）、
   * 両端で像が左右反転して詰まり、縦の明るい帯と暗い帯が並ぶようにする
   */
  lensBackdrop: 0.36,
  lensBackdropEdge: 1.1,
  lensFlipAt: 0.45,
  /** 縁の視線が写真の外（左の窓の側）まで届いたときの明るさ（窓の光に掛ける） */
  windowBand: 0.9,
  /** 色ずれ。ごく弱く */
  chromatic: 0.012,
  /** 水の透過色（掛け算）と、水の中にかかるうっすらした濁り。水の部分は空気の部分より少し暗い */
  waterTint: [0.74, 0.81, 0.8] as Vec3,
  waterHaze: 0.015,
  /** ガラスの厚い部分（底の縁、口の縁）の色（掛け算）。わずかに緑がかる */
  glassTint: [0.8, 0.92, 0.86] as Vec3,
  /** 窓側の縦のハイライト：鋭い線と、ぼやけた帯 */
  highlightSharp: 0.3,
  highlightSoft: 0.055,
  /** 瓶底の光の粒：升目の大きさ（瓶の高さ単位）、粒を置く升目の割合、明るさ */
  sparkleCell: 0.012,
  sparkleRate: 0.14,
  sparkleStrength: 0.7,
} as const;

/** 天板に落ちる瓶の影と、瓶がレンズになって集める光 */
export const TABLE = {
  /**
   * 影と光の弧を落とす光の向き（光の来る方）。窓は左の画面外。
   * 天板の見える所（瓶の手前・右）に弧が落ちるよう、少し奥から差す向きにしている
   */
  lightDir: [-0.42, 0.55, -0.72] as Vec3,
  /** 水の円筒の焦点までの距離（瓶の軸から） */
  focusDistance: 0.6,
} as const;

/** 水 */
export const WATER = {
  /** マリンスノーの粒の数 */
  snowCount: 260,
  /** 粒の大きさ（画面px、手前と奥） */
  snowSizeNear: 3.6,
  snowSizeFar: 1.6,
  /** 沈む速さ（瓶の高さ/秒、手前と奥） */
  snowFallNear: 0.016,
  snowFallFar: 0.006,
  /** 泡。一度に一つだけ、ごくたまに上がる。薄く小さく */
  bubbleIntervalMin: 45,
  bubbleIntervalMax: 120,
  bubbleRiseSpeed: 0.09,
  bubbleRadius: 0.0038,
  bubbleOpacity: 0.45,
  /** 水面の揺れ（拍動で揺れたときの最大）と、揺れが収まる時間（秒） */
  waveHeight: 0.0018,
  agitationDecay: 2.2,
  /** 拍動が水面を揺らす強さ（水面に近いほど強い） */
  agitationGain: 0.5,
} as const;

/** 拍動。縮みは速く、開きはゆっくり */
export const PULSE = {
  contract: 0.3,
  relax: 1.2,
  /** 開ききってから次に縮むまでの間 */
  restMin: 0.1,
  restMax: 0.55,
  /** テンポの揺らぎ（割合） */
  jitter: 0.1,
  /** 開くときにわずかに開きすぎてから戻る量と、開く速さ（大きいほど速い） */
  overshoot: 0.08,
  relaxOmega: 3.4,
  /** 1回ごとの縮みの深さのばらつき（最小〜最大） */
  ampMin: 0.75,
  ampMax: 1.0,
} as const;

/** 傘の形（傘の半径 = 1 とした単位） */
export const BELL = {
  /** 瓶の中での傘の半径 */
  radius: 0.1,
  /** 頂点の高さ（傘のローカル） */
  apexY: 0.5,
  /**
   * 緩んだ断面の傾き = a·s + b·s⁴（s は頂点0〜縁1、ラジアン）。上は平たく、縁で下へ曲がる。
   * 縁の半径が 1 になるよう断面の長さを決める
   */
  relaxedCurve: [0.6, 1.2] as const,
  /** 縮んだときに足す曲がり（縁でのラジアン）と、その縁への寄り方 */
  contractBend: 0.9,
  bendPower: 1.4,
  /** 縮みが頂点から縁へ伝わるのにかかる時間（秒） */
  propagation: 0.14,
  /** 縁のしなり：揺れの速さ（Hz）、減衰、縮む速さに対する反り */
  flexFreq: 1.7,
  flexDamping: 0.38,
  flexGain: 0.045,
  /** 傘の厚み（頂点と縁） */
  thicknessApex: 0.34,
  thicknessMargin: 0.025,
  /** 8つの切れ込み（感覚器のある所）の深さ */
  notchDepth: 0.045,
  ringSegments: 36,
  radialSegments: 96,
} as const;

/** 泳ぎ */
export const SWIM = {
  /** 縮む速さに対する推力 */
  thrust: 0.14,
  /** 水の抵抗（1/秒） */
  drag: 3.0,
  /** 沈む力 */
  sink: 0.03,
  /** 向きを変える力と、その減衰 */
  turnGain: 1.6,
  turnDamping: 2.6,
  /** 収縮中は向きを変えやすい */
  turnPulseBoost: 2.2,
  /** 上下の傾きの限界（軸の y の最小値） */
  minAxisY: -0.25,
  /** 気まぐれに向かう方向を変える間隔（秒） */
  wanderMin: 4,
  wanderMax: 9,
  /** 上向きへのこだわり。気まぐれに傾く上限 */
  upBias: 1.0,
  wanderTilt: 0.45,
  /** 起き上がろうとする強さ */
  righting: 0.5,
  /** 避けはじめる距離（横の壁と、上下） */
  wallMargin: 0.05,
  floorMargin: 0.12,
  /** 先読み：向いている方へ進む距離と、今の速さで進む時間（秒） */
  lookAhead: 0.1,
  lookAheadTime: 0.9,
  /** 壁・底から離れる強さ。水面では向きより沈む調子で離れるので弱い */
  avoidWall: 2.2,
  avoidFloor: 2.6,
  avoidTop: 0.5,
  /** 囲いからはみ出しかけたときに押し戻すばねの強さ */
  fenceSpring: 6,
  /** 傘の中心が動ける範囲（瓶の内側からの余白） */
  sidePadding: 0.06,
  topPadding: 0.03,
  bottomPadding: 0.2,
  /** 軸まわりのゆっくりした回転（ラジアン/秒） */
  rollSpeed: 0.12,
  /**
   * 泳ぎの調子。ほとんどは漂いながらゆっくり沈み（drift）、ときどき上へ泳ぐ（cruise）。
   * 切り替えるのは、決めた高さ（泳げる範囲の割合）に着いたときか、上限の時間（秒）が来たとき
   */
  driftTargetLow: [0.0, 0.45] as const,
  cruiseTargetHigh: [0.55, 1.0] as const,
  cruiseMaxTime: 26,
  driftMaxTime: 70,
  /** 漂うときも縮みは深いまま、間をあけて、押し出す力は弱く */
  driftAmp: 0.95,
  driftRest: 1.2,
  driftTempo: 1.2,
  driftThrust: 0.6,
  /** 瓶の中のごくゆるい水の流れ（瓶の高さ/秒）。漂う感じを出す */
  current: 0.004,
} as const;

/** つついたときの反応 */
export const POKE = {
  /** この距離までは全力で、range を越えると反応しない（瓶の高さ単位） */
  fullRange: 0.18,
  range: 0.55,
  /** きゅっと縮む時間と深さ、数秒かけて緩む時間 */
  contract: 0.16,
  depth: 1.15,
  relax: 3.2,
  /** 離れる勢いと、向きを変える強さ */
  push: 0.05,
  turn: 1.2,
  /** 光が強まる量と、その余韻（秒） */
  flash: 1.4,
  flashDecay: 1.6,
  /** 続けてつついても反応しない間（秒） */
  cooldown: 0.8,
} as const;

/** 縁触手（ばね鎖）。ミズクラゲは短く細い房が縁にびっしり並ぶ */
export const TENTACLES = {
  count: 150,
  nodes: 5,
  /** 根元で外へ開く量と、下へ垂れる量（縁の接線に足す） */
  splayOut: 0.55,
  splayDown: 0.25,
  /** 長さ（傘の半径に対する倍率、直径の1/4ほど）とばらつき */
  length: 0.5,
  lengthJitter: 0.3,
  /** 水の抵抗（1ステップあたりの速度の減衰） */
  drag: 0.1,
  gravity: 0.25,
  /** 根元の向きを保つ強さ */
  rootStiffness: 0.5,
  /** 収縮時の水流の強さ */
  jet: 1.4,
  /** 線の太さ（画面px）と明るさ */
  widthPx: 0.7,
  brightness: 0.55,
  /** 水のゆるい流れで揺れる強さ */
  current: 0.03,
} as const;

/** 口腕（リボン）。短めで厚みがあり、傘の下に寄り添って垂れる。はためかない */
export const ORAL_ARMS = {
  count: 4,
  nodes: 7,
  /** 付け根：中心からの距離と高さ（傘の半径 = 1）、外への開き */
  rootRadius: 0.13,
  rootHeight: 0.13,
  splay: 0.17,
  /** 長さ・幅（傘の半径に対する倍率） */
  length: 0.95,
  width: 0.24,
  /** 重く、傘の動きに遅れてついていくだけ */
  drag: 0.16,
  gravity: 0.22,
  bendStiffness: 0.22,
  jet: 0.25,
  /** ふちのひだ（形だけで動かさない）と、断面の丸まり */
  frillAmp: 0.05,
  frillFreq: 13,
  twist: 0.6,
  curl: 0.9,
} as const;

/** 海月の色と発光 */
export const JELLY_LOOK = {
  body: [0.8, 0.88, 1.0] as Vec3,
  /** 縁の発光色 */
  glow: [0.55, 0.78, 1.0] as Vec3,
  /** 生殖腺（四つ葉） */
  gonad: [1.0, 0.72, 0.88] as Vec3,
  glowStrength: 1.0,
  /** 周りを照らす光の中心（傘のローカル）と、その強さ */
  lightCenterY: 0.15,
  lightStrength: 0.6,
} as const;

/** 光の状態の見本。keyDir は光の来る向き（窓は左の画面外） */
export interface LightLook {
  day: number;
  dusk: number;
  night: number;
  dawnTint: number;
  keyColor: Vec3;
  keyDir: Vec3;
  ambient: Vec3;
  glow: number;
  /** 瓶がレンズになって集める光（瓶底の光の粒、天板の明るい弧） */
  lensLight: number;
  shadow: number;
}

/** 実際の時刻（時）に置いた光の状態 */
export interface LightKey extends LightLook {
  hour: number;
}

export const LIGHT_LOOKS = {
  day: {
    day: 1, dusk: 0, night: 0, dawnTint: 0,
    keyColor: [1.0, 0.97, 0.92], keyDir: [-0.85, 0.5, 0.3],
    ambient: [0.26, 0.26, 0.26], glow: 0.08, lensLight: 1.0, shadow: 0.2,
  },
  dusk: {
    day: 0, dusk: 1, night: 0, dawnTint: 0,
    keyColor: [1.0, 0.5, 0.18], keyDir: [-0.9, 0.3, 0.3],
    ambient: [0.12, 0.075, 0.05], glow: 0.45, lensLight: 0.75, shadow: 0.28,
  },
  night: {
    day: 0, dusk: 0, night: 1, dawnTint: 0,
    keyColor: [0.02, 0.025, 0.04], keyDir: [-0.85, 0.5, 0.3],
    ambient: [0.012, 0.014, 0.022], glow: 1.3, lensLight: 0.0, shadow: 0.0,
  },
  dawn: {
    day: 0.5, dusk: 0, night: 0.5, dawnTint: 1,
    keyColor: [0.55, 0.68, 1.0], keyDir: [-0.9, 0.25, 0.3],
    ambient: [0.07, 0.085, 0.12], glow: 0.7, lensLight: 0.25, shadow: 0.05,
  },
} satisfies Record<string, LightLook>;

/** 日の出・日の入りを計算する場所。日本の中央付近で固定（位置情報は使わない） */
export const SUN = {
  latitude: 36.0,
  longitude: 138.0,
} as const;

/**
 * 光の移り変わり。日の出（sunrise）・日の入り（sunset）から何分ずらすかで置き、
 * 隣り合う2つをなめらかにつなぐ。切り替えは数十分かける
 */
export const LIGHT_SCHEDULE: ReadonlyArray<{ from: 'sunrise' | 'sunset'; minutes: number; look: keyof typeof LIGHT_LOOKS }> = [
  { from: 'sunrise', minutes: -75, look: 'night' },
  { from: 'sunrise', minutes: -20, look: 'dawn' },
  { from: 'sunrise', minutes: 40, look: 'day' },
  { from: 'sunset', minutes: -110, look: 'day' },
  { from: 'sunset', minutes: -50, look: 'dusk' },
  { from: 'sunset', minutes: 5, look: 'dusk' },
  { from: 'sunset', minutes: 55, look: 'night' },
];

/** 夕方、瓶の縁に一瞬だけ温度が乗る時刻（日の入りから何分前か）と、その幅（時） */
export const RIM_WARM = {
  minutesBeforeSunset: 25,
  widthHours: 0.18,
  color: [1.0, 0.55, 0.2] as Vec3,
} as const;

/** 描画全般 */
export const RENDER = {
  /** デバイスピクセル比の上限 */
  maxDpr: 2,
  /** ブルームは弱く */
  bloomStrength: 0.45,
  bloomLevels: 5,
  /** 広いにじみの強さ（1 で全段を同じだけ足す） */
  bloomScatter: 0.45,
  /** 動きの計算の刻み（Hz）と、1フレームで進める上限（秒） */
  simHz: 120,
  maxFrameDt: 0.1,
  /** 起動時に暗転から明ける時間（秒） */
  fadeInSeconds: 2.0,
  /** 余白の色 */
  clearColor: 0x000000,
  /** 海月の初期シード（フェーズ1では固定） */
  seed: 20260925,
} as const;
