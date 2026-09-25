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

/** 天板に落ちる瓶の影と、瓶がレンズになって集める光（光の弧） */
export const TABLE = {
  /**
   * 影と光の弧を落とす光の向き（光の来る方）。窓は左の画面外。
   * 天板の見える所（瓶の手前・右）に弧が落ちるよう、少し奥から差す向きにしている
   */
  lightDir: [-0.42, 0.55, -0.72] as Vec3,
  /** 光の弧の、瓶の軸からの距離。縁を通る光ほど手前で集まるので弧になる */
  arcFocus: 0.45,
  /** 弧の太さ（ぼかし）と、天板の木目をどれだけ明るくするか */
  arcWidth: 0.035,
  arcGain: 4.0,
  /** 瓶の縁（影の始まり）から弧までを淡くつなぐ光（弧に対する割合） */
  arcFill: 0.35,
} as const;

/**
 * 瓶が集めた光（天板の弧、瓶底の光の輪）の揺らめき。水はいつもわずかに動いているので、
 * 数秒の周期でゆっくり揺れる。海月の拍動で水面が揺れると少し強まり、また落ち着く
 */
export const CAUSTIC = {
  /** 位置の揺れ（瓶の高さ単位）と、明るさのゆらぎ（割合） */
  sway: 0.016,
  flicker: 0.14,
  /** 水面の揺れ（0〜1）が最大のとき、揺れが何倍になるか */
  agitationBoost: 2.0,
  /** 瓶底の光の輪にかける揺れの割合 */
  ringSway: 0.4,
} as const;

/** 水 */
export const WATER = {
  /**
   * マリンスノー。ほとんどはかろうじて見える細かい粒で、少し大きい粒がまれに混じる。
   * 粒は自分では光らない。昼は部屋と窓の光を、夜は海月の光を受けたぶんだけ見える
   */
  snowCount: 700,
  /** 粒の直径（瓶の高さ単位）の最小と最大、大きさの偏り（大きいほど小さい粒ばかりになる） */
  snowSizeMin: 0.0011,
  snowSizeMax: 0.0048,
  snowSizeSkew: 7,
  /** 粒ごとの明るさのばらつき（最小の割合） */
  snowBrightnessMin: 0.35,
  /** 被写界深度：瓶の軸にピントが合い、手前と奥の粒はぼける（レンズの口径、瓶の高さ単位） */
  snowAperture: 0.022,
  /** 奥の粒ほど淡く（いちばん奥での明るさの割合） */
  snowFarFade: 0.4,
  /** 昼：部屋の光と、窓の側（左）の粒だけに当たる窓の光 */
  snowAmbient: 0.4,
  snowWindow: 0.35,
  /** 夜：デスクライトの円錐の中の粒の明るさ（外は闇） */
  snowLamp: 0.5,
  /** 光る種がいるとき、その光を受けた粒の明るさ（光る種から離れると闇に消える） */
  snowGlow: 2.5,
  /** 粒が後ろを隠す割合（光を足すだけでなく、少し遮る） */
  snowOcclusion: 0.35,
  /** 沈む速さ（瓶の高さ/秒）。小さい粒ほど遅い */
  snowFallMin: 0.004,
  snowFallMax: 0.014,
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
  /** 1回ごとの縮みの深さのばらつき（最小〜最大）。1 でお椀、弱いと浅いお椀 */
  ampMin: 0.6,
  ampMax: 1.0,
  /** ときどき強く縮んで釣鐘のように深くなる。その確率と深さ */
  strongChance: 0.12,
  strongAmpMin: 1.15,
  strongAmpMax: 1.4,
} as const;

