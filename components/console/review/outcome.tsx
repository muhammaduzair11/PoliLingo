'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Notice } from '@/components/console/notice';

type Announce = (message: ReactNode) => void;

const OutcomeContext = createContext<Announce | null>(null);

/**
 * Holds the confirmation of the last action taken inside it, above its
 * children. Use it where a successful action removes its own button from
 * the page (an accepted suggestion leaves the list, a countersigned review
 * stops waiting), so the confirmation outlives the refresh. Focus moves to
 * the confirmation, since the button that had it is gone.
 */
export function OutcomeProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: ReactNode; n: number }>({
    text: null,
    n: 0,
  });
  const ref = useRef<HTMLDivElement>(null);
  const announce = useCallback<Announce>(
    (text) => setMessage((m) => ({ text, n: m.n + 1 })),
    [],
  );

  useEffect(() => {
    if (message.n === 0) return;
    // After the dialog has closed and handed focus back.
    const frame = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [message.n]);

  return (
    <OutcomeContext value={announce}>
      <div ref={ref} tabIndex={-1} className="review-outcome">
        {message.text && (
          <Notice key={message.n} tone="success">
            {message.text}
          </Notice>
        )}
      </div>
      {children}
    </OutcomeContext>
  );
}

/** Shows a confirmation in the nearest OutcomeProvider (no-op outside one). */
export function useOutcome(): Announce {
  return useContext(OutcomeContext) ?? noop;
}

function noop() {}
