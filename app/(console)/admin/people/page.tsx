import type { Metadata } from 'next';
import { Suspense } from 'react';
import {
  PeopleData,
  PeopleLoading,
} from '@/components/console/admin/people-data';
import { requireRole } from '@/lib/console/access';
import { createInvitation, revokeInvitation, revokeRole } from './actions';

export const metadata: Metadata = { title: 'People' };

/** /admin/people: the team, their roles, invitations (docs/platform.md 4.10). */
export default async function AdminPeoplePage() {
  const gate = await requireRole('admin');
  if (!gate.ok) return gate.view;
  return (
    <Suspense fallback={<PeopleLoading />}>
      <PeopleData
        createInvitation={createInvitation}
        revokeRole={revokeRole}
        revokeInvitation={revokeInvitation}
      />
    </Suspense>
  );
}
