import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Hindko is hidden from learners until it has been reviewed
      // (lib/courses.ts). Old links land on /learn, which shows the language
      // picker to anyone without a visible course. Temporary (307), never
      // permanent, so browsers do not remember it and the links work again
      // the day Hindko returns.
      {
        source: '/:section(learn|lesson|onboarding)/hindko/:rest*',
        destination: '/learn',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
