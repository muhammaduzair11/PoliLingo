import type { NextConfig } from 'next';
import { ART_WIDTHS } from './lib/art-widths.mjs';

const nextConfig: NextConfig = {
  images: {
    loader: 'custom',
    loaderFile: './lib/art-loader.ts',
    deviceSizes: ART_WIDTHS,
    imageSizes: [],
  },
};

export default nextConfig;
