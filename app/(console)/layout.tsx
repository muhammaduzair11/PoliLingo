import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AgeBandPanel } from '@/components/console/age-band-panel';
import type { NavGroup } from '@/components/console/nav';
import { NoAccess } from '@/components/console/no-access';
import { Notice } from '@/components/console/notice';
import { ConsoleShell } from '@/components/console/shell';
import { getAccess, hasRole, type MyContext } from '@/lib/console/access';
import {
  actionError,
  actionOk,
  actionRefusal,
  fromRpc,
  type ActionResult,
} from '@/lib/console/action-result';
import {
  PATH_HEADER,
  adminOverviewPath,
  adminPeoplePath,
  adminPublishPath,
  adminSuggestionsPath,
  editTreePath,
  reviewQueuePath,
  signInPath,
} from '@/lib/console/paths';
import { sentenceFor } from '@/lib/db-errors';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';

// Every console page is per person: never prerendered, never cached.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Workspace',
  robots: { index: false, follow: false },
};

/** Saves the age band of a signed-in person with no profile (track A's ensure_profile). */
async function declareAgeBand(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  'use server';
  const band = formData.get('age_band');
  if (band !== '18+' && band !== '13-17')
    return actionRefusal(
      'PL422_BAD_AGE_BAND',
      sentenceFor('PL422_BAD_AGE_BAND') ?? 'Please choose an age band.',
    );
  const result = fromRpc(
    await callRpc(await serverSupabase(), 'ensure_profile', {
      p_age_band: band,
    }),
  );
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

/** Signs out on this device only. Local progress is untouched. */
async function signOut(): Promise<ActionResult<null>> {
  'use server';
  const supabase = await serverSupabase();
  if (!supabase) return actionOk(null);
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    return error ? actionError(error) : actionOk(null);
  } catch (error) {
    return actionError(error);
  }
}

/** Review for reviewers; Edit for editors and admins; Admin for admins. */
function navFor(context: MyContext): NavGroup[] {
  const groups: NavGroup[] = [];
  if (hasRole(context, 'reviewer'))
    groups.push({
      label: 'Review',
      items: [{ href: reviewQueuePath(), label: 'Queue' }],
    });
  if (hasRole(context, 'editor'))
    groups.push({
      label: 'Edit',
      // Editors accept or decline reviewers' suggestions too; admins find
      // Suggestions under Admin.
      items: context.is_admin
        ? [{ href: editTreePath(), label: 'Lessons' }]
        : [
            { href: editTreePath(), label: 'Lessons' },
            { href: adminSuggestionsPath(), label: 'Suggestions' },
          ],
    });
  if (hasRole(context, 'admin'))
    groups.push({
      label: 'Admin',
      items: [
        { href: adminOverviewPath(), label: 'Overview' },
        { href: adminPeoplePath(), label: 'People' },
        { href: adminSuggestionsPath(), label: 'Suggestions' },
        { href: adminPublishPath(), label: 'Publish' },
      ],
    });
  return groups;
}

export default async function ConsoleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await getAccess();
  if (access.state === 'signed-out') {
    const path = (await headers()).get(PATH_HEADER);
    redirect(signInPath(path ?? reviewQueuePath()));
  }
  if (access.state === 'not-configured')
    return (
      <ConsoleShell>
        <section className="console-panel">
          <h1>The workspace isn&apos;t set up here</h1>
          <Notice tone="warning" code="NOT_CONFIGURED">
            This copy of PoliLingo has no database settings, so the workspace
            can&apos;t open. Learning works as usual.
          </Notice>
        </section>
      </ConsoleShell>
    );
  if (access.state === 'error')
    return (
      <ConsoleShell>
        <NoAccess
          title="We couldn't open the workspace"
          reason={access.error}
        />
      </ConsoleShell>
    );

  const { context } = access;
  const account = {
    email: context.email,
    name: context.contributor?.display_name ?? null,
  };
  if (!context.profile)
    return (
      <ConsoleShell account={account} signOut={signOut}>
        <AgeBandPanel action={declareAgeBand} />
      </ConsoleShell>
    );
  return (
    <ConsoleShell nav={navFor(context)} account={account} signOut={signOut}>
      {children}
    </ConsoleShell>
  );
}
