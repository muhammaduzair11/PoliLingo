import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import {
  AccountView,
  type AccountRole,
} from '@/components/account/account-view';
import { ProfileSetup } from '@/components/account/profile-setup';
import { Notice } from '@/components/console/notice';
import { Footer, Header } from '@/components/site-chrome';
import { getAccess, hasRole, type MyContext } from '@/lib/console/access';
import { signInPath } from '@/lib/console/paths';
import { safeNext } from '@/lib/safe-next';
import {
  declareAgeBand,
  deleteMyAccount,
  exportMyData,
  signOutHere,
} from './actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};

const LANGUAGE_NAMES: Record<string, string> = {
  ps: 'Pashto',
  ur: 'Urdu',
  hno: 'Hindko',
};
const languageName = (code: string) =>
  LANGUAGE_NAMES[code] ?? code.toUpperCase();

/** The caller's roles in words, from my_context(). */
function rolesOf(context: MyContext): AccountRole[] {
  const roles: AccountRole[] = [];
  if (context.is_admin) roles.push({ key: 'admin', label: 'Admin' });
  else if (context.editor_languages === 'all')
    roles.push({ key: 'editor', label: 'Editor, every language' });
  else if (context.editor_languages.length > 0)
    roles.push({
      key: 'editor',
      label: `Editor, ${context.editor_languages.map(languageName).join(', ')}`,
    });
  for (const variety of context.review_varieties)
    roles.push({
      key: `reviewer-${variety.id}`,
      label: `Reviewer, ${variety.name}`,
    });
  return roles;
}

function workspaceFor(context: MyContext): string | null {
  if (hasRole(context, 'admin')) return '/admin';
  if (hasRole(context, 'reviewer')) return '/review';
  if (hasRole(context, 'editor')) return '/edit';
  return null;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main id="main-content" className="account-main">
        {children}
      </main>
      <Footer />
    </>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const continueTo = rawNext ? safeNext(rawNext, '') || null : null;
  const access = await getAccess();

  if (access.state === 'signed-out') redirect(signInPath('/account'));

  if (access.state === 'not-configured')
    return (
      <Frame>
        <section className="account-page section-wrap">
          <h1>Accounts aren’t switched on here</h1>
          <Notice tone="info" code="NOT_CONFIGURED">
            This copy of PoliLingo can’t sign anyone in. Learning works as
            usual, and your progress stays on this device.
          </Notice>
        </section>
      </Frame>
    );

  if (access.state === 'error')
    return (
      <Frame>
        <section className="account-page section-wrap">
          <h1>We couldn’t open your account</h1>
          <Notice tone="error" code={access.error.code}>
            {access.error.message}
          </Notice>
          <p className="account-actions">
            <Link className="button button-small button-purple" href="/account">
              Try again
            </Link>
            <Link className="button button-small button-outline" href="/learn">
              Back to learning
            </Link>
          </p>
        </section>
      </Frame>
    );

  const { context } = access;
  if (!context.profile)
    return (
      <Frame>
        <div className="account-setup">
          <ProfileSetup
            declareAgeBand={declareAgeBand}
            deleteMyAccount={deleteMyAccount}
          />
        </div>
      </Frame>
    );

  return (
    <Frame>
      <AccountView
        email={context.email}
        ageBand={context.profile.age_band}
        roles={rolesOf(context)}
        workspaceHref={workspaceFor(context)}
        isContributor={context.contributor !== null}
        continueTo={continueTo}
        exportMyData={exportMyData}
        deleteMyAccount={deleteMyAccount}
        signOutHere={signOutHere}
      />
    </Frame>
  );
}
