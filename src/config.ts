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
  /** 屈折のずれ（画面の高さに対する割合）。水の中は強め、空気の部分は弱め */
  refractWater: 0.03,
  refractGlass: 0.006,
  /** 色ずれ。ごく弱く */
  chromatic: 0.012,
  /** 水の透過色（掛け算） */
  waterTint: [0.9, 0.955, 0.965] as Vec3,
  /** ガラスの厚い部分の色（掛け算） */
  glassTint: [0.82, 0.9, 0.88] as Vec3,
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
  /** 泡。一度に一つだけ、たまに上がる */
  bubbleIntervalMin: 18,
  bubbleIntervalMax: 55,
  bubbleRiseSpeed: 0.11,
  bubbleRadius: 0.0065,
  /** 水面の揺れ */
  waveHeight: 0.0022,
  /** コースティクスの模様の細かさ */
  causticScale: 16.0,
  causticSpeed: 0.55,
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
  /** 縁が中心より遅れて動く時間（秒） */
  marginLag: 0.09,
  /** 開くときにわずかに開きすぎてから戻る量 */
  overshoot: 0.06,
  /** 1回ごとの縮みの深さのばらつき（最小〜最大） */
  ampMin: 0.75,
  ampMax: 1.0,
} as const;

/** 傘の形（傘の半径 = 1 とした単位） */
export const BELL = {
  /** 瓶の中での傘の半径 */
  radius: 0.1,
  /** 緩んだ形：半径、高さ、縁までの角度（ラジアン） */
  relaxed: [1.0, 0.58, 1.74] as Vec3,
  /** 縮んだ形 */
  contracted: [0.76, 0.76, 2.08] as Vec3,
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
  thrust: 0.2,
  /** 水の抵抗（1/秒） */
  drag: 1.9,
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
  wanderTilt: 0.8,
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
   * 泳ぎの調子。上へ泳ぐ（cruise）と、弱い拍動でゆっくり沈む（drift）を行き来する。
   * それぞれの長さ（秒）と、drift のときの拍動の深さ・間
   */
  cruiseMin: 8,
  cruiseMax: 22,
  driftMin: 14,
  driftMax: 32,
  driftAmp: 0.22,
  driftRest: 2.2,
  driftTempo: 1.3,
} as const;

/** 縁触手（ばね鎖） */
export const TENTACLES = {
  count: 44,
  nodes: 11,
  /** 根元で外へ開く量と、下へ垂れる量（縁の接線に足す） */
  splayOut: 0.5,
  splayDown: 0.3,
  /** 長さ（傘の半径に対する倍率）とばらつき */
  length: 1.15,
  lengthJitter: 0.5,
  /** 水の抵抗（1ステップあたりの速度の減衰） */
  drag: 0.075,
  gravity: 0.35,
  /** 根元の向きを保つ強さ */
  rootStiffness: 0.35,
  /** 収縮時の水流の強さ */
  jet: 3.2,
  /** 線の太さ（画面px） */
  widthPx: 0.9,
  /** 水のゆるい流れで揺れる強さ */
  current: 0.06,
} as const;

/** 口腕（リボン） */
export const ORAL_ARMS = {
  count: 4,
  nodes: 13,
  /** 付け根：中心からの距離と高さ（傘の半径 = 1）、外への開き */
  rootRadius: 0.1,
  rootHeight: 0.17,
  splay: 0.22,
  /** 長さ・幅（傘の半径に対する倍率） */
  length: 1.9,
  width: 0.22,
  /** 触手より重く遅い */
  drag: 0.035,
  gravity: 0.5,
  bendStiffness: 0.08,
  jet: 1.6,
  /** ふちのひだ */
  frillAmp: 0.075,
  frillFreq: 21,
  twist: 1.4,
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

/** 時刻と光。keyDir は光の来る向き（窓は左の画面外） */
export interface LightKey {
  hour: number;
  day: number;
  dusk: number;
  night: number;
  dawnTint: number;
  keyColor: Vec3;
  keyDir: Vec3;
  ambient: Vec3;
  glow: number;
  caustics: number;
  shadow: number;
}

const DAY_KEY: Omit<LightKey, 'hour'> = {
  day: 1, dusk: 0, night: 0, dawnTint: 0,
  keyColor: [1.0, 0.97, 0.92], keyDir: [-0.85, 0.5, 0.3],
  ambient: [0.26, 0.26, 0.26], glow: 0.08, caustics: 1.0, shadow: 0.2,
};
const DUSK_KEY: Omit<LightKey, 'hour'> = {
  day: 0, dusk: 1, night: 0, dawnTint: 0,
  keyColor: [1.0, 0.5, 0.18], keyDir: [-0.9, 0.3, 0.3],
  ambient: [0.12, 0.075, 0.05], glow: 0.45, caustics: 0.75, shadow: 0.28,
};
const NIGHT_KEY: Omit<LightKey, 'hour'> = {
  day: 0, dusk: 0, night: 1, dawnTint: 0,
  keyColor: [0.02, 0.025, 0.04], keyDir: [-0.85, 0.5, 0.3],
  ambient: [0.012, 0.014, 0.022], glow: 1.3, caustics: 0.0, shadow: 0.0,
};
const DAWN_KEY: Omit<LightKey, 'hour'> = {
  day: 0.5, dusk: 0, night: 0.5, dawnTint: 1,
  keyColor: [0.55, 0.68, 1.0], keyDir: [-0.9, 0.25, 0.3],
  ambient: [0.07, 0.085, 0.12], glow: 0.7, caustics: 0.25, shadow: 0.05,
};

/** 現地時刻（時）ごとの光。隣り合う2つをなめらかにつなぐ。切り替えは数十分かける */
export const LIGHT_KEYS: readonly LightKey[] = [
  { hour: 0, ...NIGHT_KEY },
  { hour: 4.5, ...NIGHT_KEY },
  { hour: 5.25, ...DAWN_KEY },
  { hour: 6.0, ...DAY_KEY },
  { hour: 15.5, ...DAY_KEY },
  { hour: 16.5, ...DUSK_KEY },
  { hour: 17.5, ...DUSK_KEY },
  { hour: 18.5, ...NIGHT_KEY },
  { hour: 24, ...NIGHT_KEY },
];

/** 夕方、瓶の縁に一瞬だけ温度が乗る時刻と、その幅（時） */
export const RIM_WARM = {
  peakHour: 17.0,
  widthHours: 0.18,
  color: [1.0, 0.55, 0.2] as Vec3,
} as const;

/** 描画全般 */
export const RENDER = {
  /** デバイスピクセル比の上限 */
  maxDpr: 2,
  /** 写真より横長の画面では、左右を黒で埋める */
  maxAspect: PHOTO.width / PHOTO.height,
  /** ブルームは弱く */
  bloomStrength: 0.4,
  bloomLevels: 5,
  /** 動きの計算の刻み（Hz）と、1フレームで進める上限（秒） */
  simHz: 120,
  maxFrameDt: 0.1,
  /** 起動時に暗転から明ける時間（秒） */
  fadeInSeconds: 2.0,
  /** 余白の色 */
  clearColor: 0x0b0b0c,
  /** 海月の初期シード（フェーズ1では固定） */
  seed: 20260925,
} as const;
