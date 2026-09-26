import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AuthFrame } from '@/components/account/auth-frame';
import { ConfirmSignIn } from '@/components/account/confirm-sign-in';
import { Card } from '@/components/account/sign-in-flow';
import {
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

  return (
    <AuthFrame back={back}>
      {tokenHash && type ? (
        <ConfirmSignIn
          tokenHash={tokenHash}
          type={type}
          next={next}
          back={back}
        />
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
