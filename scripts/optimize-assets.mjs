import sharp from 'sharp';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ART_WIDTHS } from '../lib/art-widths.mjs';

const SRC = 'assets-src';
const OUT = 'public/assets';
const WEBP_QUALITY = 90;
const AVIF_QUALITY = 60;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

for (const file of readdirSync(SRC)) {
  if (!file.toLowerCase().endsWith('.png')) continue;
  const name = basename(file, '.png');
  const srcPath = join(SRC, file);
  const before = statSync(srcPath).size;
  const meta = await sharp(srcPath).metadata();

  // 2x Lanczos intermediate so every rung, including those wider than the
  // master, is a downsample (supersampled) rather than a browser upscale.
  const intermediate = await sharp(srcPath)
    .resize({ width: meta.width * 2, kernel: 'lanczos3' })
    .toBuffer();

  const ladder = [];
  for (const w of ART_WIDTHS) {
    const resized = sharp(intermediate).resize({
      width: w,
      withoutEnlargement: true,
      fit: 'inside',
    });
    await resized
      .clone()
      .webp({ quality: WEBP_QUALITY, effort: 6, alphaQuality: WEBP_QUALITY })
      .toFile(join(OUT, `${name}-${w}.webp`));
    await resized
      .clone()
      .avif({ quality: AVIF_QUALITY, effort: 4 })
      .toFile(join(OUT, `${name}-${w}.avif`));
    ladder.push(`${w}:${kb(statSync(join(OUT, `${name}-${w}.avif`)).size)}/${kb(statSync(join(OUT, `${name}-${w}.webp`)).size)}`);
  }

  console.log(
    `${name.padEnd(16)} ${meta.width}x${meta.height} ${kb(before).padStart(10)} -> avif/webp ${ladder.join(' ')}`,
  );
}
