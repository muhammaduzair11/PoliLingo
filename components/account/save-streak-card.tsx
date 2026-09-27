'use client';
import Link from 'next/link';
import { useId, useSyncExternalStore } from 'react';
import { Flame, X } from 'lucide-react';
import { useAccount } from '@/lib/account-store';
import { signInHref } from '@/lib/safe-next';
import { accountsEnabled } from './accounts-enabled';

/** Remembered per browser once the learner says "Not now". */
export const SAVE_PROMPT_DISMISSED_KEY = 'polilingo.ui.save-prompt-dismissed';

// A tiny store over one localStorage key, so dismissing re-renders at once
// and a key that cannot be read (private mode, blocked storage) simply means
// "not dismissed" for this visit.
const listeners = new Set<() => void>();
let dismissedThisVisit = false;
function readDismissed(): boolean {
  if (dismissedThisVisit) return true;
  try {
    return localStorage.getItem(SAVE_PROMPT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}
function dismiss() {
  dismissedThisVisit = true;
  try {
    localStorage.setItem(SAVE_PROMPT_DISMISSED_KEY, '1');
  } catch {
    // Remembered for this visit only.
  }
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * On the lesson finish screen: an anonymous learner with a streak of two
 * days or more is offered an account to keep it (docs/platform.md 4.8).
 * Never before the first completed lesson, never to someone signed in, and
 * never again once dismissed on this browser. Signing in comes back to the
 * course's map.
 */
export function SaveStreakCard({
  streak,
  completedCount,
  mapHref,
}: {
  streak: number;
  completedCount: number;
  mapHref: string;
}) {
  const account = useAccount();
  const titleId = useId();
  // The server renders it dismissed, so it only ever appears after mount.
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);
  if (
    !accountsEnabled ||
    account.status !== 'anonymous' ||
    streak < 2 ||
    completedCount < 1 ||
    dismissed
  )
    return null;
  return (
    <aside className="save-streak" aria-labelledby={titleId}>
      <span className="save-streak-icon" aria-hidden="true">
        <Flame size={22} />
      </span>
      <div className="save-streak-copy">
        <h2 id={titleId}>Keep your {streak}-day streak safe</h2>
        <p>
          It lives on this device for now. Sign in to save it and pick up on any
          device.
        </p>
        <Link
          className="button button-small button-yellow"
          href={signInHref(mapHref)}
        >
          Save your streak — sign in
        </Link>
      </div>
      <button
        type="button"
        className="icon-button save-streak-dismiss"
        aria-label="Not now"
        title="Not now"
        onClick={dismiss}
      >
        <X size={18} />
      </button>
    </aside>
  );
}