/** 傘の形（傘の半径 = 1 とした単位） */
export const BELL = {
  /** 瓶の中での傘の半径（緩みきったとき） */
  radius: 0.1,
  /** 頂点の高さ（傘のローカル） */
  apexY: 0.5,
  /**
   * 緩んだ断面の傾き = a·s + b·s⁴（s は頂点0〜縁1、ラジアン）。緩みきると平たい皿で、縁だけ少し下がる。
   * 縁の半径が 1 になるよう断面の長さを決める
   */
  relaxedCurve: [0.25, 0.5] as const,
  /**
   * 縮んだときに足す曲がり（縁でのラジアン、拍動の深さ 1 のとき）と、その縁への寄り方。
   * 深さ 1 でお椀、強い拍動（1.3 ほど）で釣鐘のように深くなる
   */
  contractBend: 1.25,
  bendPower: 1.2,
  /** 縮みが頂点から縁へ伝わるのにかかる時間（秒） */
  propagation: 0.14,
  /** 縁弁（8枚）のしなり：揺れの速さ（Hz）、減衰、縮む速さに対する反り、縁弁ごとのばらつき（割合） */
  flexFreq: 1.6,
  flexDamping: 0.34,
  flexGain: 0.05,
  flexSpread: 0.3,
  /** しなりが効きはじめる所（s）。縁に近いほど柔らかい */
  flexStart: 0.45,
  /** 隣の縁弁とのつながりの強さ（1/秒²） */
  lobeCoupling: 14,
  /** 緩んでいる間もゆっくり揺れる：縁での角度（ラジアン）と周期（秒）の範囲 */
  lobeSway: 0.22,
  lobeSwayPeriod: [3.5, 8] as const,
  /** ときどき縁弁が内側へ折れる：縁での角度、続く時間（秒）、縁弁ごとの間隔（秒） */
  foldAngle: [0.4, 0.75] as const,
  foldDuration: [1.5, 4] as const,
  foldInterval: [30, 90] as const,
  /** 傘の厚み（頂点と縁）。薄く柔らかい */
  thicknessApex: 0.18,
  thicknessMargin: 0.02,
  /** 縁弁の形：花びらの丸み（縁弁の端での半径の減り）と、切れ込み（感覚器のある所）の深さと幅 */
  lobeRound: 0.05,
  notchDepth: 0.07,
  notchWidth: 0.05,
  /** 縁のさざ波：高さ（傘の半径単位）、1周あたりの数、ひと回りする時間（秒） */
  marginRipple: 0.012,
  marginRippleCount: 24,
  marginRipplePeriod: 7,
  ringSegments: 36,
  radialSegments: 128,
} as const;

/** 泳ぎ */
export const SWIM = {
  /** 1回の縮みで押し出す強さ。縮みの深さによらない（釣鐘まで深く縮んでも進む量は同じ） */
  thrust: 0.1,
  /** 水の抵抗（1/秒） */
  drag: 4.0,
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
  righting: 0.3,
  /**
   * ときどき大きく傾く。傾き（ラジアン）、続く時間（秒）、次までの間隔（秒）。
   * 手前へ傾くことが多く、斜め上や真上から四つ葉が見える
   */
  leanTilt: [0.75, 1.3] as const,
  leanDuration: [6, 14] as const,
  leanInterval: [25, 70] as const,
  leanTowardViewer: 0.65,
  /** 大きく傾いている間の推進の割合（その場で漂うように弱く） */
  leanThrust: 0.35,
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
  /** 光る種がつつかれて光ったときの余韻（秒） */
  flashDecay: 1.6,
  /** 続けてつついても反応しない間（秒） */
  cooldown: 0.8,
} as const;

/**
 * 縁触手。ミズクラゲの縁にびっしり並ぶ、非常に細く柔らかい糸。張りはなく、
 * 重力と水の抵抗にまかせて垂れ、泳げば後ろにたなびき、止まればゆっくり落ちて垂れ下がる
 */
export const TENTACLES = {
  count: 150,
  nodes: 6,
  /** 生えはじめの向き（縁の接線に足す、最初の形だけに使う） */
  splayOut: 0.35,
  splayDown: 0.45,
  /** 長さ（傘の半径に対する倍率、直径の1/4ほど）と、1本ずつのわずかなばらつき */
  length: 0.5,
  lengthJitter: 0.2,
  /** 水の抵抗（1ステップあたりの速度の減衰）と重さ */
  drag: 0.1,
  gravity: 0.15,
  /** 収縮時に押し出す水流と、緩むときに傘の下へ吸い込む水流の強さ */
  jet: 1.1,
  inflow: 0.5,
  /** 線の太さ（画面px）と明るさ。細く淡く */
  widthPx: 0.45,
  brightness: 0.35,
  /** 水のゆるい流れで揺れる強さと、そのうち1本ずつ勝手に揺れる割合（残りは近くの触手と一緒） */
  current: 0.07,
  currentOwn: 0.3,
} as const;

