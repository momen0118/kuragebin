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
   * 小さな波紋（カップを沈める・引き上げる・注ぐとき）。輪が広がる速さ（瓶の高さ/秒）、波長、輪の幅、
   * 消えていく時間（秒）、高さ（強さ 1 のとき、瓶の高さ単位）、水面の光り方
   */
  rippleSpeed: 0.45,
  rippleWavelength: 0.03,
  rippleWidth: 0.045,
  rippleDecay: 0.9,
  rippleHeight: 0.005,
  rippleShine: 0.35,
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

/** 観察日誌（出来事の記録）。古いものから消す */
export const JOURNAL = {
  maxEntries: 600,
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
 * 個体に触る操作。タップで札、長押しでカップですくい、左右の端へ運ぶと隣の瓶へ移す。
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
  /** 隣の瓶が上限のとき、隣をのぞく量（瓶の数）と、のぞいている時間（秒）。戻ってから注ぎ戻すまで（秒） */
  fullPeek: 0.4,
  fullPeekSeconds: 0.45,
  peekReturnSeconds: 0.3,
} as const;

/**
 * カップ。薄い透明なプラスチックの計量カップ（飾りのない形）。海月を水ごとすくって、隣の瓶へ注ぐ。
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
  /** 縁の反射の強さと、プラスチックのうっすらした濃さ。瓶の水の中では縁がほとんど見えなくなる */
  fresnel: 1.1,
  body: 0.03,
  inWater: 0.5,
  /** 入れる水の量（中の容積に対する割合）。成体の傘と口腕がすっかり浸かる深さ */
  fill: 0.82,
  /** 水の入った所の背景の曲がり方（負で左右が反転して詰まる）と、水の色（掛け算） */
  lensFlip: -0.55,
  waterTint: [0.86, 0.91, 0.92] as Vec3,
} as const;

/** カップですくって運び、注ぐ流れ。時間は秒、高さ・長さは瓶の高さ単位 */
export const SCOOP = {
  /** 現れる高さ（瓶の口より上）と、現れる・消えるのにかける時間 */
  appearHeight: 0.14,
  fadeSeconds: 0.3,
  /** すくう：口の中まで降りる、水の中を海月のそばまで、海月を入れる、引き上げる */
  descendSeconds: 0.5,
  reachSeconds: 0.55,
  gatherSeconds: 0.35,
  liftSeconds: 0.9,
  /** 口を通るとき、カップの真ん中が瓶の軸からずれてよい量 */
  mouthSlack: 0.1,
  /** 運んでいる間：カップの底が瓶の口よりどれだけ上か、指についていくばね（1/秒）、動く向きへの傾き（ラジアン/速さ） */
  hoverClear: 0.03,
  follow: 7,
  followTilt: 0.5,
  /** 隣の瓶へ運ぶ時間と、途中で持ち上げる高さ */
  crossSeconds: 0.85,
  crossArc: 0.06,
  /** 注ぐ所へ動く時間（その場で注ぎ戻すとき） */
  moveSeconds: 0.5,
  /** 注ぐ：注ぎ口の高さ（瓶の口より上）と、瓶の軸からのずれ（来た側へ）、傾ける時間と最大の角度（ラジアン） */
  pourLipHeight: 0.08,
  pourOffset: 0.05,
  tiltSeconds: 1.3,
  tiltMax: 2.1,
  /** 注ぎ終えてから起こす時間と、上がって消える時間 */
  settleSeconds: 0.5,
  leaveSeconds: 0.6,
  /** 海月がカップから離れる水の残り（割合）と、落ちていくときの重さ（瓶の高さ/秒²）、水に入ったあとの沈む速さ */
  exitFill: 0.3,
  fallGravity: 9,
  entrySpeed: 0.05,
  /** 注ぐ水の筋：いちばん勢いがあるときの太さと、落ちていく重さ（瓶の高さ/秒²） */
  streamWidth: 0.018,
  streamGravity: 30,
  /** カップの中の海月：揺れのばね（1/秒²）と減衰（1/秒）、揺れの大きさの上限（カップの中に収まる）、ずれた分の傾き */
  jellySpring: 55,
  jellyDamping: 7,
  jellySway: 0.02,
  jellyTilt: 6,
  /** カップの中で海月の傘の中心を置く高さ（カップの高さに対する割合） */
  jellyHeight: 0.5,
  /** 波紋の強さ：カップが水に入る・出る、注がれた水、海月が入る */
  rippleCup: 0.8,
  rippleStream: 0.35,
  rippleJelly: 1.0,
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

/** デバッグパネル（?debug のときだけ） */
export const DEBUG = {
  /** 早送りの倍率。ゲームの時間と光の時刻だけが速く進む */
  speeds: [1, 60, 3600],
  /** ボタンで一気に進める時間（秒） */
  jumps: [3600, 86400, 7 * 86400, 30 * 86400],
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
