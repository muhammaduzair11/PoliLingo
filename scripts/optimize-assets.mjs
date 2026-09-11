import sharp from 'sharp';
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ART_WIDTHS } from '../lib/art-widths.mjs';

const SRC = 'assets-src';
const OUT = 'public/assets';
const QUALITY = 90;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

for (const file of readdirSync(SRC)) {
  if (!file.toLowerCase().endsWith('.png')) continue;
  const name = basename(file, '.png');
  const srcPath = join(SRC, file);
  const before = statSync(srcPath).size;
  const meta = await sharp(srcPath).metadata();

  const widest = ART_WIDTHS[ART_WIDTHS.length - 1];
  for (const w of ART_WIDTHS) {
    await sharp(srcPath)
      .resize({ width: w, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: QUALITY, effort: 6, alphaQuality: QUALITY })
      .toFile(join(OUT, `${name}-${w}.webp`));
  }
  copyFileSync(join(OUT, `${name}-${widest}.webp`), join(OUT, `${name}.webp`));

  const ladder = ART_WIDTHS.map(
    (w) => `${w}:${kb(statSync(join(OUT, `${name}-${w}.webp`)).size)}`,
  ).join(' ');
  console.log(
    `${name.padEnd(16)} ${meta.width}x${meta.height} ${kb(before).padStart(10)} -> q${QUALITY} ${ladder}`,
  );
}
