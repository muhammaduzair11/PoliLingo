'use client';
import { X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type Announce = (message: ReactNode) => void;
type KeepFocus = (id: string | undefined) => void;

const AnnounceContext = createContext<{
  announce: Announce;
  keepFocus: KeepFocus;
} | null>(null);

/**
 * One polite live region at the top of the console's <main>: what the last
 * action did ("Invitation to … cancelled"), said once and left in view,
 * because the button that did it has often left the page by then. The
 * region is always in the page, so screen readers hear each new message;
 * it clears on the next page, or when dismissed.
 *
 * It also looks after focus once such a button has gone (keepFocus): it
 * lives above the page, so it outlasts the row that asked.
 */
export function ConsoleAnnouncer({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [message, setMessage] = useState<{ text: ReactNode; n: number }>({
    text: null,
    n: 0,
  });
  const [focusTarget, setFocusTarget] = useState<{
    id: string;
    n: number;
  } | null>(null);
  const [shownOn, setShownOn] = useState(pathname);
  const announce = useCallback<Announce>((text) => {
    setMessage((m) => ({ text, n: m.n + 1 }));
  }, []);
  const keepFocus = useCallback<KeepFocus>((id) => {
    if (id) setFocusTarget((t) => ({ id, n: (t?.n ?? 0) + 1 }));
  }, []);
  const value = useMemo(() => ({ announce, keepFocus }), [announce, keepFocus]);

  // A message belongs to the page it was said on.
  if (shownOn !== pathname) {
    setShownOn(pathname);
    if (message.text) setMessage((m) => ({ text: null, n: m.n }));
  }

  // Once the dialog has closed and the page has refreshed: if focus fell
  // to the page body (its trigger is gone), put it on the target, usually
  // the section heading. A trigger still on the page keeps focus.
  useEffect(() => {
    if (!focusTarget) return;
    const timers = [150, 450, 1000, 1800].map((ms) =>
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        document.getElementById(focusTarget.id)?.focus();
      }, ms),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [focusTarget]);

  return (
    <AnnounceContext value={value}>
      {/* <output> is a polite live region (role="status"). */}
      <output className="console-announcer" aria-live="polite">
        {message.text && (
          <span
            key={message.n}
            className="console-notice console-notice-success console-announcement"
          >
            <span className="console-announcement-text">{message.text}</span>
            <button
              type="button"
              className="console-announcement-close"
              aria-label="Dismiss"
              onClick={() => setMessage((m) => ({ text: null, n: m.n }))}
            >
              <X aria-hidden="true" size={18} />
            </button>
          </span>
        )}
      </output>
      {children}
    </AnnounceContext>
  );
}

/** Says something in the console's live region (a no-op outside one). */
export function useAnnounce(): Announce {
  return useContext(AnnounceContext)?.announce ?? noop;
}

/**
 * Puts focus on the element with this id once an action has removed its
 * own trigger (a cancelled invitation, an ended role), if focus was lost.
 * A no-op outside the console.
 */
export function useKeepFocus(): KeepFocus {
  return useContext(AnnounceContext)?.keepFocus ?? noop;
}

function noop() {}
