import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AuthFrame } from '@/components/account/auth-frame';
import { ConfirmSignIn } from '@/components/account/confirm-sign-in';
import { Card } from '@/components/account/sign-in-flow';
import {
  EMAIL_LINK_COOKIE,
  emailLinkMatches,
  emailLinkNonce,
  emailLinkToken,
  emailLinkType,
  learnerBack,
  safeNext,
  signInHref,
} from '@/lib/safe-next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Finish signing in',
  robots: { index: false, follow: false },
  // The address holds the link's token: never send it on to another page.
  referrer: 'no-referrer',
};

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/**
 * Where the sign-in email's button ends up (via GET /auth/confirm, which
 * never uses the token itself). See components/account/confirm-sign-in.tsx.
 */
export default async function ConfirmSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(first(params.next));
  const back = learnerBack(next);
  const tokenHash = emailLinkToken(first(params.token_hash));
  const type = emailLinkType(first(params.type));
  const nonce = emailLinkNonce(first(params.n));
  // The link works only in the browser that asked for the code
  // (lib/safe-next.ts EMAIL_LINK_COOKIE).
  const thisBrowser = emailLinkMatches(
    (await cookies()).get(EMAIL_LINK_COOKIE)?.value,
    nonce,
  );

  return (
    <AuthFrame back={back}>
      {tokenHash && type && nonce && thisBrowser ? (
        <ConfirmSignIn
          tokenHash={tokenHash}
          type={type}
          nonce={nonce}
          next={next}
          back={back}
        />
      ) : tokenHash && type ? (
        <Card>
          <p className="eyebrow purple">SAVE YOUR PROGRESS</p>
          <h1 className="signin-title">
            Open this link where you asked for it
          </h1>
          <p className="signin-lead">
            This sign-in link only works in the browser where you asked for the
            code. Go back there and type the 6-digit code from the same email,
            or start again here.
          </p>
          <Link
            className="button button-purple full-width"
            href={signInHref(next)}
          >
            Sign in here instead <ArrowRight size={19} />
          </Link>
          <p className="signin-small">
            <Link href={back}>Keep learning</Link> without signing in.
          </p>
        </Card>
      ) : (
        <Card>
          <p className="eyebrow purple">SAVE YOUR PROGRESS</p>
          <h1 className="signin-title">This sign-in link isn’t complete</h1>
          <p className="signin-lead">
            Part of the link may have been cut off. Start again and we’ll send
            you a fresh code.
          </p>
          <Link
            className="button button-purple full-width"
            href={signInHref(next)}
          >
            Sign in again <ArrowRight size={19} />
          </Link>
        </Card>
      )}
    </AuthFrame>
  );
}
