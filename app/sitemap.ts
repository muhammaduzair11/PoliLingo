import type { MetadataRoute } from 'next';
import { courses } from '@/lib/content';
import { SITE_URL } from '@/lib/site';

// The public pages: home, one learning map per language the release holds, and
// the legal pages.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, priority: 1 },
    ...courses.map((course) => ({
      url: `${SITE_URL}/learn/${course.id}`,
      priority: 0.8,
    })),
    { url: `${SITE_URL}/privacy`, priority: 0.3 },
    { url: `${SITE_URL}/terms`, priority: 0.3 },
  ];
}
