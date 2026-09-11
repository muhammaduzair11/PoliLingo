import sharp from 'sharp';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const SRC = 'assets-src';
const OUT = 'public/assets';

const TARGETS = {
  world: { width: 900, quality: 85 },
  poli: { width: 800, quality: 85 },
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

for (const file of readdirSync(SRC)) {
  if (!file.toLowerCase().endsWith('.png')) continue;
  const name = basename(file, '.png');
  const cfg = name.startsWith('world') ? TARGETS.world : TARGETS.poli;
  const srcPath = join(SRC, file);
  const outPath = join(OUT, `${name}.webp`);

  const before = statSync(srcPath).size;
  const meta = await sharp(srcPath).metadata();

  await sharp(srcPath)
    .resize({ width: cfg.width, withoutEnlargement: true, fit: 'inside' })
    .webp({ quality: cfg.quality, effort: 6, alphaQuality: cfg.quality })
    .toFile(outPath);

  const after = statSync(outPath).size;
  const outMeta = await sharp(outPath).metadata();
  console.log(
    `${name.padEnd(16)} ${meta.width}x${meta.height} ${kb(before).padStart(10)} -> ` +
      `${outMeta.width}x${outMeta.height} ${kb(after).padStart(9)}  ` +
      `(-${Math.round((1 - after / before) * 100)}%)`,
  );
}
