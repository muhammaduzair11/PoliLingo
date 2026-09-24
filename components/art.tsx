'use client';
import { ART_WIDTHS } from '@/lib/art-widths.mjs';
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
  const srcSet = (ext: string) =>
    ART_WIDTHS.map((w) => `/assets/${name}-${w}.${ext} ${w}w`).join(', ');
  return (
    <picture>
      <source type="image/avif" srcSet={srcSet('avif')} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet('webp')} sizes={sizes} />
      <img
        className={className}
        src={`/assets/${name}-840.webp`}
        srcSet={srcSet('webp')}
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

export function Poli({
  pose = 'welcome',
  className = '',
  priority = false,
}: {
  pose?: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Art
      name={`poli-${pose}`}
      className={`poli ${className}`}
      sizes="(min-width: 768px) 560px, 92vw"
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
