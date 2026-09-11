import { ART_WIDTHS } from './art-widths.mjs';

export default function artLoader({
  src,
  width,
}: {
  src: string;
  width: number;
  quality?: number;
}) {
  const snap = ART_WIDTHS.find((w) => w >= width) ?? ART_WIDTHS[ART_WIDTHS.length - 1];
  return src.replace(/\.webp$/, `-${snap}.webp`);
}