/** 口腕（リボン）。短めで厚みがあり、傘の下に寄り添って垂れる。はためかない */
export const ORAL_ARMS = {
  count: 4,
  nodes: 7,
  /** 付け根：中心からの距離と高さ（傘の半径 = 1）、外への開き。傘の下面の真ん中から垂れる */
  rootRadius: 0.13,
  rootHeight: 0.28,
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
  /** 生殖腺（四つ葉） */
  gonad: [1.0, 0.72, 0.88] as Vec3,
  /**
   * 発光。ミズクラゲは光らないので 0。仕組みは残してあり、後で加える発光する種
   * （つついたときだけ縁の粒が光るオワンクラゲなど）は、色と強さを種ごとに持たせる。
   * glowStrength はいつもの光、pokeGlow はつついた瞬間だけの光
   */
  glow: [0.55, 0.78, 1.0] as Vec3,
  glowStrength: 0,
  pokeGlow: 0,
  /** 夜のデスクライトの光が、輪郭・縁の帯・放射管・生殖腺で散って見える強さ */
  lampScatter: 0.7,
  /** 光る種の光が周りを照らす中心（傘のローカル） */
  lightCenterY: 0.15,
  /** 光る種の光が瓶のガラスや底に回り込むとき、明るさが 1/4 になる距離（瓶の高さ単位） */
  lightFalloff: 0.16,
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
    ambient: [0.26, 0.26, 0.26], lensLight: 1.0, shadow: 0.3,
  },
  dusk: {
    day: 0, dusk: 1, night: 0, dawnTint: 0,
    keyColor: [1.0, 0.5, 0.18], keyDir: [-0.9, 0.3, 0.3],
    ambient: [0.12, 0.075, 0.05], lensLight: 0.75, shadow: 0.34,
  },
  night: {
    day: 0, dusk: 0, night: 1, dawnTint: 0,
    keyColor: [0.02, 0.025, 0.04], keyDir: [-0.85, 0.5, 0.3],
    ambient: [0.012, 0.014, 0.022], lensLight: 0.0, shadow: 0.0,
  },
  dawn: {
    day: 0.5, dusk: 0, night: 0.5, dawnTint: 1,
    keyColor: [0.55, 0.68, 1.0], keyDir: [-0.9, 0.25, 0.3],
    ambient: [0.07, 0.085, 0.12], lensLight: 0, shadow: 0,
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

/**
 * 窓から日が直接差す時間。瓶の影と光の弧はこの間だけ出す（日の出前・日の入り後・夜は出さない）。
 * 日の出から riseRampMinutes かけて差しはじめ、日の入りの setRampMinutes 前から消えていく
 */
export const DIRECT_SUN = {
  riseRampMinutes: 30,
  setRampMinutes: 25,
} as const;

/**
 * 夜のデスクライト。画面外、瓶の左上（窓と同じ側）にあるクランプ式のアーム型で、ライト本体は映さない。
 * ヘッドが小さく光は狭い円錐。左上から斜めに、瓶の開いた口と窓側のガラスから水中へ入り、
 * 天板には瓶を中心にやや右へずれた楕円の光だまりができる。昼・夕方は消えていて、日の入り後に点く
 */
export const LAMP = {
  /** ライトの位置と、光の円錐の軸が通る点（瓶の底の中心が原点、瓶の高さ = 1） */
  position: [-0.62, 1.85, -0.42] as Vec3,
  aim: [-0.03, 0.4, 0.0] as Vec3,
  /** 円錐の半分の角度と、縁のぼけ（度）。縁はある程度はっきり切れる */
  coneDeg: 14,
  edgeDeg: 1.6,
  /** 光の色（青みのある白。海月の透明さが映え、水が濁って見えない）と強さ。距離による弱まり（瓶の真ん中で 1） */
  color: [0.8, 0.9, 1.0] as Vec3,
  intensity: 1.0,
  falloffPower: 1.2,
  /** 天板の光だまりの明るさ（昼の写真の天板を、この明るさでライトの色に照らす） */
  poolGain: 0.75,
  /** 天板に落ちる瓶の影の濃さと、瓶がレンズになって集める光の弧の強さ */
  shadow: 0.75,
  lensLight: 0.8,
  /** 光だまりの照り返しで、ライトの外もほんのり明るくなる量 */
  bounce: 0.008,
  /** 点く時刻（日の入りから何分後）と、消える時刻（日の出の何分前） */
  onMinutesAfterSunset: 30,
  offMinutesBeforeSunrise: 60,
  /** 点く・消えるときにかける時間（秒） */
  fadeSeconds: 0.5,
} as const;

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
