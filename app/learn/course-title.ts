import type { Metadata } from 'next';
import { baselineCourses } from '@/lib/content';

/**
 * The browser title for a course's pages (/learn/<slug>, /onboarding/<slug>):
 * "Pashto · PoliLingo". The server knows only the committed release, so a
 * course published after the build, or an unknown slug, gets plain
 * "PoliLingo" rather than a 404: the page itself decides in the browser.
 */
export function courseTitle(slug: string): Metadata['title'] {
  const name = baselineCourses.find((c) => c.id === slug)?.name;
  return name ?? { absolute: 'PoliLingo' };
}
