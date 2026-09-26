'use client';
/* oxlint-disable react/react-compiler -- Browser effects poll /api/release and hold the pending copy and the last seen hash in refs between polls. No React Compiler is configured. */
/**
 * Brings a newly published content release to a learner who already has the
 * app open (docs/platform.md 4.7). Mounted once, by LearningProvider.
 *
 * It asks /api/release whether the server's latest release differs from
 * what it has: once the app is ready, whenever the tab becomes visible
 * again, when the browser comes back online, and every minute while the tab
 * is visible. The server is authoritative (releaseStep() in
 * lib/release-verify.ts): a different copy is verified, stored for the next
 * visit (lib/release-cache.ts) and made active through the provider's
 * refreshContent(), which re-renders every screen; when the server vouches
 * for nothing newer than this build (the kill switch, say), the stored copy
 * is forgotten and the build's own content comes back.
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
  baselineCopy,
  learnerCopy,
  type LearnerCopy,
} from '@/lib/content';
import { forgetRelease, storeRelease } from '@/lib/release-cache';
import { releaseStep } from '@/lib/release-verify';

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
  // The copy to show once the learner leaves a lesson: a verified copy from
  // the server, or baselineCopy to go back to the build's own content.
  const pending = useRef<LearnerCopy | null>(null);
  // A contentHash to send as `known` instead of the active copy's: one this
  // build refused, or one that changes nothing, so it is not downloaded
  // again every minute. Null sends the active copy's own hash.
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
    if (!copy || inLesson(latest.current.pathname)) return;
    // Already showing it (a copy, then the baseline, both during a lesson).
    if (copy === learnerCopy) pending.current = null;
    else activate(copy);
  }

  async function check() {
    if (busy.current) return;
    busy.current = true;
    try {
      const active = pending.current ?? learnerCopy;
      const known = seen.current ?? active.contentHash;
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
      const step = releaseStep(await response.json(), active, baselineCopy);
      if (step.action === 'adopt') {
        seen.current = null;
        storeRelease(browserStorage(), step.copy);
        pending.current = step.copy;
      } else if (step.action === 'baseline') {
        seen.current = step.skip ?? null;
        forgetRelease(browserStorage());
        pending.current = baselineCopy;
      } else if (step.skip) seen.current = step.skip;
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
