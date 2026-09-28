import type { NextConfig } from 'next';
import { contentVersion, productionReleaseProblem } from './lib/content.ts';
import { contentRedirects } from './lib/redirects.ts';

// Production serves only a tagged content release (ADR-0028). A development
// build of content (content@YYYY.MM.dev+<sha>) stops a production build here;
// previews and local builds take it.
const problem = productionReleaseProblem(
  process.env.VERCEL_ENV,
  contentVersion,
);
if (problem) throw new Error(problem);

const nextConfig: NextConfig = {
  // Nothing needs to know which framework serves the site.
  poweredByHeader: false,
  experimental: {
    // A production build once shipped a stylesheet without the console and
    // account partials that app/globals.css imports, while clean builds had
    // them. Turbopack's build cache is on by default and the host restores it
    // between builds, so every build starts clean instead.
    // scripts/check-build-css.mjs stops a build that loses them again.
    turbopackFileSystemCacheForBuild: false,
  },
  // Plain safety headers on every response. The pages whose address carries
  // a secret (a sign-in link's token, an invitation) send no referrer at
  // all: a later rule setting the same header wins, so theirs come last.
  // Their pages also say so in a <meta name="referrer">.
  async headers() {
    const noReferrer = [{ key: 'Referrer-Policy', value: 'no-referrer' }];
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
      { source: '/auth/confirm', headers: noReferrer },
      { source: '/sign-in/confirm', headers: noReferrer },
      { source: '/invite/:token*', headers: noReferrer },
    ];
  },
  // Hindko's URLs while it is not shown (temporary), and the MVP's lesson URLs
  // to permanent lesson ids (permanent). Both come from the learner copy; see
  // lib/redirects.ts.
  async redirects() {
    return contentRedirects();
  },
};

export default nextConfig;
