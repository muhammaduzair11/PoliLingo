'use client';
/* oxlint-disable react/react-compiler -- Browser effects poll /api/release and hold the pending copy and the last seen hash in refs between polls. No React Compiler is configured. */
/**
 * Brings a newly published content release to a learner who already has the
 * app open (docs/platform.md 4.7). Mounted once, by LearningProvider.
 *
 * It asks /api/release whether there is anything newer than what it has:
 * once the app is ready, whenever the tab becomes visible again, when the
 * browser comes back online, and every minute while the tab is visible. A
 * newer copy is verified (lib/release-verify.ts), stored for the next visit
 * (lib/release-cache.ts) and made active through the provider's
 * refreshContent(), which re-renders every screen.
 *
 * Never in the middle of a lesson: the player indexes into the lesson's
 * exercises, so a copy that arrives on /lesson/… waits until the learner
 * leaves the lesson, and the screen they come back to shows it.
 *
 * Nothing here throws or shows an error: offline, a failed request or a
 * refused copy all mean the learner keeps the content they have, and the
 * next poll tries again.
 */
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useLearning } from './learning-provider';
import {
  activateRelease,
  contentVersion,
  learnerCopy,
  type LearnerCopy,
} from '@/lib/content';
import { storeRelease } from '@/lib/release-cache';
import { newerCopyFrom } from '@/lib/release-verify';

const POLL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

const inLesson = (path: string | null) => !!path?.startsWith('/lesson/');

function browserStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function ReleaseRefresher() {
  const { ready, refreshContent } = useLearning();
  const pathname = usePathname();
  const [announcement, setAnnouncement] = useState('');
  // A verified newer copy waiting for the learner to leave a lesson.
  const pending = useRef<LearnerCopy | null>(null);
  // The newest contentHash the server has shown us, adopted or refused. It is
  // what we send as `known`, so a copy this build refuses is not downloaded
  // again every minute.
  const seen = useRef<string | null>(null);
  const busy = useRef(false);
  // The latest render's values, for listeners and timers set up once.
  const latest = useRef({ pathname, refreshContent });
  useEffect(() => {
    latest.current = { pathname, refreshContent };
  });

  function activate(copy: LearnerCopy) {
    pending.current = null;
    activateRelease(copy);
    latest.current.refreshContent(copy.release);
    setAnnouncement('Your lessons have been updated.');
  }

  function applyPendingIfFree() {
    const copy = pending.current;
    if (copy && !inLesson(latest.current.pathname)) activate(copy);
  }

  async function check() {
    if (busy.current) return;
    busy.current = true;
    try {
      const known = seen.current ?? learnerCopy.contentHash;
      const response = await fetch(
        `/api/release?known=${encodeURIComponent(known)}`,
        {
          cache: 'no-store',
          // Older browsers lack AbortSignal.timeout(); they just wait longer.
          signal:
            typeof AbortSignal.timeout === 'function'
              ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
              : undefined,
        },
      );
      if (!response.ok) return;
      const answer: unknown = await response.json();
      if (
        answer &&
        typeof answer === 'object' &&
        'contentHash' in answer &&
        typeof answer.contentHash === 'string'
      )
        seen.current = answer.contentHash;
      const copy = newerCopyFrom(
        answer,
        pending.current?.release ?? contentVersion,
      );
      if (!copy) return;
      storeRelease(browserStorage(), copy);
      pending.current = copy;
    } catch {
      // Offline, timed out, or not JSON: the next poll tries again.
    } finally {
      busy.current = false;
      applyPendingIfFree();
    }
  }

  // Once ready (a cached release is active by then), and from then on when
  // the tab is shown again, when the browser is back online, and every
  // minute while the tab is visible.
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const run = () => {
      if (live) void check();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    run();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', run);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, POLL_MS);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', run);
      window.clearInterval(timer);
    };
  }, [ready]);

  // A copy that arrived during a lesson becomes active once the learner has
  // left it.
  useEffect(() => {
    if (!inLesson(pathname)) applyPendingIfFree();
  }, [pathname]);

  return (
    <output className="sr-only" aria-live="polite">
      {announcement}
    </output>
  );
}
