import type { Metadata } from 'next';
import { AuthFrame } from '@/components/account/auth-frame';
import { SignInFlow } from '@/components/account/sign-in-flow';
import { learnerBack, safeNext } from '@/lib/safe-next';
import { supabaseEnv } from '@/lib/supabase/env';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Save your PoliLingo progress and pick it up on any device.',
  robots: { index: false, follow: false },
};

/** What the callback routes put in ?error=, in plain words. */
const NOTICES: Record<string, string> = {
  link: 'That sign-in link has expired or was already used. Start again here.',
  browser:
    'That sign-in link only works in the browser where you asked for the code. Type the 6-digit code there, or start again here.',
  cancelled:
    'Google sign-in was cancelled. You can try again, or use your email.',
  profile:
    'You’re signed in, but we couldn’t finish setting up. Please try once more.',
};

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(first(params.next));
  const error = first(params.error);
  const back = learnerBack(next);
  return (
    <AuthFrame back={back}>
      <SignInFlow
        next={next}
        back={back}
        configured={supabaseEnv() !== null}
        notice={error && Object.hasOwn(NOTICES, error) ? NOTICES[error] : null}
      />
    </AuthFrame>
  );
}
