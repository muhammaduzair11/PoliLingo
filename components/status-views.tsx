'use client';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Mountain } from 'lucide-react';
import { courses, type Course } from '@/lib/content';
import { courseProgress } from '@/lib/learning-map';
import { Poli } from './art';
import { useLearning } from './learning-provider';
import { Header } from './site-chrome';
/**
 * While stored progress loads. The header is the one the page will have, so
 * nothing above the content moves when it arrives.
 */
export function Loading() {
  return (
    <>
      <Header />
      <main id="main-content" className="loading-page" aria-busy="true">
        <div className="loading-mark">
          <Mountain size={42} />
        </div>
        <p>Getting your adventure ready…</p>
      </main>
    </>
  );
}
/**
 * Any address that leads nowhere: a mistyped page, an old link, a course or
 * lesson the release does not hold. It offers each visible language.
 */
export function NotFoundView() {
  const { state } = useLearning();
  // A language the learner has begun opens its map; any other starts at its
  // first step, as from the home page.
  const href = (c: Course) =>
    state.selected === c.id || courseProgress(state.completed, c).done > 0
      ? `/learn/${c.id}`
      : `/onboarding/${c.id}`;
  return (
    <>
      <Header />
      <main id="main-content" className="empty-page">
        <Poli pose="thinking" />
        <h1>A little off the trail.</h1>
        <p>This page wandered off the trail. Let’s find you a good one.</p>
        {courses.length > 0 && (
          <nav className="empty-languages" aria-label="Start a language">
            {courses.map((c) => (
              <Link key={c.id} href={href(c)} className="button button-outline">
                {c.name}
                <span className="native" lang={c.lang} dir={c.dir}>
                  {c.native}
                </span>
                <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
            ))}
          </nav>
        )}
        <Link href="/" className="button button-purple">
          Back to the start <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </main>
    </>
  );
}
