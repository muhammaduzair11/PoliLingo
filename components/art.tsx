'use client';
import { ART_WIDTHS } from '@/lib/art-widths.mjs';

/** Every width of one piece of art in one format, as a srcset. */
export function artSrcSet(name: string, ext: string): string {
  return ART_WIDTHS.map((w) => `/assets/${name}-${w}.${ext} ${w}w`).join(', ');
}

export function Art({
  name,
  alt,
  className = '',
  sizes,
  priority = false,
  width = 1000,
  height = 1000,
}: {
  name: string;
  alt: string;
  className?: string;
  sizes: string;
  priority?: boolean;
  width?: number;
  height?: number;
}) {
  return (
    <picture>
      <source
        type="image/avif"
        srcSet={artSrcSet(name, 'avif')}
        sizes={sizes}
      />
      <source
        type="image/webp"
        srcSet={artSrcSet(name, 'webp')}
        sizes={sizes}
      />
      <img
        className={className}
        src={`/assets/${name}-840.webp`}
        srcSet={artSrcSet(name, 'webp')}
        sizes={sizes}
        width={width}
        height={height}
        alt={alt}
        decoding="async"
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
    </picture>
  );
}

/** How wide Poli is drawn on the pages that show Poli large. */
export const POLI_SIZES = '(min-width: 768px) 560px, 92vw';

export function Poli({
  pose = 'welcome',
  className = '',
  priority = false,
  sizes = POLI_SIZES,
}: {
  pose?: string;
  className?: string;
  priority?: boolean;
  /**
   * How wide this Poli is drawn, so the browser fetches a file of that size.
   * Pages that draw Poli small (the lesson player) pass their own.
   */
  sizes?: string;
}) {
  return (
    <Art
      name={`poli-${pose}`}
      className={`poli ${className}`}
      sizes={sizes}
      priority={priority}
      width={900}
      height={900}
      alt={
        pose === 'welcome'
          ? 'Poli, your cream-colored markhor buddy with violet horns and an orange bag'
          : ''
      }
    />
  );
}
