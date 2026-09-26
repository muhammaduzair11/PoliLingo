import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AgeBandPanel } from '@/components/console/age-band-panel';
import {
  AcceptInvitation,
  SwitchAccount,
} from '@/components/console/admin/accept-invitation';
import {
  InvitationCard,
  InvitationProblem,
  type InvitationPeek,
} from '@/components/console/admin/invitation-card';
import { Notice } from '@/components/console/notice';
import { ConsoleShell } from '@/components/console/shell';
import { getAccess } from '@/lib/console/access';
import {
  consoleHomeFor,
  inviteRefusal,
  isInviteToken,
  type InviteRefusal,
} from '@/lib/console/invite-link';
import { invitePath, signInPath } from '@/lib/console/paths';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';
import {
  acceptInvitation,
  declareAgeBand,
  signOutHere,
  switchAccount,
} from './actions';

// Per person, never cached. Opening this page changes nothing: it reads the
// invitation (peek_invitation is a stable function) and waits for Accept.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your invitation',
  // The token is in the path: never send it on to another site.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

const GENERIC: InviteRefusal = {
  title: "We couldn't open this invitation",
  message: 'Something went wrong on our side. Nothing was changed.',
  next: 'Try again in a minute. If it keeps happening, ask the person who invited you.',
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!isInviteToken(token))
    return (
      <Frame>
        <InvitationProblem
          refusal={inviteRefusal('PL404_INVITATION_NOT_FOUND') ?? GENERIC}
        />
      </Frame>
    );

  const access = await getAccess();
  if (access.state === 'signed-out') redirect(signInPath(invitePath(token)));
  if (access.state === 'not-configured')
    return (
      <Frame>
        <section className="invite-card">
          <h1 className="invite-title">
            Invitations can&apos;t be opened here
          </h1>
          <Notice tone="warning" code="NOT_CONFIGURED">
            This copy of PoliLingo has no database settings. Open the link on
            the PoliLingo site instead.
          </Notice>
        </section>
      </Frame>
    );
  if (access.state === 'error')
    return (
      <Frame>
        <InvitationProblem
          refusal={{ ...GENERIC, message: access.error.message }}
          code={access.error.code}
          action={<RetryLink token={token} />}
        />
      </Frame>
    );

  const { context } = access;
  const frame = (children: ReactNode) => (
    <Frame
      account={{
        email: context.email,
        name: context.contributor?.display_name ?? null,
      }}
    >
      {children}
    </Frame>
  );

  const peek = await callRpc<InvitationPeek>(
    await serverSupabase(),
    'peek_invitation',
    { p_token: token },
  );
  if (!peek.ok)
    return frame(
      <InvitationProblem
        refusal={
          inviteRefusal(peek.error.code) ?? {
            ...GENERIC,
            message: peek.error.message,
          }
        }
        code={peek.error.code}
        action={
          inviteRefusal(peek.error.code) ? undefined : (
            <RetryLink token={token} />
          )
        }
      />,
    );

  const invitation = peek.data;
  const home = consoleHomeFor(invitation.role);

  if (invitation.status === 'used' && invitation.accepted_by_you)
    return frame(
      <InvitationProblem
        refusal={{
          title: "You've already joined",
          message: 'You accepted this invitation, so your workspace is ready.',
          next: 'Carry on where you left off.',
        }}
        action={
          <Link className="console-button console-button-primary" href={home}>
            Open the workspace
          </Link>
        }
      />,
    );
  if (invitation.status !== 'open') {
    const code =
      invitation.status === 'revoked'
        ? 'PL410_INVITATION_REVOKED'
        : invitation.status === 'expired'
          ? 'PL410_INVITATION_EXPIRED'
          : 'PL410_INVITATION_USED';
    return frame(
      <InvitationProblem refusal={inviteRefusal(code) ?? GENERIC} />,
    );
  }

  // The same order as accept_invitation: the address first, then the age.
  if (!invitation.email_matches) {
    const wrong = inviteRefusal('PL403_WRONG_EMAIL') ?? GENERIC;
    return frame(
      <InvitationCard invitation={invitation}>
        <Notice tone="warning" title={wrong.title}>
          <p>
            You&apos;re signed in as <strong>{context.email}</strong>, but this
            invitation is for <strong>{invitation.email_masked}</strong>.
          </p>
          <p>{wrong.next}</p>
        </Notice>
        <SwitchAccount action={switchAccount} token={token} />
      </InvitationCard>,
    );
  }

  // The age question below holds this page's h1, so the card takes an h2.
  if (!context.profile)
    return frame(
      <div className="invite-stack">
        <InvitationCard invitation={invitation} headingLevel={2}>
          <p className="invite-next">
            One question below first, then you can accept.
          </p>
        </InvitationCard>
        <AgeBandPanel action={declareAgeBand} />
      </div>,
    );

  if (context.profile.age_band !== '18+')
    return frame(
      <InvitationProblem
        refusal={inviteRefusal('PL403_UNDER_18') ?? GENERIC}
      />,
    );

  return frame(
    <InvitationCard invitation={invitation}>
      <AcceptInvitation
        action={acceptInvitation}
        token={token}
        role={invitation.role}
      />
      <p className="console-hint invite-small">
        Accepting adds this role to the account you&apos;re signed in with,{' '}
        {context.email}. You can leave the team at any time.
      </p>
    </InvitationCard>,
  );
}

function Frame({
  account,
  children,
}: {
  account?: { email: string | null; name: string | null };
  children: ReactNode;
}) {
  return (
    <ConsoleShell account={account} signOut={account ? signOutHere : undefined}>
      <div className="invite-page">{children}</div>
    </ConsoleShell>
  );
}

function RetryLink({ token }: { token: string }) {
  return (
    <Link
      className="console-button console-button-outline"
      href={invitePath(token)}
    >
      Try again
    </Link>
  );
}
