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
  /**
   * 手前の天板。写真は天板の手前の縁（昼の写真の y で 1354〜1370）で切れ、その下は暗い帯になっている。
   * 縁を見せないよう、foregroundStart より下は天板のいちばん下の帯（foregroundBand の高さ）を下へ引き伸ばし、
   * 下ほど横に強くぼかして暗くし、黒に溶かす。カメラに近い手前はピントが合っていない見え方にする。
   * 位置と長さは昼の写真の y（写真px）。foregroundStart + foregroundBand は縁より上に収める
   */
  foregroundStart: 1310,
  foregroundBand: 28,
  /** 黒に溶けきるまでの長さと、そこでの横のぼけの幅（写真px） */
  foregroundFade: 95,
  foregroundDefocus: 60,
  /**
   * 瓶を切り替えるときの視差のかかり方。写真の y が parallaxFrom より上（奥の壁）は壁の量、
   * parallaxTo（手前の天板）に向かって天板の量へ（SWIPE.parallaxWall・parallaxTable）
   */
  parallaxFrom: 880,
  parallaxTo: 1400,
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
  /**
   * 小さな波紋（カップが水面を通るとき）。輪が広がる速さ（瓶の高さ/秒）、波長、輪の幅、
   * 消えていく時間（秒）、高さ（強さ 1 のとき、瓶の高さ単位）、水面の光り方
   */
  rippleSpeed: 0.45,
  rippleWavelength: 0.03,
  rippleWidth: 0.045,
  rippleDecay: 0.9,
  rippleHeight: 0.005,
  rippleShine: 0.35,
} as const;

/**
 * 拍動。縮みは速く、開きはゆっくり。
 * ふだんはゆるいお椀まで緩み（restLevel）、ときどきだけ平たい皿まで深く緩む（deepChance）
 */
