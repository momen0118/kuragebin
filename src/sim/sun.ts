// 日付と緯度経度から、日の出・日の入りの時刻（端末の現地時刻、時）を求める。
// NOAA の簡易式。誤差は数分程度で、光の切り替えには十分。

export interface SunTimes {
  sunrise: number;
  sunset: number;
}

const RAD = Math.PI / 180;

/** その日の日の出・日の入り。date は端末の現地時刻の日付として使う */
export function sunTimes(date: Date, latitude: number, longitude: number): SunTimes {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const dayOfYear = Math.round((noon.getTime() - startOfYear.getTime()) / 86400000) + 1;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);

  // 均時差（分）と太陽の赤緯（ラジアン）
  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);

  // 太陽の上端が地平線に接するときの時角（大気の屈折を含む）
  const lat = latitude * RAD;
  const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
  const ha = Math.acos(Math.min(Math.max(cosH, -1), 1)) / RAD;

  // UTC の分 → 端末の現地時刻の時
  const tz = -noon.getTimezoneOffset();
  const toLocal = (utcMinutes: number): number => {
    const h = (utcMinutes + tz) / 60;
    return ((h % 24) + 24) % 24;
  };
  return {
    sunrise: toLocal(720 - 4 * (longitude + ha) - eqTime),
    sunset: toLocal(720 - 4 * (longitude - ha) - eqTime),
  };
}
