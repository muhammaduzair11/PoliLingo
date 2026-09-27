'use client';
/* oxlint-disable react/react-compiler -- A mount effect subscribes to Supabase auth and publishes to the external account store. No React Compiler is configured. */
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { setAccount, useAccount } from '@/lib/account-store';
import { SIGNED_IN_PARAM } from '@/lib/safe-next';
import { browserSupabase } from '@/lib/supabase/browser';
import { SessionToast, takeFlag } from '../account-boot';
import { SyncAgent } from './sync-agent';

/**
 * The account runtime (docs/platform.md 4.6). components/account-boot.tsx
 * loads it with a dynamic import, and only when a session cookie is present,
 * so an anonymous visitor never downloads supabase-js.
 *
 * It creates the browser client, reads the session, follows every change
 * (sign-in in another tab, sign-out, a refresh that fails) and publishes who
 * is signed in to lib/account-store.ts, which the header chip and the finish
 * screen read. It never touches local progress. Without Supabase settings it
 * says "anonymous" and does nothing else.
 */
export default function AccountRuntime() {
  useEffect(() => {
    const supabase = browserSupabase();
    if (!supabase) {
      setAccount({ status: 'anonymous' });
      return;
    }
    let active = true;
    const publish = (session: Session | null) => {
      if (!active) return;
      const user = session?.user;
      if (user)
        setAccount({
          status: 'signed-in',
          userId: user.id,
          email: user.email ?? null,
        });
      else setAccount({ status: 'anonymous' });
    };
    // INITIAL_SESSION arrives through the listener too; asking directly as
    // well means a slow listener never leaves the chip unknown.
    supabase.auth
      .getSession()
      .then(({ data }) => publish(data.session))
      .catch(() => publish(null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => publish(session));
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  return (
    <>
      <SyncAgent />
      <SignedInToast />
    </>
  );
}

/**
 * "Signed in as …" on the page a sign-in lands on (?signed_in=1, added by
 * the sign-in flow: lib/safe-next.ts withSignedIn). The flag leaves the
 * address bar at once; the notice waits for the session's email.
 */
function SignedInToast() {
  const account = useAccount();
  const [flagged, setFlagged] = useState(false);
  const close = useCallback(() => setFlagged(false), []);
  useEffect(() => {
    if (takeFlag(SIGNED_IN_PARAM)) setFlagged(true);
  }, []);
  const message =
    flagged && account.status === 'signed-in'
      ? account.email
        ? `Signed in as ${account.email}. Your progress is saving.`
        : 'Signed in. Your progress is saving.'
      : null;
  return <SessionToast onClose={close}>{message}</SessionToast>;
}
