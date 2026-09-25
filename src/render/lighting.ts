// 時刻から光の状態を決める。three.js に依存しない純粋な関数。
// 光の移り変わりは、その日の日の出・日の入りを基準に置く。
import { DIRECT_SUN, LIGHT_LOOKS, LIGHT_SCHEDULE, RIM_WARM, SUN, type LightKey, type Vec3 } from '../config';
import { sunTimes, type SunTimes } from '../sim/sun';

export interface LightState {
  /** 背景写真の重み（合計1） */
  day: number;
  dusk: number;
  night: number;
  /** 明け方の青み（0〜1） */
  dawnTint: number;
  /** 窓からの光（色×強さ）と、光の来る向き（正規化済み） */
  key: Vec3;
  keyDir: Vec3;
  ambient: Vec3;
  /** 海月の発光の倍率 */
  glow: number;
  /** 瓶がレンズになって集める光と、瓶の影の濃さ。窓から日が直接差す間だけ */
  lensLight: number;
  shadow: number;
  /** 瓶の縁に乗る夕方の温度（0〜1） */
  rimWarm: number;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** 0〜24 に折り返す */
export function wrapHour(hour: number): number {
  const h = hour % 24;
  return h < 0 ? h + 24 : h;
}

/**
 * 光の移り変わりをキーフレームにする。前後の日の分も並べるので、
 * 端末のタイムゾーンで日の出・日の入りが0時をまたいでもつながる
 */
export function buildKeys(sun: SunTimes): LightKey[] {
  // 日の入りが日の出より前に来る（0時をまたぐ）ときは、日の入りを翌日側に寄せる
  const sunset = sun.sunset < sun.sunrise ? sun.sunset + 24 : sun.sunset;
  const keys: LightKey[] = [];
  for (const day of [-24, 0, 24]) {
    for (const k of LIGHT_SCHEDULE) {
      keys.push({ hour: day + (k.from === 'sunrise' ? sun.sunrise : sunset) + k.minutes / 60, ...LIGHT_LOOKS[k.look] });
    }
  }
  keys.sort((a, b) => a.hour - b.hour);
  return keys;
}

/**
 * 窓から日が直接差しているか（0〜1）。日の出のあと少しずつ差しはじめ、日の入りの少し前から消えていく。
 * 日の出・日の入りが0時をまたいでもよい
 */
export function directSun(hourIn: number, sun: SunTimes): number {
  const dayLength = wrapHour(sun.sunset - sun.sunrise);
  const sinceRise = wrapHour(hourIn - sun.sunrise);
  if (sinceRise >= dayLength) return 0;
  const rise = Math.min(sinceRise / (DIRECT_SUN.riseRampMinutes / 60), 1);
  const set = Math.min((dayLength - sinceRise) / (DIRECT_SUN.setRampMinutes / 60), 1);
  return smooth(rise) * smooth(set);
}

export function lightAt(hourIn: number, sun: SunTimes): LightState {
  const hour = wrapHour(hourIn);
  const keys = buildKeys(sun);
  let i = 0;
  while (i < keys.length - 2 && hour >= keys[i + 1]!.hour) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const span = b.hour - a.hour;
  const t = span > 0 ? smooth(Math.min(Math.max((hour - a.hour) / span, 0), 1)) : 0;

  const day = mix(a.day, b.day, t);
  const dusk = mix(a.dusk, b.dusk, t);
  const night = mix(a.night, b.night, t);
  const sum = day + dusk + night || 1;

  const rimHour = wrapHour(sun.sunset - RIM_WARM.minutesBeforeSunset / 60);
  let rimD = Math.abs(hour - rimHour);
  rimD = Math.min(rimD, 24 - rimD) / RIM_WARM.widthHours;
  const direct = directSun(hour, sun);
  return {
    day: day / sum,
    dusk: dusk / sum,
    night: night / sum,
    dawnTint: mix(a.dawnTint, b.dawnTint, t),
    key: mix3(a.keyColor, b.keyColor, t),
    keyDir: normalize(mix3(a.keyDir, b.keyDir, t)),
    ambient: mix3(a.ambient, b.ambient, t),
    glow: mix(a.glow, b.glow, t),
    lensLight: mix(a.lensLight, b.lensLight, t) * direct,
    shadow: mix(a.shadow, b.shadow, t) * direct,
    rimWarm: Math.exp(-rimD * rimD),
  };
}

/** その日の日の出・日の入り（場所は config の SUN） */
export function sunOf(date: Date): SunTimes {
  return sunTimes(date, SUN.latitude, SUN.longitude);
}

/** Date から現地時刻（時、小数） */
export function hourOf(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}
