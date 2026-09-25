// art/ の元画像から public/ 以下の配信用画像を作る。
// 背景は WebP。元画像の長辺が 2048px 未満なら拡大はしない。
// 夜の暗部でブロックノイズが出ないよう画質は高めにしている。
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const MAX_LONG_SIDE = 2048;
const BACKGROUNDS = ['day', 'dusk', 'night', 'sakura'];

await mkdir('public/bg', { recursive: true });

for (const name of BACKGROUNDS) {
  const src = `art/bg-${name}.png`;
  const dst = `public/bg/bg-${name}.webp`;
  const info = await sharp(src)
    .resize({ width: MAX_LONG_SIDE, height: MAX_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 95, effort: 6 })
    .toFile(dst);
  console.log(`${dst}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB`);
}
