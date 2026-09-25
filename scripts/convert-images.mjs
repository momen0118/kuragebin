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
