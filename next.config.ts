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
  experimental: {
    // A production build once shipped a stylesheet without the console and
    // account partials that app/globals.css imports, while clean builds had
    // them. Turbopack's build cache is on by default and the host restores it
    // between builds, so every build starts clean instead.
    // scripts/check-build-css.mjs stops a build that loses them again.
    turbopackFileSystemCacheForBuild: false,
  },
  // Hindko's URLs while it is not shown (temporary), and the MVP's lesson URLs
  // to permanent lesson ids (permanent). Both come from the learner copy; see
  // lib/redirects.ts.
  async redirects() {
    return contentRedirects();
  },
};

export default nextConfig;
