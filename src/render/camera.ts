// 背景写真に合わせたカメラ。瓶の位置を写真の座標で固定し、画面比率が変わってもずれないようにする。
// 瓶の底の中心がワールド原点、y が上。カメラは +z 側から少し見下ろす。
import { PHOTO, JAR, ROOM, type Vec3 } from '../config';

export interface PhotoCamera {
  position: Vec3;
  /** 見下ろす角度（ラジアン、正で下向き） */
  pitch: number;
  /** 写真の縦いっぱいに対応する縦の画角（度） */
  vFovDeg: number;
  /** 天板の奥の縁（ワールド z）と左の縁（ワールド x） */
  tableBackZ: number;
  tableLeftX: number;
}

/** 写真の画素 (px, py) を通る視線の向き（ワールド、カメラ原点） */
function rayDir(px: number, py: number, pitch: number): Vec3 {
  const f = PHOTO.focalPx;
  const a = (px - PHOTO.width / 2) / f;
  const b = -(py - PHOTO.height / 2) / f;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // right = (1,0,0), up = (0,cos,-sin), forward = (0,-sin,-cos)
  return [a, b * cp - sp, -b * sp - cp];
}

export function solvePhotoCamera(): PhotoCamera {
  const f = PHOTO.focalPx;
  const cy = PHOTO.height / 2;
  const pitch = Math.atan((cy - PHOTO.horizonY) / f);

  // 瓶の底の中心は写真の jarBase を通る視線上。上端が jarHeightPx だけ上に写る距離を求める
  const b = -(PHOTO.jarBaseY - cy) / f;
  const k = (cy - (PHOTO.jarBaseY - PHOTO.jarHeightPx)) / f;
  const H = JAR.height;
  const t = (H * (Math.cos(pitch) + k * Math.sin(pitch))) / (k - b);
  const d = rayDir(PHOTO.jarBaseX, PHOTO.jarBaseY, pitch);
  const position: Vec3 = [-t * d[0], -t * d[1], -t * d[2]];

  // 天板の奥の左角を天板の面（y=0）に落とす
  const [cxPx, cyPx] = PHOTO.tableBackLeft;
  const dc = rayDir(cxPx, cyPx, pitch);
  const s = -position[1] / dc[1];
  const tableLeftX = position[0] + dc[0] * s;
  const tableBackZ = position[2] + dc[2] * s;

  const vFovDeg = (2 * Math.atan(PHOTO.height / 2 / f) * 180) / Math.PI;
  return { position, pitch, vFovDeg, tableBackZ, tableLeftX };
}

/**
 * 画面UV→写真UVの変換（写真UV = uv * scale + offset）。写真はふだん高さいっぱいに置く。
 * 写真より縦長の画面では左右が切れ、横長の画面では左右に写真の外（黒）が出る。
 * 写真の横幅の ROOM.minPhotoWidth より狭くしか見えないほど縦長の画面では、写真を小さく置いて上下に写真の外を出す
 * （写真の真ん中はカメラの軸のまま。カメラの画角は screenFovDeg で合わせる）
 */
export function coverTransform(aspect: number): { scale: [number, number]; offset: [number, number] } {
  const photoAspect = PHOTO.width / PHOTO.height;
  const sy = Math.max(1, (ROOM.minPhotoWidth * photoAspect) / aspect);
  const sx = (aspect * sy) / photoAspect;
  return { scale: [sx, sy], offset: [(1 - sx) / 2, (1 - sy) / 2] };
}

/** 画面の縦いっぱいに対応する縦の画角（度）。写真を高さいっぱいより小さく置くときは、そのぶん広い */
export function screenFovDeg(aspect: number): number {
  const sy = coverTransform(aspect).scale[1];
  return (2 * Math.atan((sy * PHOTO.height) / 2 / PHOTO.focalPx) * 180) / Math.PI;
}
