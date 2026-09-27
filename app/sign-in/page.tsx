import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { AuthFrame } from '@/components/account/auth-frame';
import { SignedInCard } from '@/components/account/signed-in-card';
import { SignInFlow } from '@/components/account/sign-in-flow';
import { AGE_BAND_COOKIE, parseAgeBand } from '@/lib/age-gate';
import { getAccess } from '@/lib/console/access';
import { learnerBack, safeNext } from '@/lib/safe-next';
import { supabaseEnv } from '@/lib/supabase/env';
import { signOutHere } from '../account/actions';

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
  profile: 'You’re signed in, but we couldn’t finish setting up. Try again.',
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
  const configured = supabaseEnv() !== null;

  // Already signed in, with a profile: say so instead of asking again.
  // Anything else (signed out, no profile yet, an error) gets the flow.
  const access = configured ? await getAccess() : null;
  if (access?.state === 'ready' && access.context.profile)
    return (
      <AuthFrame back={back}>
        <SignedInCard
          email={access.context.email}
          next={next}
          signOutHere={signOutHere}
        />
      </AuthFrame>
    );

  // An age answer from the last 30 minutes (set by this flow) is not asked
  // for again; the flow offers to change it.
  const rememberedBand = parseAgeBand(
    (await cookies()).get(AGE_BAND_COOKIE)?.value,
  );
  return (
    <AuthFrame back={back}>
      <SignInFlow
        next={next}
        back={back}
        configured={configured}
        rememberedBand={rememberedBand}
        notice={error && Object.hasOwn(NOTICES, error) ? NOTICES[error] : null}
      />
    </AuthFrame>
  );
}
