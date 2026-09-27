'use client';
import { useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { setAccount } from '@/lib/account-store';
import { Card, UnderThirteen } from './sign-in-flow';

/** Stable, so the heading takes focus once, when it mounts. */
const focusOnMount = (node: HTMLHeadingElement | null) => node?.focus();

/** A full page load, so nothing of the old session stays in memory. */
function keepLearning() {
  window.location.assign('/learn');
}

/**
 * /sign-in/goodbye: after deleteMyAccount (app/account/actions.ts). The
 * session is already gone; this tells the header chip and the finish
 * screen so at once, and never touches the progress on this device.
 *
 *   deleted  the account was deleted from /account
 *   age      someone under 13 answered the age question after signing in
 *            (ProfileSetup): the new sign-in was removed and nothing kept
 */
export function Goodbye({ reason }: { reason: 'deleted' | 'age' }) {
  useEffect(() => {
    setAccount({ status: 'anonymous' });
  }, []);

  if (reason === 'age')
    return (
      <UnderThirteen
        headingRef={focusOnMount}
        lead="Accounts are for people 13 and over, so we removed the sign-in and kept nothing. Your lessons, XP and streak are still saved on this device."
      >
        <button
          type="button"
          className="button button-purple full-width"
          onClick={keepLearning}
        >
          Keep learning <ArrowRight size={19} aria-hidden="true" />
        </button>
      </UnderThirteen>
    );

  return (
    <Card pose="welcome" says="Your progress here is still yours.">
      <p className="eyebrow purple">ACCOUNT DELETED</p>
      <h1 className="signin-title" tabIndex={-1} ref={focusOnMount}>
        Your account is gone.
      </h1>
      <p className="signin-lead">
        Everything saved to it has been deleted. Your progress on this device is
        still here, and you can keep learning without an account.
      </p>
      <button
        type="button"
        className="button button-purple full-width"
        onClick={keepLearning}
      >
        Keep learning <ArrowRight size={19} aria-hidden="true" />
      </button>
    </Card>
  );
}
