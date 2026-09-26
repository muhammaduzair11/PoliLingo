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
  // Hindko's URLs while it is not shown (temporary), and the MVP's lesson URLs
  // to permanent lesson ids (permanent). Both come from the learner copy; see
  // lib/redirects.ts.
  async redirects() {
    return contentRedirects();
  },
};

export default nextConfig;
