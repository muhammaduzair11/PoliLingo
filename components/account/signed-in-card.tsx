'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { ArrowRight, LogOut } from 'lucide-react';
import { Notice } from '@/components/console/notice';
import type { ActionResult } from '@/lib/console/action-result';
import { AGE_BAND_COOKIE } from '@/lib/age-gate';
import { Card } from './sign-in-flow';

/**
 * /sign-in for someone who is already signed in (with a profile): say who,
 * and offer the two things they can mean. "Use a different account" signs
 * out on this device only, forgets any age answer given here, and loads
 * the page again, which then starts the normal flow. Local progress is
 * untouched either way.
 */
export function SignedInCard({
  email,
  next,
  signOutHere,
}: {
  email: string | null;
  /** Already checked by safeNext(). */
  next: string;
  signOutHere: () => Promise<ActionResult<null>>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ text: string; code: string } | null>(
    null,
  );
  return (
    <Card pose="welcome" says="Welcome back!">
      <p className="eyebrow purple">ALREADY SIGNED IN</p>
      <h1 className="signin-title">You’re all set</h1>
      <p className="signin-lead">
        {email ? (
          <>
            You’re signed in as{' '}
            <strong className="signin-email">{email}</strong>.
          </>
        ) : (
          'You’re signed in.'
        )}{' '}
        Your progress saves to your account as you learn.
      </p>
      <Link className="button button-purple full-width" href={next}>
        Continue <ArrowRight size={19} aria-hidden="true" />
      </Link>
      <button
        type="button"
        className="button button-outline full-width"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await signOutHere();
            if (!result.ok) {
              setError({ text: result.message, code: result.code });
              return;
            }
            // The next person answers the age question for themselves.
            document.cookie = `${AGE_BAND_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
            // A full page load, so the app starts again without the session.
            window.location.reload();
          })
        }
      >
        <LogOut size={18} aria-hidden="true" />
        {pending ? 'Signing out…' : 'Use a different account'}
      </button>
      {error && (
        <Notice tone="error" code={error.code}>
          {error.text}
        </Notice>
      )}
    </Card>
  );
}
