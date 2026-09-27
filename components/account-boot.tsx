'use client';
/* oxlint-disable react/react-compiler -- The session hint and the one-time URL flags are read from the browser after mount, so the static HTML is the same for everyone. No React Compiler is configured. */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Check, X } from 'lucide-react';
import { setAccount } from '@/lib/account-store';
import { hasSessionHint } from '@/lib/auth-hint';
import { SIGNED_IN_PARAM } from '@/lib/safe-next';

// Loaded only when a session cookie is present, so an anonymous visitor
// never downloads supabase-js (docs/platform.md 4.5, 4.6). Keep this a
// dynamic import: tests/boundaries.test.mjs checks it.
const AccountRuntime = lazy(() => import('./account/runtime'));

/** Added by /account's Sign out, so the page it opens can say so. */
const SIGNED_OUT_PARAM = 'signed_out';

/** How long a session notice stays up, unless closed sooner. */
const TOAST_MS = 5000;

/**
 * Takes a one-time flag (`?name=1`) out of the address bar, keeping the
 * rest, so a reload or a shared link never repeats its notice. True when
 * the flag was there.
 */
export function takeFlag(name: string): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get(name) !== '1') return false;
  url.searchParams.delete(name);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  return true;
}

/**
 * A short notice at the bottom of the screen, announced politely. The live
 * region is always there, so the message is read when it appears; it
 * closes itself after about five seconds, or with its close button.
 */
export function SessionToast({
  children,
  onClose,
}: {
  /** The notice, or null for none. */
  children: ReactNode;
  /** Must be stable (useCallback), or the timer restarts on every render. */
  onClose: () => void;
}) {
  const open = children !== null && children !== undefined && children !== '';
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(onClose, TOAST_MS);
    return () => clearTimeout(timer);
  }, [open, onClose]);
  return (
    <output className="session-toast-region" aria-live="polite">
      {open && (
        <span className="session-toast">
          <span className="session-toast-mark" aria-hidden="true">
            <Check size={16} strokeWidth={3} />
          </span>
          <span className="session-toast-text">{children}</span>
          <button
            type="button"
            className="session-toast-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </span>
      )}
    </output>
  );
}

/**
 * Mounted once by app/layout.tsx inside LearningProvider. After mount: no
 * session cookie means anonymous, published to the account store at once;
 * a cookie loads the account runtime, which decides.
 *
 * It also says "Signed out" on the page Sign out opens (?signed_out=1).
 * "Signed in as …" is the runtime's, since only it knows the email.
 */
export function AccountBoot() {
  const [hint, setHint] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const close = useCallback(() => setSignedOut(false), []);
  useEffect(() => {
    if (hasSessionHint(document.cookie)) setHint(true);
    else {
      setAccount({ status: 'anonymous' });
      // A sign-in that did not stick has nobody to announce.
      takeFlag(SIGNED_IN_PARAM);
    }
    if (takeFlag(SIGNED_OUT_PARAM)) setSignedOut(true);
  }, []);
  return (
    <>
      <SessionToast onClose={close}>
        {signedOut ? 'Signed out. Your progress stays on this device.' : null}
      </SessionToast>
      {hint && (
        <Suspense fallback={null}>
          <AccountRuntime />
        </Suspense>
      )}
    </>
  );
}
