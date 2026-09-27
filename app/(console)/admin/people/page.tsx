import type { Metadata } from 'next';
import { Suspense } from 'react';
import {
  PeopleData,
  PeopleLoading,
} from '@/components/console/admin/people-data';
import { requireRole } from '@/lib/console/access';
import { inviteFromQuery } from '@/lib/console/invite-link';
import { createInvitation, revokeInvitation, revokeRole } from './actions';

export const metadata: Metadata = { title: 'People' };

/**
 * /admin/people: the team, their roles, invitations (docs/platform.md 4.10).
 * ?invite=reviewer&variety=… (or ?invite=admin) opens the invite dialog on
 * that role, for links from the overview and the only-admin note.
 */
export default async function AdminPeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await requireRole('admin');
  if (!gate.ok) return gate.view;
  const invite = inviteFromQuery(await searchParams);
  return (
    <Suspense fallback={<PeopleLoading />}>
      <PeopleData
        createInvitation={createInvitation}
        revokeRole={revokeRole}
        revokeInvitation={revokeInvitation}
        invite={invite}
      />
    </Suspense>
  );
}
