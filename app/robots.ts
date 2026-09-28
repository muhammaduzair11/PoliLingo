import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// The workspace, accounts and invitations are per person; crawlers stay out.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
        '/review',
        '/edit',
        '/account',
        '/invite',
        '/auth',
        '/api',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
