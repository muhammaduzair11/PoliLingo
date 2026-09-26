import type { ActionResult } from '@/lib/console/action-result';
import { tomorrowUtc } from '@/lib/console/invite-link';
import { adminPeoplePath } from '@/lib/console/paths';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';
import { PageHeader } from '../page-header';
import { InviteDialog } from './invite-dialog';
import { AdminSkeleton, LoadError } from './load-state';
import { PeopleView } from './people-view';
import type { CreatedInvitation, PeoplePage } from './types';

type FormAction<T> = (
  previous: ActionResult<T> | null,
  formData: FormData,
) => Promise<ActionResult<T>>;

const TITLE = 'People';
const DESCRIPTION =
  'Everyone on the PoliLingo team, what each person can do, and the invitations still waiting.';

/** The page header and a skeleton, while page_admin_people() loads. */
export function PeopleLoading() {
  return (
    <>
      <PageHeader eyebrow="Admin" title={TITLE} description={DESCRIPTION} />
      <AdminSkeleton label="Loading the team…" variant="people" />
    </>
  );
}

/** Loads page_admin_people() and renders the team; streamed behind PeopleLoading. */
export async function PeopleData({
  createInvitation,
  revokeRole,
  revokeInvitation,
}: {
  createInvitation: FormAction<CreatedInvitation>;
  revokeRole: FormAction<{ ends_at: string }>;
  revokeInvitation: FormAction<unknown>;
}) {
  const result = await callRpc<PeoplePage>(
    await serverSupabase(),
    'page_admin_people',
  );
  if (!result.ok)
    return (
      <>
        <PageHeader eyebrow="Admin" title={TITLE} description={DESCRIPTION} />
        <LoadError
          error={result.error}
          retryHref={adminPeoplePath()}
          what="the team"
        />
      </>
    );
  const minEndDate = tomorrowUtc(new Date(result.data.now));
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={TITLE}
        description={DESCRIPTION}
        actions={
          <InviteDialog
            action={createInvitation}
            languages={result.data.languages}
            minEndDate={minEndDate}
          />
        }
      />
      <PeopleView
        page={result.data}
        minEndDate={minEndDate}
        revokeRole={revokeRole}
        revokeInvitation={revokeInvitation}
      />
    </>
  );
}
