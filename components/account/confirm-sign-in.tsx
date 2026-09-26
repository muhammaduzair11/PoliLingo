'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Card } from './sign-in-flow';

/**
 * /sign-in/confirm: the email's button opens this page, and nothing is
 * signed in until the person taps "Finish signing in" here. The tap POSTs
 * the link's token to /auth/confirm (app/auth/confirm/route.ts), which is
 * what uses it. The button locks after one tap: a second POST would find
 * the token used and say the link had expired.
 */
export function ConfirmSignIn({
  tokenHash,
  type,
  next,
  back,
}: {
  tokenHash: string;
  type: string;
  /** Already checked by safeNext(). */
  next: string;
  back: string;
}) {
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
    // Coming back with the browser's Back button shows this page from
    // memory, button still locked; unlock it.
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  return (
    <Card>
      <p className="eyebrow purple">ALMOST THERE</p>
      <h1 className="signin-title" tabIndex={-1} ref={heading}>
        Finish signing in
      </h1>
      <p className="signin-lead">
        Tap the button to sign in to PoliLingo in this browser. If you didn’t
        ask to sign in, close this page. Nothing happens until you tap.
      </p>
      <form
        className="signin-form"
        method="post"
        action="/auth/confirm"
        onSubmit={(event) => {
          if (busy) event.preventDefault();
          else setBusy(true);
        }}
      >
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="button button-purple full-width"
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
        >
          {busy ? 'Signing you in…' : 'Finish signing in'}
          {!busy && <ArrowRight size={19} />}
        </button>
        <output className="signin-hint">
          {busy ? 'Signing you in. This takes a moment.' : ''}
        </output>
      </form>
      <p className="signin-small">
        You can also type the 6-digit code from the same email on the page where
        you asked for it. <Link href={back}>Keep learning</Link> without signing
        in.
      </p>
    </Card>
  );
}