export const PULSE = {
  contract: 0.45,
  relax: 1.2,
  /** 緩んで戻る深さ（0 が平たい皿、1 がお椀）と、皿まで深く緩む確率 */
  restLevel: 0.3,
  deepChance: 0.18,
  /**
   * 推進のなだらかさ。1 で縮んでいる間じゅうなだらかに押す（山は真ん中で丸い）、
   * 0 で縮む速さに合わせて縮みはじめに強く押す（エフィラのぎこちない泳ぎ）。1回に進む量はどちらも同じ
   */
  thrustSmooth: 1,
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
  /**
   * 傘の中心が動ける範囲（瓶の内側からの余白）。ひとりで漂って沈んでいく先は driftPadding より上
   * （ひとりのときの泳ぎ方はフェーズ1のまま）。ほかの個体がいるときは bottomPadding の所まで沈み、瓶の下のほうも使う
   */
  sidePadding: 0.06,
  topPadding: 0.03,
  bottomPadding: 0.16,
  driftPadding: 0.2,
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
  /**
   * ほかの泳ぐ個体をよける。傘の半径の和の othersMargin 倍より近づくと、離れる向きへ向きを変え（avoidOthers）、
   * 少し押し離す（othersPush、瓶の高さ/秒²）。画面の上で重ならないよう、奥行きの差は othersDepth 倍に数える
   */
  othersMargin: 1.2,
  avoidOthers: 2.0,
  othersPush: 0.06,
  othersDepth: 0.35,
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

/**
 * エフィラ（稚クラゲ）。透けた小さな星形で、8本の腕の先は二股。拍動は速くてぎこちない。
 * 育ち具合（0 で放されたばかり、1 で成体）に合わせて、腕の間が埋まって丸い傘になり、
 * 縁触手と口腕が伸び、最後に四つ葉が浮かぶ。拍動もゆったりになる。育ち具合 1 では成体の値そのもの。
 * [始まり, 終わり] は、その変化が進む育ち具合の範囲
 */
export const EPHYRA = {
  /** 放されたときの傘の半径（腕の先まで、瓶の高さ単位）。実物のおよそ2倍。成体（BELL.radius）まで指数的に育つ */
  radius: 0.016,
  /**
   * 腕の形。腕の間の切れ込みの深さ（半径に対する割合）と、腕の半幅（半径に対する割合）を根元と先で。
   * 腕は先へ少し細り、切れ込みの底は丸い
   */
  armDepth: 0.6,
  armBase: 0.16,
  armTip: 0.09,
  /** 腕の先の二股の切れ込みの深さ（半径に対する割合）と、その幅（縁弁の幅に対する割合） */
  lappet: 0.1,
  lappetWidth: 0.05,
  /** 腕の間が埋まっていく */
  fill: [0.08, 0.72] as const,
  /** 縁触手が生えそろう（腕の間から先に生える） */
  tentacles: [0.3, 0.85] as const,
  /** 口腕が伸びる。放されたときは成体の armStart の長さ */
  oralArms: [0.0, 0.9] as const,
  oralArmStart: 0.3,
  /** 四つ葉が浮かぶ */
  gonads: [0.65, 1.0] as const,
  /** 放射管の枝分かれと環状管ができる */
  canals: [0.25, 0.9] as const,
  /** 拍動と泳ぎが落ち着いていく */
  calm: [0.05, 0.8] as const,
  /** ぎこちない拍動（落ち着く前）。縮み・緩み・休みは秒 */
  pulse: {
    contract: 0.13,
    relax: 0.36,
    restMin: 0.04,
    restMax: 0.24,
    jitter: 0.3,
    ampMin: 0.75,
    ampMax: 1.15,
    strongChance: 0,
    /** ときどき間が空く（確率と長さ）、ときどきすぐにもう一度縮む（確率） */
    pauseChance: 0.14,
    pause: [0.6, 1.8] as const,
    doubleChance: 0.16,
  },
  /** 縮むと腕が大きく折れる（傘の曲がりの強さと、縁への寄り方） */
  contractBend: 1.75,
  bendPower: 2.2,
  /** 腕ごとの縮みのずれ（秒の上限）と、腕のしなりの強さ・ばらつき */
  armLag: 0.05,
  flexGain: 0.13,
  flexSpread: 0.6,
  /** 泳ぎ：推進の強さ（成体に対する割合）、転がりやすさ、起き上がる強さ（成体に対する割合）、軸まわりの回転（倍） */
  thrust: 0.6,
  tumble: 0.9,
  righting: 0.6,
  roll: 3,
  /** 実物大の比（確認用の「実物大」で、ポリプ・ストロビラ・エフィラの大きさに掛ける） */
  realScale: 0.5,
} as const;

/**
 * ポリプ。瓶底から立つ小さなラッパ形で、口のまわりの細い触手16本が冠のように開いてゆっくり揺れる。
 * 長さの単位は瓶の高さ。形の割合は体の高さ = 1
 */
export const POLYP = {
  /** 体の高さ（触手を除く）。実物のおよそ2倍。瓶底で「ふと見ると何か生えている」くらい */
  height: 0.0192,
  /** 足・茎・口の縁の半径、口盤のくぼみ、口（口丘）の半径と高さ（体の高さ = 1） */
  footRadius: 0.2,
  stalkRadius: 0.11,
  calyxRadius: 0.36,
  /** 茎が杯へ広がりはじめる高さ */
  flareStart: 0.35,
  oralDip: 0.07,
  mouthRadius: 0.14,
  mouthHeight: 0.1,
  /** 触手：本数、長さ（体の高さ = 1）、根元の開き（水平から上への角度、度）、先への反り（度） */
  tentacleCount: 16,
  tentacleLength: 1.15,
  tentacleRise: 22,
  tentacleCurl: 30,
  /** 触手の揺れ：角度（度）、周期（秒）、近くの触手と一緒に揺れる割合 */
  swayDeg: 9,
  swayPeriod: [4, 9] as const,
  swayShared: 0.6,
  /** 休んでいるとき（瓶がいっぱい）：触手の長さの割合と、揺れの遅さ（倍） */
  restLength: 0.5,
  restCurl: 40,
  restSlow: 0.4,
  /** 付いたばかりのポリプが育ちきるまで（秒、ゲーム内）と、そのときの大きさの割合 */
  growSeconds: 12 * 3600,
  budScale: 0.25,
  /** エフィラを放したあと、触手が生え直すまで（秒、ゲーム内） */
  regrowSeconds: 8 * 3600,
  /** つつかれたとき：縮む時間、体の縮み、触手の縮み、ゆっくり伸び戻る時間（秒） */
  pokeContract: 0.25,
  pokeBody: 0.3,
  pokeTentacle: 0.75,
  pokeRelax: 8,
  pokeRange: 0.35,
  /** 色（乳白色）と、触手の太さ（画面px）・明るさ */
  body: [0.92, 0.9, 0.86] as Vec3,
  tentacleWidthPx: 0.6,
  tentacleBrightness: 0.55,
  /** 輪郭の傾き（度）の最大。まっすぐには立たない */
  tiltDeg: 8,
} as const;

/**
 * ストロビラ。ポリプが縦に伸び、横の筋がだんだん深いくびれになって皿を積んだ形になる。
 * 皿の数は放すエフィラの数。触手は縮んで消え、終わりごろ上の皿がぴくぴく動いて、1枚ずつ離れて泳ぎ出す。
 * [始まり, 終わり] は、その変化が進む段階の進み（0〜1）の範囲
 */
export const STROBILA = {
  /** 伸びる（皿1枚あたりの高さ、ポリプの体の高さ = 1）。皿の縁は段の下から discRim の所 */
  stretch: [0.0, 0.45] as const,
  discHeight: 0.26,
  discRim: 0.4,
  /** くびれが深くなる（くびれの深さの最大、半径に対する割合） */
  constrict: [0.12, 0.75] as const,
  constrictDepth: 0.72,
  /** 皿の半径（放されたエフィラの半径に対する割合）と、皿の縁に腕の形が出てくる範囲・強さ */
  discRadius: 0.8,
  lobes: [0.45, 0.9] as const,
  lobeCut: 0.45,
  /** 触手が縮んで消える */
  resorb: [0.1, 0.65] as const,
  /** 終わりごろ皿がぴくぴくする（始まりと、強さ） */
  twitch: [0.82, 1.0] as const,
  twitchDrop: 0.35,
  /** エフィラが1枚ずつ離れる間隔（秒、実時間） */
  releaseInterval: 1.4,
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
  /**
   * 光の色（白の中にはっきり青を感じる程度の、青みのある白。青く色づいた水槽の照明にはしない）と強さ。
   * 海月の透明さが映え、水が濁って見えない。距離による弱まり（瓶の真ん中で 1）
   */
  color: [0.72, 0.85, 1.0] as Vec3,
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

/**
 * 時間の進め方と保存。シミュレーションは実時間（端末の時計）で進み、閉じている間の分は
 * 起動時・復帰時に固定刻みで一気に進める
 */
export const SIM = {
  /** 固定刻み（秒） */
  stepSeconds: 60,
  /** 閉じていた時間の上限（日）。それ以上離れていても、この分だけ進める */
  maxElapsedDays: 30,
  /** 一度に進める刻みの数の上限。越えるときは刻みを粗くする */
  maxSteps: 50000,
  /** 開いている間に保存する間隔（秒）。設定を変えたときと、画面を離れる直前にも保存する */
  saveIntervalSeconds: 60,
  /** 最初の瓶の数と、世界のシード（最初の状態を作るときに使う） */
  jarCount: 3,
  seed: 20260925,
} as const;

const DAY = 86400;

/**
 * 生活環。成体 →（約1日）瓶底にポリプ →（2〜3日）ストロビラ →（半日〜1日）エフィラ1〜3匹 →（5〜7日）成体。
 * ストロビラはエフィラを放すとポリプに戻り、また繰り返す。
 * 期間は秒（ゲーム内）で、[最短, 最長] の間から段階に入るたびに選ぶ
 */
export interface LifeRules {
  adultPolyp: readonly [number, number];
  polyp: readonly [number, number];
  strobila: readonly [number, number];
  ephyra: readonly [number, number];
  ephyraCount: readonly [number, number];
  maxSwimmers: number;
  maxPolyps: number;
  spotRadius: number;
  spotMaxX: number;
  spotSpacing: number;
  spotDepthWeight: number;
  spotTries: number;
}

export const LIFE: LifeRules = {
  /** 成体が瓶底にポリプを1つ付けるまで（成体1匹ごと） */
  adultPolyp: [0.8 * DAY, 1.2 * DAY],
  /** ポリプがくびれ始めるまで */
  polyp: [2 * DAY, 3 * DAY],
  /** ストロビラがエフィラを放すまで */
  strobila: [0.5 * DAY, 1 * DAY],
  /** エフィラが成体になるまで */
  ephyra: [5 * DAY, 7 * DAY],
  /** 1つのストロビラが放すエフィラの数 */
  ephyraCount: [1, 3],
  /**
   * 1瓶あたりの上限。泳ぐ個体（成体＋エフィラ。ストロビラが放す予定の数も数える）と、瓶底のポリプ（ストロビラを含む）。
   * 泳ぐ個体が上限に達すると、ポリプは休眠して進まない。空きができると再開する
   */
  maxSwimmers: 5,
  maxPolyps: 3,
  /**
   * ポリプが付く場所。瓶底の内側の半径を 1 として、軸からの距離の上限と、左右の上限（瓶の縁の近くは
   * 像が詰まって見えにくいので避ける）。ポリプどうしの間隔が spotSpacing に足りなければ spotTries 回まで選び直し、
   * 足りる所がなければいちばん離れた所にする。奥行きの差は画面では詰まって見えるので、spotDepthWeight を掛けて数える
   */
  spotRadius: 0.72,
  spotMaxX: 0.55,
  spotSpacing: 0.3,
  spotDepthWeight: 0.4,
  spotTries: 12,
};

/**
 * 観察日誌。記録は消さずに全部残す。見ている瓶で起きた出来事は書かない（開いていても、表示していない瓶の出来事は書く）。
 * 1日1ページで、日は餌と同じく朝 FEED.dayStartHour 時で区切る（夜が途中で切れない）。
 * 時間帯は明け方・昼・夕方・夜の四つ。明け方は日の出の dawnBefore 分前から dawnAfter 分後まで、
 * 夕方は日の入りの duskBefore 分前から duskAfter 分後まで（デスクライトが点くころ）
 */
export const JOURNAL = {
  dawnBefore: 60,
  dawnAfter: 90,
  duskBefore: 60,
  duskAfter: 30,
} as const;

/**
 * 餌（ブラインシュリンプ）。1瓶につき1日1回。日は端末の現地時刻の朝 dayStartHour 時で区切る
 * （夜ふかしで0時をまたいでも同じ日）。瓶にいる全員（成体・エフィラ・ポリプ）が食べる。ストロビラは触手を縮めているので食べない。
 * 誰がどれだけ食べるかは餌をやった瞬間に決める（閉じても、ほかの瓶を見ていても同じ結果）。
 * 食べてから boostSeconds の間、エフィラ（成体になるまで）とポリプ（くびれ始めるまで）の進みが 1 + growthBoost × 食べた量 倍になる。
 * 毎日やると最大2割ほど早まる。やらなくても止まらない
 */
export const FEED = {
  dayStartHour: 4,
  /** 1回に食べる量（1 で満腹）の範囲 */
  amount: [0.7, 1.0] as const,
  growthBoost: 0.2,
  boostSeconds: DAY,
} as const;

/**
 * 瓶を揺らしたときの、エフィラの育ちの早まり。一度揺らすと seconds の間「水が動いた」状態になり、その間だけ
 * エフィラ（成体になるまで）の進みが 1 + boost 倍。何度揺らしても量は増えず、揺らした時から数えなおすだけ（重ならない）。
 * 揺らせば育つ、が強いと眺めるためでなく育てるために振るようになるので、小さく抑える
 */
export const STIR = {
  boost: 0.05,
  seconds: 3 * 3600,
} as const;

/**
 * 個体差と変異。どれも眺めているうちに気づく程度に控えめに。今までの見た目が「基準」（遺伝子がすべて 0、四つ葉）で、
 * 最初の1匹と、これまでにいた個体は基準のまま。新しく生まれる個体は親の値を少しずらして受け継ぐ（ポリプは成体から、エフィラはストロビラから）。
 * 何世代か経つと、瓶ごとに色味が偏っていく（同じ親から増えるので）。値は見た目だけに使い、数字としては見せない
 */
export const GENES = {
  /**
   * 1世代で受け継ぐときのずれ（標準偏差）。色味・透け具合・触手の長さ・拍動の速さ・縁の発光色は -1〜1、崩しは 0〜1。
   * pull は基準（崩しは typical）へ少し戻す割合（端に張りつかないように）
   */
  drift: { hue: 0.14, clarity: 0.1, tentacle: 0.1, tempo: 0.08, glow: 0.1, flaw: 0.07 },
  pull: 0.06,
  /** 崩し（いびつさ・欠けとむら・四つ葉の不揃い）は、世代を重ねるとこのくらいに落ち着く */
  typicalFlaw: 0.3,
  /** 三つ葉・五つ葉が生まれる割合（エフィラごと。受け継がない）。合わせて10匹に1匹くらい */
  threeLeaves: 0.05,
  fiveLeaves: 0.05,
} as const;

/** 個体差の見え方。遺伝子が ±1（崩しは 1）のとき */
export const GENE_LOOK = {
  /** 傘と四つ葉の色：-1 でうす青、+1 でうす桃（0 が JELLY_LOOK のまま） */
  bodyBlue: [0.62, 0.82, 1.0] as Vec3,
  bodyPink: [1.0, 0.8, 0.9] as Vec3,
  gonadBlue: [0.74, 0.72, 1.0] as Vec3,
  gonadPink: [1.0, 0.55, 0.74] as Vec3,
  /** 透け具合：濃さの倍率の幅（+1 でよく透ける） */
  clarity: 0.28,
  /** 触手の長さと拍動の速さの倍率の幅 */
  tentacle: 0.3,
  tempo: 0.15,
  /** 輪郭のいびつさ：縁弁ごとの大きさのばらつき */
  warp: 0.1,
  /** 縁の欠け：数と深さ。房のむら：触手が抜けて見える割合 */
  nicks: 3,
  nickDepth: 0.14,
  tentacleGaps: 0.6,
  /** 四つ葉の不揃い：向き（ラジアン）・中心からの距離・大きさのばらつき */
  leafAngle: 0.3,
  leafOffset: 0.14,
  leafSize: 0.3,
} as const;

/**
 * おじさん（最初のミズクラゲをくれた研究者）。海月は逃がさない（海にも放さない）。育ったら、頼まれて送る。
 * 返事は送るたびに必ずではなく、数日後にたまに届く。珍しい子（三つ葉・五つ葉、色味の偏った子）を送ったときほど届きやすい。
 * 返事どうしは最短でも minGap あける。時間は秒（ゲーム内）
 */
export const UNCLE = {
  /** 返事が届く確率：base + rare × 珍しさ（0〜1） */
  replyBase: 0.25,
  replyRare: 0.65,
  /** 送ってから返事が届くまで（範囲）と、返事どうしの最短の間 */
  replyDelay: [2 * DAY, 5 * DAY] as const,
  minGap: 4 * DAY,
  /** 色味がこれより偏っていたら珍しい（うす桃・うす青の子として返事に書く） */
  rareHue: 0.45,
  /** 崩しがこれより大きい子も少し珍しい */
  rareFlaw: 0.55,
  /** 手紙の署名（頭文字一文字。仮） */
  signature: 'K',
  /** 封筒を置く所（瓶の座標の x と z、天板の上。瓶の手前の左寄り） */
  envelope: [-0.2, 0.5] as const,
} as const;

/**
 * おじさんへ送るときの箱。発泡スチロールの箱（中に水を張った袋が入っている）が、瓶の手前、天板の手前の縁に置いてある。
 * カップを運んでいる間は、天板の手前に「おじさんに送る」と下向きの印が出て、指をそこ（画面の下のほう）まで運ぶと箱がせり上がる。
 * カップごと箱の中の水へ下ろして放す（海月は空気に触れない）。空のカップが上がってきたら、蓋をして下がって消える。
 * 大きさ・位置は瓶の高さ単位（瓶の真下が原点、+z が手前）、時間は秒
 */
export const BOX = {
  /** 外の大きさ（横・奥行き・高さ）と壁の厚み。内側はカップ（注ぎ口まで）がちょうど入る大きさ */
  width: 0.35,
  depth: 0.33,
  height: 0.28,
  wall: 0.024,
  /** 置いてある所（奥行き）。手前の縁が画面の下端の外へ出る */
  z: 0.66,
  /** 隠れているときの高さのずれ（せり上がると 0） */
  hiddenDrop: 0.3,
  /** 指がこの高さ（画面の下から、画面の高さに対する割合）より下にあると、箱へ運んでいる */
  zone: 0.22,
  /** 出る・引っこむ速さ（秒） */
  showSeconds: 0.5,
  /** 発泡スチロールの色（リニア）と、粒の見え方 */
  color: [0.86, 0.86, 0.83] as Vec3,
  beads: 0.05,
  /** カップを箱の上へ運ぶ・下ろす・待つ（放す）・上げて消える・蓋をする・下がる時間 */
  toSeconds: 1.3,
  lowerSeconds: 1.8,
  waitSeconds: 1.4,
  leaveSeconds: 1.6,
  lidSeconds: 0.9,
  awaySeconds: 1.1,
  /** 箱の上で待つときの、カップの底と箱の縁の間 */
  hoverClear: 0.06,
  /** 箱の中の袋の水面（箱の高さに対する割合）。底まで下ろしたカップがすっかり浸かる高さ */
  waterLevel: 0.9,
} as const;

/**
 * 虫眼鏡。瓶の横（手前）の天板に置いてあり、ドラッグして瓶のガラスの上へ持っていくと、レンズの中が拡大して見える。
 * 指を離してもその場に残り、天板（画面の下のほう）へドラッグして離すと元の所へ戻る。札の「よく見る」で、その個体の上へ動いて
 * しばらくついていく。レンズの中は、狭い画角のカメラで描き直す（引き伸ばさない。画質「低」だけ画面を引き伸ばす）。
 * 大きさ・位置は CSS px、置く所は瓶の座標、時間は秒
 */
export const LOUPE = {
  /** レンズの半径と、枠の太さ、柄の長さと太さ（CSS px） */
  radius: 70,
  frame: 6,
  handle: 74,
  handleWidth: 15,
  /** 枠と柄の厚み（CSS px）。天板に寝かせたとき、横の面が見える */
  thickness: 9,
  handleThickness: 11,
  /** 拡大の倍率（初期）と、デバッグで変えられる範囲 */
  zoom: 2.5,
  zoomRange: [1.5, 4] as const,
  /** 描く範囲の余白（縁のゆがみとガラスの屈折のぶん、レンズより広く描く） */
  margin: 1.35,
  /** 縁のゆがみ（縁ほど大きく見える）と、縁の色のにじみ */
  distort: 0.16,
  chroma: 0.012,
  /** 縁に映る部屋の光の強さ */
  reflection: 0.22,
  /** 描く画像の、デバイスピクセル比の上限 */
  maxDpr: 2,
  /** 天板に置いてある所（瓶の座標の x と z）と、寝かせて置いたときの大きさの倍率 */
  rest: [0.15, 0.5] as const,
  restScale: 0.42,
  /** 持ち上げる・置く（起こす・寝かせる）時間と、戻すときに天板の上を動く時間 */
  liftSeconds: 0.3,
  returnSeconds: 0.55,
  /** 「よく見る」：個体の上へ動いてついていく時間と、ついていく速さ（1/秒） */
  followSeconds: 25,
  followRate: 4,
  /** レンズの真ん中がこの高さ（画面の高さに対する割合）より下で離すと、天板の元の所へ戻す */
  tableY: 0.87,
} as const;

/**
 * 拾いもの（4-2）。貝殻のかけら・シーグラス・小石が、見ていない間にまれに瓶底に現れる（入れ替えた水に混じっていたもの）。
 * タップで拾うと日誌の標本に移り、標本から瓶へ戻して飾れる。1瓶に合わせて maxPerJar まで、そのうち自分で置いた物は maxPlaced まで
 * （自分で置いた物がある瓶では、勝手に現れる物はその分少なくなる）。日誌には書かない
 */
export const FINDS = {
  /** 1瓶あたり平均この日数に1つ現れる（見ていない間だけ。水換えとは関係なく、日数で決める） */
  meanDays: 7,
  maxPerJar: 3,
  maxPlaced: 1,
  /** 種類の出やすさ（重み） */
  kinds: { glass: 0.4, shell: 0.3, pebble: 0.3 } as Readonly<Record<'glass' | 'shell' | 'pebble', number>>,
  /**
   * 現れる場所（瓶底の内側の半径を 1）：軸からの距離と左右の上限（瓶の縁の近くは像が詰まって見えにくい）、
   * ポリプやほかの物との間（奥行きの差は軽く数える）、選び直す回数
   */
  spotRadius: 0.68,
  spotMaxX: 0.6,
  spacing: 0.24,
  depthWeight: 0.4,
  tries: 16,
  /** 自分で置くとき、ポリプやほかの物にこれより近ければ、近くの空いた所へずらす。置ける範囲（軸からの距離）。瓶底の半径 1 */
  placeSpacing: 0.16,
  placeRadius: 0.8,
} as const;

/** 拾いものの色と模様。kind ごとの重みで選ぶ。色はリニア。pattern は 0 なし・1 縞・2 細かい斑 */
export interface FindVariant {
  kind: 'glass' | 'shell' | 'pebble';
  weight: number;
  color: Vec3;
  color2: Vec3;
  pattern: 0 | 1 | 2;
}

export const FIND_VARIANTS: Readonly<Record<string, FindVariant>> = {
  // シーグラス：色の幅を広く。青・薄紫は珍しく、赤はごくまれ
  'glass-white': { kind: 'glass', weight: 5, color: [0.74, 0.8, 0.8], color2: [0.74, 0.8, 0.8], pattern: 0 },
  'glass-green': { kind: 'glass', weight: 5, color: [0.36, 0.66, 0.36], color2: [0.36, 0.66, 0.36], pattern: 0 },
  'glass-brown': { kind: 'glass', weight: 4, color: [0.36, 0.15, 0.04], color2: [0.36, 0.15, 0.04], pattern: 0 },
  'glass-aqua': { kind: 'glass', weight: 4, color: [0.38, 0.72, 0.76], color2: [0.38, 0.72, 0.76], pattern: 0 },
  'glass-amber': { kind: 'glass', weight: 3, color: [0.8, 0.46, 0.08], color2: [0.8, 0.46, 0.08], pattern: 0 },
  'glass-blue': { kind: 'glass', weight: 1.2, color: [0.06, 0.16, 0.78], color2: [0.06, 0.16, 0.78], pattern: 0 },
  'glass-lavender': { kind: 'glass', weight: 0.8, color: [0.56, 0.44, 0.8], color2: [0.56, 0.44, 0.8], pattern: 0 },
  'glass-red': { kind: 'glass', weight: 0.15, color: [0.72, 0.04, 0.05], color2: [0.72, 0.04, 0.05], pattern: 0 },
  // 貝殻のかけら
  'shell-white': { kind: 'shell', weight: 5, color: [0.8, 0.76, 0.67], color2: [0.7, 0.64, 0.55], pattern: 0 },
  'shell-pink': { kind: 'shell', weight: 2, color: [0.86, 0.5, 0.52], color2: [0.9, 0.7, 0.7], pattern: 0 },
  'shell-striped': { kind: 'shell', weight: 2.5, color: [0.78, 0.71, 0.6], color2: [0.32, 0.2, 0.13], pattern: 1 },
  'shell-purple': { kind: 'shell', weight: 1.5, color: [0.3, 0.2, 0.36], color2: [0.7, 0.66, 0.72], pattern: 1 },
  // 小石
  'pebble-gray': { kind: 'pebble', weight: 5, color: [0.3, 0.3, 0.29], color2: [0.2, 0.2, 0.2], pattern: 2 },
  'pebble-black': { kind: 'pebble', weight: 3, color: [0.05, 0.05, 0.055], color2: [0.12, 0.12, 0.12], pattern: 2 },
  'pebble-white': { kind: 'pebble', weight: 2.5, color: [0.72, 0.7, 0.66], color2: [0.6, 0.58, 0.55], pattern: 2 },
  'pebble-rust': { kind: 'pebble', weight: 2, color: [0.42, 0.18, 0.09], color2: [0.3, 0.13, 0.07], pattern: 2 },
  'pebble-banded': { kind: 'pebble', weight: 0.8, color: [0.26, 0.24, 0.22], color2: [0.78, 0.75, 0.7], pattern: 1 },
};

/**
 * 拾いものの見え方（瓶の高さ単位。瓶の高さはおよそ30cm、拾いものは実物大の1〜2cm）。
 * 自分では光らず、部屋・窓・デスクライトの光を受けたぶんだけ見える
 */
export const FIND_LOOK = {
  /** 長いほうの差し渡しの半分：シーグラス、貝殻のかけら、小石 */
  size: { glass: [0.017, 0.028], shell: [0.016, 0.025], pebble: [0.014, 0.022] } as Readonly<Record<'glass' | 'shell' | 'pebble', readonly [number, number]>>,
  /** 厚み（長さの半分 = 1）：シーグラス、小石。貝殻のかけらの反りの深さ */
  glassThickness: [0.16, 0.24] as const,
  pebbleHeight: [0.42, 0.62] as const,
  shellCurve: [0.22, 0.4] as const,
  /** 光の受け方：まわりの明るさ、窓の光、デスクライト、水の中の光の揺らめき（窓の光が強い時間ほど） */
  ambient: 0.8,
  key: 0.45,
  lamp: 0.55,
  caustic: 0.35,
  /** 瓶底に触れる所の暗さ（1 で暗くならない） */
  contactDark: 0.45,
  /** 瓶底に落ちる淡い影：濃さ、大きさ（差し渡しの半分に対する倍率）、右へのずれ、沈んでくるときに見えはじめる高さ */
  shadow: 0.45,
  shadowSize: 2.6,
  shadowShift: 0.25,
  shadowFadeHeight: 0.12,
  /** 濡れた面の照り（小石・貝殻）と、シーグラスの曇った面の透け具合（0 で不透明）と縁の明るさ */
  sheen: 0.18,
  glassAlpha: 0.72,
  glassRim: 0.6,
  /** シーグラスの表面の曇り（白っぽさ） */
  glassFrost: 0.35,
  /** 瓶底の堆積に少し埋まる深さ（厚みに対する割合） */
  sink: 0.12,
  /** 拾ったとき：薄れて消えるまで（秒）と、その間に持ち上がる高さ */
  leaveSeconds: 0.4,
  leaveRise: 0.012,
  /** 置いたとき：水面のすぐ下から瓶底まで沈む時間（秒）と、沈みはじめの深さ、揺れながら沈む揺れの大きさ（ラジアン）、海月がよける大きさ */
  sinkSeconds: 3.4,
  sinkStart: 0.03,
  sinkRock: 0.35,
  sinkAvoid: 0.06,
  /** 置いた物が水面のすぐ下に現れるときの、水面の小さな波紋（強さと、広がりはじめる半径） */
  dropRipple: 0.5,
  dropRippleRadius: 0.02,
  /** 指で押せる大きさ（見かけの半径に対する倍率） */
  pickScale: 1.6,
  /** 標本から運んできた物を離したとき、瓶底の上とみなす範囲（瓶底の半径 1。外側は置ける所まで寄せる） */
  dropReach: 1.15,
} as const;

/** 標本の写真（初めて拾ったとき）。虫眼鏡と同じく、その所を狭い画角で描き直して小さな画像にする */
export const FIND_PHOTO = {
  /** 写真の一辺（画素）と、写す広さ（拾いものの見かけの半径に対する倍率。下限は画面px） */
  px: 192,
  frame: 2.6,
  minHalfPx: 28,
  /** 暗すぎる写真だけ明るさを持ち上げる：真ん中（一辺に対する割合）の平均の明るさがこれより低ければ、ここまで（倍率の上限まで） */
  meter: 0.4,
  liftBelow: 0.2,
  maxLift: 4,
  /** JPEG の質 */
  quality: 0.85,
} as const;

/** 拾ったものが光になって日誌のアイコンへ吸い込まれる（秒・画面px） */
export const FIND_FLIGHT = {
  seconds: 0.95,
  /** 途中で上へふくらむ高さ（画面px） */
  arc: 70,
  /** 光の大きさ（直径、画面px）：はじめと終わり */
  size: [16, 6] as const,
  /** 標本から瓶へ運ぶとき、運ぶ物を指のこれだけ上に出す（画面px） */
  carryLift: 44,
} as const;

/** 育ちの早まりの上限（餌と揺れで分け合う。餌で上限に届いている日は、揺らしても何も足されない） */
export const GROWTH = {
  cap: 0.2,
} as const;

/**
 * 瓶底に溜まったものの見え方（堆積は CARE）。マリンスノーがうっすら白っぽいまだらになって溜まり、
 * 溜まるほど濃く広がる。水を替えると、薄く平らな膜に戻る。色はリニア、濃さは堆積 1（水換えの目安）のとき
 */
export const SEDIMENT = {
  color: [0.56, 0.53, 0.47] as Vec3,
  strength: 0.2,
  /** 均された薄い膜の割合（まだらにならない分） */
  film: 0.25,
  /** まだらの細かさ（瓶底の半径に対する模様の数）：大きい斑、小さい斑、細かいむら */
  scales: [8, 22, 55] as readonly number[],
  /** 底とガラスの境（縁の角）に多く溜まる度合い */
  corner: 0.3,
  /** 積もったマリンスノーの細かい粒：升目の細かさ（瓶底の半径に対する数）と、粒のある升目の割合（堆積 1 のとき） */
  flakeCells: 150,
  flakeRate: 0.12,
} as const;

/**
 * 見ていない間の世話（水換え）。水換えの機能は作らない。誰かが瓶の世話をしている跡としてだけ出る。
 * 瓶底にはマリンスノーが少しずつ溜まり（1日 snowPerDay）、餌の食べ残しが消えると、そのぶん少し増える（食べ残し1粒 perGrain）。
 * 食べ残しは餌をやってから leftoverSeconds で消えきる（瓶底の粒が薄れて消えるころ）。
 * 溜まったものが threshold に届いた瓶と、その日に餌をやった瓶は、夜中（startHour 時から windowHours 時間のどこか。瓶と夜ごとに決まる）に水を替え、
 * 瓶底が薄く均される（after まで）。餌をやった瓶は、食べ残しが消えきってから settleSeconds 待ってから替える（夜中にやったときは時刻がずれる）。
 * threshold に届いただけの瓶は、その時刻にまだ待つ間なら見送る。どちらも、その瓶を表示していれば次の夜に回す。
 * 日誌に「夜のうちに水を替えた」と一行残る。餌をやらなければ約11日に1回、餌をやった日はその夜
 */
export const CARE = {
  snowPerDay: 1 / 12,
  perGrain: 0.01,
  leftoverSeconds: 300,
  settleSeconds: 3600,
  threshold: 1,
  after: 0.1,
  startHour: 2,
  windowHours: 2,
} as const;

/**
 * 3つの瓶の切り替え。瓶は天板の上に横に並んでいて、スワイプすると見ている側が机に沿って横へ一歩ずれたように見える。
 * 手前の瓶は大きく横へ動き、部屋の写真はほんの少しだけ同じ向きへずれる（視差）
 */
export const SWIPE = {
  /** 隣の瓶との間（瓶の高さ単位）。止まっているときに隣の瓶が画面の外にちょうど隠れる間隔に、これを足す */
  gap: 0.08,
  /**
   * 瓶1つ分動いたときの写真のずれ（瓶の動きに対する割合）。奥の壁と、手前の天板。
   * 1番の瓶のときは写真の元の位置で、3番の瓶まで写真の端が見えない範囲に収める
   */
  parallaxWall: 0.06,
  parallaxTable: 0.2,
  /** 指の動きがこれを越えたら横のスワイプ（画面px）。縦の動きより大きいときだけ */
  startPx: 10,
  /** 離したとき、この速さ（瓶/秒）を越えていれば向きの隣の瓶へ */
  flickSpeed: 1.2,
  /** 落ち着くまでのばね（1/秒）。大きいほど速い */
  settle: 11,
  /** 端の瓶で引っ張ったときの手応え（引いた量に掛ける割合）と、引っ張れる量の上限（瓶の数） */
  edgeResist: 0.3,
  edgeMax: 0.12,
  /** 離したときの勢いの上限（瓶/秒）。速く払っても隣の瓶を大きく通り過ぎない */
  maxSpeed: 6,
  /**
   * 瓶のレンズが写真の外の左を映すとき、見ている瓶では窓の光にし、横へ離れた瓶では写真を折り返して読む。
   * 見ている位置からの離れ（瓶の数）がこの間で切り替わる
   */
  windowSideFade: [0.15, 0.6] as readonly [number, number],
} as const;

/**
 * 個体に触る操作。タップで札、長押しでカップに水ごと入れて運び、左右の端で隣の瓶の上へ、指を離すと水の中で放す。
 * 動かせるのは泳ぐ個体（成体・エフィラ）だけ
 */
export const HANDLING = {
  /** 指で押せる大きさ（画面px、半径）。小さな個体でもこの範囲なら拾う */
  pickRadiusPx: 22,
  /** 長押しと判断するまで（ミリ秒）。これより長く押したものはタップにしない */
  longPressMs: 450,
  /** 画面の左右の端のこの幅（画面の幅に対する割合）に、カップを運ぶと隣の瓶へ移す */
  edgeZone: 0.12,
  /** 端に運んでから移すまで（ミリ秒） */
  edgeDwellMs: 300,
  /** 端に運んでいる間、隣の瓶のほうへ少し寄る（瓶の数） */
  edgeLean: 0.08,
  /** 隣の瓶が上限のとき、隣をのぞく量（瓶の数）と、のぞいている時間（秒） */
  fullPeek: 0.4,
  fullPeekSeconds: 0.45,
} as const;

/**
 * カップ。薄い透明なプラスチックの計量カップ（飾りのない形）。海月を水ごと運んで、瓶の水の中で放す。
 * 大きさは瓶の高さ単位で、カップの底の真ん中が原点、上が +y、注ぎ口は +x の側
 */
export const CUP = {
  /** 内側の半径（底・口）と高さ、底の角の丸み */
  radiusBottom: 0.112,
  radiusTop: 0.132,
  height: 0.21,
  corner: 0.012,
  /** 注ぎ口：口の縁を外へ引き出す量と下げる量、その広がり（ラジアン）と、引き出しはじめる高さ（口から） */
  spout: 0.013,
  spoutDip: 0.004,
  spoutWidth: 0.34,
  spoutDepth: 0.04,
  /**
   * 縁の反射の強さと、プラスチックのうっすらした濃さ。瓶の水の中では少し淡くなる
   * （水の中で傾けて海月を放すところが見えるよう、消えきらない）
   */
  fresnel: 1.1,
  body: 0.03,
  inWater: 0.85,
  /** 入れる水の量（中の容積に対する割合）。成体の傘と口腕がすっかり浸かる深さ */
  fill: 0.82,
  /** 水の入った所の背景の曲がり方（負で左右が反転して詰まる）と、水の色（掛け算） */
  lensFlip: -0.55,
  waterTint: [0.86, 0.91, 0.92] as Vec3,
} as const;

/**
 * カップで水ごと移す流れ。海月はデリケートなので、どの動きもゆっくり丁寧に（ユーザー指定）。
 * 海月は一度も空気に触れさせない：放すときは、カップごと瓶の水に沈めてから、海月が自分で泳いで出ていくのを待つ。
 * 時間は秒、高さ・長さは瓶の高さ単位
 */
export const SCOOP = {
  /**
   * 上がる：瓶の中の海月が見えなくなる時間（同じ時間でカップの中に現れる）と、カップが口の中から口のすぐ上まで上がる時間、
   * カップが現れる・消えるのにかける時間。口を通るとき、カップの真ん中が瓶の軸からずれてよい量
   */
  jellyFadeSeconds: 0.45,
  riseSeconds: 1.1,
  fadeSeconds: 0.35,
  mouthSlack: 0.1,
  /** 運んでいる間：カップの底が瓶の口よりどれだけ上か、指についていくばね（1/秒）、動く向きへの傾き（ラジアン/速さ） */
  hoverClear: 0.03,
  follow: 7,
  followTilt: 0.5,
  /** 隣の瓶の上へ移る時間（画面が移るのに合わせる）と、途中で少し持ち上げる高さ */
  crossSeconds: 0.9,
  crossArc: 0.04,
  /**
   * 沈める：口の上で、口を通れる所へ寄せ終えるまでと、沈めはじめるまで、沈めきるまで（どれも指を離してから）。
   * 沈めきったとき、カップのいちばん上が水面からどれだけ下か（傾けている間もこの深さを保つ）
   */
  alignSeconds: 0.7,
  lowerDelay: 0.4,
  lowerSeconds: 2.2,
  submergeDepth: 0.02,
  /**
   * 水の中で傾ける時間と、いちばん傾いたときの角度（ラジアン）。口は瓶の真ん中のほうへ向け、少し手前（見ている側）へも向ける
   * （真横へ傾けると口の縁が線にしか見えず、中の海月も見えない）。手前へ向ける角度（ラジアン、水平の向きで）
   */
  tiltSeconds: 1.5,
  tiltMax: 1.13,
  tiltToward: 0.3,
  /**
   * 海月が出ていく：傾けはじめてからこの割合で、海月は自分の拍動で泳ぎはじめる（次の拍動を delay 秒後までに早める）。
   * 泳ぎ出る間の押し出しの強さ（ふだんの何倍か。小さな個体でも少なくとも min 倍の大きさとして）と、水の抵抗（1/秒。ふだんより小さく、ふわっと進む）
   */
  exitAt: 0.4,
  exitPulseDelay: 0.35,
  exitThrust: 3.4,
  exitMinThrust: 0.4,
  exitDrag: 1.8,
  /** 傘の中心がカップの口から傘の半径のこの倍だけ出たら、出た（口腕までおおよそ出ている）。出ないときに待つ上限（秒） */
  exitClear: 0.7,
  exitMaxSeconds: 8,
  /** 出たのを見届けてから空のカップが動きだすまで */
  clearSeconds: 0.3,
  /**
   * 去る：カップを起こす時間と、海月から離れる横の量。起こしはじめてから上がりはじめるまで、口の上まで上がる時間、
   * 口の上でさらに上がる高さと、消えるのにかける時間（上がる終わりのほう）
   */
  rightSeconds: 1.0,
  leaveShift: 0.03,
  leaveDelay: 0.4,
  liftSeconds: 1.7,
  leaveLift: 0.1,
  leaveFadeSeconds: 0.6,
  /** カップの中の海月：揺れのばね（1/秒²）と減衰（1/秒）、揺れの大きさの上限（カップの中に収まる）、ずれた分の傾き */
  jellySpring: 55,
  jellyDamping: 7,
  jellySway: 0.02,
  jellyTilt: 6,
  /** 水の中でカップを傾けるとき、海月の傘がカップの軸へ向きを合わせる強さと減衰（カップの壁に沿って一緒に傾く） */
  jellyTurn: 28,
  jellyTurnDamping: 9,
  /** カップの中で海月の傘の中心を置く高さ（カップの高さに対する割合） */
  jellyHeight: 0.5,
  /** 水の中のカップを、瓶のほかの泳ぐ個体がよける大きさ（カップの真ん中からの半径） */
  obstacleRadius: 0.16,
  /** 波紋の強さ：カップが水面を通って沈むとき、口まで沈むとき、口が水面から出るとき、底が水面から離れるとき */
  rippleEnter: 0.6,
  rippleSubmerge: 0.35,
  rippleEmerge: 0.45,
  rippleLeave: 0.35,
} as const;

/**
 * スポイト。薄い半透明のプラスチックの、細い管と球がひと続きになったもの（飾りのない形）。
 * 中は水と餌だけ（空気は出さない）。長さは瓶の高さ単位で、先の真ん中が原点、上が +y
 */
export const PIPETTE = {
  /** 先の口の半径、先が細くなっている長さ、管の半径、管の上端（球の付け根）、球の半径と高さ */
  tipRadius: 0.0026,
  taperLength: 0.07,
  stemRadius: 0.0085,
  stemTop: 0.44,
  bulbRadius: 0.03,
  bulbHeight: 0.15,
  /** 押したときの球の縮み（半径に対する割合） */
  squeezeDepth: 0.4,
  /** 見え方：縁の反射の強さ、プラスチックの濃さ、乳白の色（掛け算） */
  fresnel: 1.0,
  body: 0.07,
  tint: [0.95, 0.95, 0.91] as Vec3,
  /** 中の餌の濃さと、餌の入っている高さ（管の下から） */
  load: 0.35,
  loadHeight: 0.22,
} as const;

/**
 * 餌をやる流れ（描画側）。どの動きもゆっくり丁寧に。空気は入れない：先は水の中で出し入れし、泡もしぶきも出さない。
 * スポイトが瓶の口から降りてきて、先を水面の下にそっと入れ、球をゆっくり押して水の中で餌を出し、抜いて上がって消える。
 * 時間は秒、高さは瓶の高さ単位
 */
export const FEEDING = {
  /** 降りはじめる所（先の高さ、瓶の口の上）と、先を水面の下に入れる深さ */
  startY: 1.12,
  dipDepth: 0.035,
  /** 現れる・降りる・押すまで待つ・押す・押したまま待つ・抜いて上がる・消える（上がる終わりのほう） */
  fadeInSeconds: 0.5,
  descendSeconds: 1.9,
  settleSeconds: 0.4,
  squeezeSeconds: 1.5,
  holdSeconds: 0.6,
  withdrawSeconds: 1.8,
  fadeOutSeconds: 0.6,
  /** 口の真ん中から横へずらせる範囲（水面の近くにいる海月から離す） */
  sideRange: 0.07,
  /** 先が水面を出入りするときの波紋の強さと、輪の広がりはじめの半径 */
  ripple: 0.16,
  rippleRadius: 0.006,
  /** 水の中の先を、泳ぐ個体がよける大きさ（先から少し上の所を中心に） */
  obstacleRadius: 0.05,
} as const;

/**
 * 餌の粒（ブラインシュリンプの幼生）。橙色の細かい粒で、スポイトの先からふわっと広がって、ゆっくり沈む。
 * 生きているので、ときどきぴくっと跳ねる。自分では光らない。食べられずに底へ着いた粒は、数分で薄れて消える。
 * 長さは瓶の高さ単位、時間は秒
 */
export const FOOD = {
  /** 粒の直径（実物のおよそ2倍）と、大きさのばらつき */
  size: 0.0042,
  sizeJitter: 0.25,
  /** 色（リニア）。部屋の光・窓の光・デスクライトを受けたぶんだけ見える */
  color: [1.0, 0.36, 0.08] as Vec3,
  /** 先から出てくる勢い、水の抵抗（1/秒）、沈む速さ */
  emitSpeed: 0.05,
  drag: 2.5,
  sink: 0.012,
  /** 跳ねる間隔、跳ねる勢い、上向きの偏り */
  hopInterval: [0.6, 2.4] as const,
  hopSpeed: 0.04,
  hopUp: 0.1,
  /** 自分で泳ぐ横の速さ（向きはゆっくり変わる）。沈みながら、群れが少しずつ散らばる */
  swim: [0.002, 0.006] as const,
  swimTurn: 0.4,
  /** 粒の数：食べる粒の合計に足す割合と、最小・最大（成体1匹で15粒ほど） */
  extra: 0.6,
  min: 15,
  max: 56,
  /** 1回で食べる粒の数（食べた量 1 のとき）：成体、エフィラ（放されたばかり → 育ちきる前）、ポリプ */
  bitesAdult: 5,
  bitesEphyra: [1, 4] as const,
  bitesPolyp: 2,
  /**
   * 泳ぐ個体：緩むときに傘の下へ水を吸い込む流れで、近くの粒が傘の縁へ寄っていく。
   * 寄せる範囲（傘の半径単位）、寄る速さ（瓶の高さ/秒、成体のとき）、縁に触れて捕まる距離（傘の半径単位）
   */
  pullRange: 1.25,
  pull: 0.05,
  catchRange: 0.3,
  /** 捕まえてから：縁で持っている時間、胃へ運ぶ時間、胃で見えなくなるまで */
  holdSeconds: [1.0, 2.5] as const,
  carrySeconds: [3, 5] as const,
  absorbSeconds: 1.0,
  /** ポリプ：粒を寄せる範囲（瓶の高さ単位）と速さ、捕まえる距離（体の高さ単位）、底に着いた粒を拾える距離（体の高さ単位） */
  polypPullRange: 0.12,
  polypPull: 0.012,
  polypCatch: 1.6,
  polypReach: 3.5,
  /** 底に着いた粒が消えるまで。見せ場の長さの上限（そのあと、食べきっていない個体は胃の色だけ濃くなる） */
  floorFadeSeconds: 180,
  showSeconds: 150,
  /** 見せ場が終わってから、胃の色が食べた量の分まで濃くなる時間 */
  catchUpSeconds: 12,
} as const;

/**
 * 胃の橙色（食べた餌がうっすら透けて見える）。成体は四つ葉の輪郭だけ（内側と真ん中は色づかない。ユーザー指定）、
 * エフィラは真ん中の胃と腕へ伸びる管の付け根（四つ葉が浮かぶにつれて輪郭へ移る）、ポリプは体の中。
 * 食べてからしばらくはそのまま、そのあと薄れて消える
 */
export const STOMACH = {
  color: [1.0, 0.42, 0.13] as Vec3,
  /** 濃さ（食べた量 1 のとき）：エフィラの胃、四つ葉の輪郭、ポリプの体の中 */
  bell: 0.1,
  pouch: 0.22,
  polyp: 0.16,
  /** 食べてからそのままの時間と、消えきるまでの時間（秒、ゲーム内） */
  holdSeconds: 3600,
  fadeSeconds: 6 * 3600,
} as const;

/** 下端の中央の点3つ（今どの瓶か）。見ている瓶の点ほど明るい（不透明度） */
export const DOTS = {
  dim: 0.2,
  bright: 0.55,
} as const;

/**
 * 個体の札（名前・段階・この瓶に来てからの日数）。タップで出て、しばらくして消える。
 * 図鑑や標本の注記のように、個体から細い線を斜め上へ引き、その先の短い横線の上に名前、下に段階と日数を書く
 */
export const TAG = {
  /** 出ている時間と、消えるのにかける時間（秒） */
  seconds: 4.5,
  fadeSeconds: 0.8,
  /** 斜めの線の高さと横の長さ（画面px）。瓶の上端に近いときは高さを minRise まで縮める */
  rise: 34,
  run: 16,
  minRise: 14,
  /** 線を引きはじめる所：傘の見かけの半径に対する、横と上へのずれ */
  startSide: 0.35,
  startUp: 0.25,
  /** 横線の、文字の前後の余り（画面px）と、瓶の縁・画面の端から離す幅 */
  rulePad: 4,
  margin: 10,
  /** 名前を入れている間は、横線をこの高さ（画面の高さに対する割合）より上に出す（キーボードに隠れないように） */
  editMaxY: 0.34,
} as const;

/**
 * 観察日誌のメモ帳（上にリングが付いた小さなもの）。画面の下寄りに置き、上には瓶が薄く見えたまま。
 * 紙は真っ白にせず少しくすんだ色で、夜は部屋の明るさに合わせて暗くする（眩しくならないように）
 */
export const NOTEBOOK = {
  /** 紙の明るさ（掛け算）：昼、夕方、夜（ライトが点いているとき）、夜（ライトを消しているとき） */
  lumDay: 1,
  lumDusk: 0.8,
  lumNight: 0.55,
  lumDark: 0.4,
  /** めくる：指を離したとき、めくれたことにする割合（紙の高さに対して）と速さ（CSS px/秒）。めくる時間（秒） */
  flipAt: 0.3,
  flipSpeed: 600,
  flipSeconds: 0.36,
  /** 開く・閉じる時間（秒）。いちばん新しい日で下へ引いて閉じる距離（紙の高さに対する割合） */
  openSeconds: 0.45,
  closeAt: 0.22,
  /** 縦の動きとみなす距離（CSS px） */
  dragPx: 8,
} as const;

/**
 * 端末の動き（DeviceMotion）の受け取り方。使うのは重力を除いた加速度（acceleration）と回転の速さ（rotationRate）だけで、
 * 端末の傾き（重力の向き）は水面にも海月にも使わない。瓶は画面に固定されているので、端末の座標（x が画面の右、y が上、z が手前）を
 * そのまま瓶の座標として使う（前後の傾きは持っている角度にゆっくり慣れて、そこを「まっすぐ」とする。振った向きを瓶の座標に直すためだけ）
 */
export const MOTION = {
  /** 重力の向きのぶれを取る時間（秒）。重力は揺れを分けるのと、振った向きを瓶の座標に直すのにだけ使う */
  gravitySmooth: 0.2,
  /** 前後の傾きに慣れていく時間（秒） */
  pitchAdapt: 4,
  /** 揺れ（加速度、g）の上限。強く振っても海月は傷つかない */
  maxAccel: 3,
  /** 小さな揺れは受け取らない（g）。センサーのぶれ */
  accelDeadZone: 0.04,
  /** 重力を分けて渡さない端末で、重力を引いて揺れだけを取り出す時間（秒） */
  highPass: 0.25,
  /** 回す速さ（ラジアン/秒）の上限と、受け取らない小ささ */
  maxSpin: 12,
  spinDeadZone: 0.15,
  /** 回す速さのうち、速い分だけを取り出す時間（秒）。ゆっくり傾けた回りは数えない */
  spinHighPass: 0.6,
  /** しばらく値が来なければ、センサーはないものとする（秒） */
  staleSeconds: 0.5,
  /** 画面が上下逆さの向きに重力が続いたら、加速度の符号が逆の端末とみなす（秒）。縦画面で逆さに持つことはまずない */
  flipCheckSeconds: 1.5,
} as const;

/**
 * 振ったことの検出。重力を除いた加速度（g）か回転の速さ（ラジアン/秒）を smooth 秒でならし（机に置いたときの一瞬の衝撃を除く）、
 * どちらかが閾値を越えたときだけ「一回振った」とする。越えた瞬間の向き（振りはじめの向き）と、越えてから window 秒のうちでいちばん強かったところの強さで、
 * 水に一回ぶんの勢いを与える。次の一回は refractory 秒あけて（何度も振れば、そのたびに勢いが足される）。
 * 閾値は、手首で一回ぐっと振ったくらいで越え、歩く・机に置く・ゆっくり傾ける程度では越えない位置
 */
export const KICK = {
  smooth: 0.05,
  accel: 1.3,
  spin: 6,
  window: 0.12,
  refractory: 0.2,
  /** 勢いの大きさ（0〜1）：閾値ちょうどで base、この強さ（g）で 1。回したときは spinFull（ラジアン/秒）で 1 */
  base: 0.35,
  full: 3,
  spinFull: 12,
  /** 勢いを水に与える時間（秒）。いきなり傾くとスイッチが入ったように見えるので、ゆっくり立ち上がってから大きくなる */
  spread: 0.35,
  /** 続けて振ったとみなす間（秒）。その間の勢いは、はじめの一回で決めた向きに水を回し続ける */
  episode: 1.2,
  /** デバッグパネルの「今の値」のいちばん大きかったところを覚えておく時間（秒） */
  peakHold: 1.5,
} as const;

/**
 * 揺らされた瓶の水。振った一回ぶんの勢いで、水面は往復し（何度か揺れて静まる。端末の角度には追従しない）、
 * 水は瓶の中を流れる：振った向きと逆へ取り残される一様な流れ、水面の往復に合わせた流れ、瓶の中を回る流れ。
 * 流れは瓶の中身（海月の傘・触手・口腕・マリンスノー・瓶底から舞い上がった堆積・泡）を運ぶ。瓶底に付いたもの（ポリプ）は動かない
 */
export const SLOSH = {
  /** 水面の往復の速さ（Hz）と減衰（1 で往復しない） */
  freq: 1.1,
  damping: 0.13,
  /** 水面の傾きの上限（度） */
  maxTilt: 18,
  /**
   * 勢い 1 のとき：水面が傾きはじめる速さ（傾き/秒。振った向きの側が下がる）、取り残される流れ（瓶の高さ/秒）、
   * 瓶の中を回る流れ（ラジアン/秒。はじめの一回の向きで、上 × 振った向きと逆向き。回したときは回した向きと逆）
   */
  kickSlope: 2.3,
  kickFlow: 0.25,
  kickSwirl: 1.5,
  /** 取り残された流れが壁に止められて消える時間と、回る流れが消える時間（秒） */
  flowDecay: 0.45,
  swirlDecay: 2.2,
  /** 水面の往復が水を運ぶ強さ（1 でおおよそ水面の縁の上下と同じ速さ）と、深さで弱まる長さ（瓶の高さ） */
  sloshFlow: 1,
  sloshDepth: 0.25,
  /** 回る流れの上限（ラジアン/秒）と一様な流れの上限（瓶の高さ/秒） */
  maxSwirl: 3,
  maxFlow: 0.5,
  /** 回る流れの中心の高さ（水の真ん中あたり） */
  centerY: 0.42,
  /** 流れの強さ（0〜1）の目安：この速さ（瓶の高さ/秒）で 1。上がるのはすぐで、下がるのは stirFall 秒 */
  stirFlow: 0.22,
  stirFall: 1.0,
  /** 水面の波立ち（uAgitation）に足す強さ */
  agitation: 1.2,
  /** この流れの強さを越えたら「揺らした」とする（sim に記録する。エフィラの育ちがわずかに早まる） */
  recordAt: 0.2,
  /** 記録し直すまでの間（秒） */
  recordInterval: 30,
  /** マリンスノーが流れに運ばれた分が、元へ戻る時間（秒）。粒は描くたびに場所を決めているので、ずれとして持つ */
  snowReturn: 5,
  maxSnowTurn: 1.2,
} as const;

/**
 * 揺れの中の海月。傘は重く、水の流れに遅れてついていき（瓶から見ると先に動く）、触手と口腕は水と一緒に動く。
 * 回る流れに乗って転がり、逆さまになることもある。流れが収まったら、何拍かの拍動をかけてゆっくり起き直る。
 * 揺らしていない普段は、今の大きな傾き（60〜70°）までで、逆さまにはならない
 */
export const TUMBLE = {
  /** 傘が水の流れについていく割合（触手と口腕は 1） */
  bellFollow: 0.55,
  /** 傘が回る流れについて回る割合 */
  spinFollow: 0.85,
  /** 強く揺れている間、触手と口腕が軽くなる割合（ふわっと舞い上がり、広がる）。軽さは lightFall 秒かけて戻る */
  float: 0.8,
  lightFall: 3,
  /** 流れが収まったとみなす強さ（0〜1） */
  calm: 0.12,
  /** 流れのあと、この角度（度）より傾いていたら、拍動で起き直る */
  rightAt: 80,
  /** 起き直るのをやめて、ふだんの泳ぎに戻る角度（度） */
  rightedAt: 45,
  /** 起き直るとき、1回の縮みで回す強さ（ラジアン/秒の足し分。1拍でおよそ これ ÷ SWIM.turnDamping ラジアン回る） */
  rightingPerBeat: 1.5,
  /** 起き直るまでの間の、泳いで進む割合（逆さまのまま底へ泳いでいかないように） */
  rightingThrust: 0.35,
} as const;

/** 強く振ったときだけ、水面の縁から小さな水の粒が跳ねて水に戻る（泡は作らない。水位は減らない） */
export const SPLASH = {
  /** 水面の縁が上下する速さ（瓶の高さ/秒）がこれを越えたとき、または勢いが kickAt を越える一回を振ったときに跳ねる */
  threshold: 0.24,
  kickAt: 0.5,
  /** 強い一回を振ってから跳ねるまで（秒） */
  kickDelay: 0.25,
  /** 1回に跳ねる数と、次に跳ねるまでの間（秒）、同時に跳ねている数の上限 */
  count: [2, 4] as const,
  interval: 0.15,
  max: 16,
  /** 跳ねる速さ（瓶の高さ/秒）と、落ちる速さ（瓶の高さ/秒²） */
  speed: [0.45, 0.8] as const,
  gravity: 6,
  /** 粒の半径（瓶の高さ）と濃さ */
  radius: 0.0036,
  opacity: 1,
  /** 水に戻るときの波紋の強さ */
  ripple: 0.25,
} as const;

/** 揺らすと、瓶底に溜まったものが舞い上がり、ゆっくり沈み直す */
export const STIRRED_SEDIMENT = {
  /** 舞い上がりはじめる流れの強さ（0〜1） */
  liftAt: 0.35,
  /** 舞い上がる粒の数：堆積 1 あたりと、最小・最大 */
  perSediment: 110,
  min: 16,
  max: 140,
  /** 流れの強さ 1 のとき、一度に舞い上がる割合（1秒あたり） */
  liftRate: 1.2,
  /** 舞い上がる勢い（瓶の高さ/秒）と、水の中を沈む速さ（瓶の高さ/秒） */
  lift: [0.08, 0.22] as const,
  fall: [0.006, 0.016] as const,
  /** 流れについていく割合と、水面のこれより近くでは上へ運ばれにくくなる距離（瓶の高さ） */
  follow: 0.6,
  topSoft: 0.25,
  /** 濃さ（マリンスノーより少し淡く） */
  opacity: 0.7,
  /** 舞っている分だけ、瓶底の模様が薄くなる割合 */
  floorThin: 0.6,
  /** 粒の大きさ（瓶の高さ、直径） */
  size: [0.0016, 0.0045] as const,
} as const;

/** デバッグパネル（?debug のときだけ） */
export const DEBUG = {
  /** 早送りの倍率。ゲームの時間と光の時刻だけが速く進む */
  speeds: [1, 60, 3600],
  /** ボタンで一気に進める時間（秒） */
  jumps: [3600, 86400, 7 * 86400, 30 * 86400],
  /**
   * センサーなしで揺れを試す：一回揺らす（弱・中・強。弱は反応しないくらいの揺れ、中は手首で一回ぐっと振る）。向き（瓶の座標）、強さ（g）、往復の速さ（Hz）、続く時間（秒）。
   * 強いほうは斜め下へも振る（瓶を急に下げる動きを含む）
   */
  shakes: {
    weak: { dir: [1, 0.1, 0] as Vec3, accel: 0.7, freq: 3.5, seconds: 0.6 },
    medium: { dir: [1, -0.2, 0.1] as Vec3, accel: 2.2, freq: 4, seconds: 0.25 },
    strong: { dir: [1, -0.6, 0.25] as Vec3, accel: 2.4, freq: 3, seconds: 1.4 },
  },
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
