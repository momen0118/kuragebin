// art/ の元画像から public/ 以下の配信用画像を作る。
// 背景は WebP。元画像の長辺が 2048px 未満なら拡大はしない。
// 夜の暗部でブロックノイズが出ないよう画質は高めにしている。
// 元が WebP で縮小も要らなければ、再圧縮せずにそのまま使う。
import sharp from 'sharp';
import { copyFile, mkdir, access } from 'node:fs/promises';

const MAX_LONG_SIDE = 2048;
const BACKGROUNDS = ['day', 'dusk', 'night', 'sakura'];

const exists = (p) => access(p).then(() => true, () => false);

await mkdir('public/bg', { recursive: true });

for (const name of BACKGROUNDS) {
  const webpSrc = `art/bg-${name}.webp`;
  const src = (await exists(webpSrc)) ? webpSrc : `art/bg-${name}.png`;
  const dst = `public/bg/bg-${name}.webp`;
  const meta = await sharp(src).metadata();
  if (meta.format === 'webp' && Math.max(meta.width, meta.height) <= MAX_LONG_SIDE) {
    await copyFile(src, dst);
    console.log(`${dst}  ${meta.width}x${meta.height}  (copied)`);
    continue;
  }
  const info = await sharp(src)
    .resize({ width: MAX_LONG_SIDE, height: MAX_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 95, effort: 6 })
    .toFile(dst);
  console.log(`${dst}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB`);
}

// アイコン：元画像（正方形、黒地に余白あり）から作る。
// 普通のアイコンは瓶が大きく見えるよう、瓶を中心に少し寄せて切り抜く（ICON_ZOOM 倍）。
// maskable は元画像の余白をそのまま使う。絵が安全域（中心から半径 40%）からはみ出すときだけ、黒地を足して縮める
const ICON_SRC = 'art/icon-source.png';
const ICON_ZOOM = 1.25;
const SAFE_RADIUS = 0.4;
/** これより暗い画素は地とみなす（0〜255） */
const GROUND = 8;
/** 瓶の範囲を測るときの明るさのしきい値（ふちのかすかな光は含めない） */
const SUBJECT = 16;

await mkdir('public/icons', { recursive: true });

/** 絵のある画素が、中心から最大でどれだけ離れているか（一辺に対する比） */
async function contentRadius(src) {
  const { data, info } = await sharp(src).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const cx = info.width / 2;
  const cy = info.height / 2;
  let r = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] > GROUND) r = Math.max(r, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
    }
  }
  return r / info.width;
}

/** 絵（瓶）の外接矩形の中心（画素） */
async function subjectCenter(src) {
  const { data, info } = await sharp(src).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width;
  let y0 = info.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] > SUBJECT) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

const iconMeta = await sharp(ICON_SRC).metadata();
const reach = await contentRadius(ICON_SRC);
const shrink = Math.min(1, SAFE_RADIUS / reach);
// 普通のアイコンの切り抜き：瓶の中心に合わせ、元画像からはみ出さない範囲で
const [scx, scy] = await subjectCenter(ICON_SRC);
const crop = Math.round(iconMeta.width / ICON_ZOOM);
const clampTo = (v) => Math.min(Math.max(Math.round(v - crop / 2), 0), iconMeta.width - crop);
const cropBox = { left: clampTo(scx), top: clampTo(scy), width: crop, height: crop };

const ICONS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  // iOS のホーム画面用
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
];

for (const { file, size, maskable } of ICONS) {
  const dst = `public/icons/${file}`;
  let img = sharp(ICON_SRC).removeAlpha();
  if (!maskable) img = sharp(await img.extract(cropBox).toBuffer());
  if (maskable && shrink < 1) {
    // 縮めた絵を、元画像の地の色で囲む
    const inner = Math.round(iconMeta.width * shrink);
    const pad = Math.floor((iconMeta.width - inner) / 2);
    const { data } = await sharp(ICON_SRC).removeAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    const scaled = await sharp(ICON_SRC).removeAlpha().resize(inner, inner).toBuffer();
    img = sharp({ create: { width: iconMeta.width, height: iconMeta.width, channels: 3, background: { r: data[0], g: data[1], b: data[2] } } })
      .composite([{ input: scaled, left: pad, top: pad }])
      .png();
    img = sharp(await img.toBuffer());
  }
  const info = await img.resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(dst);
  const note = maskable ? `絵の半径 ${(reach * 100).toFixed(1)}%、縮小 ${shrink.toFixed(2)}` : `切り抜き ${JSON.stringify(cropBox)}`;
  console.log(`${dst}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB  (${note})`);
}
