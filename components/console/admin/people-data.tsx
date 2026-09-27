import type { ActionResult } from '@/lib/console/action-result';
import {
  liveLanguagesFirst,
  tomorrowUtc,
  type InviteRole,
} from '@/lib/console/invite-link';
import type { OverviewData } from '@/lib/console/overview';
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
  invite = null,
}: {
  createInvitation: FormAction<CreatedInvitation>;
  revokeRole: FormAction<{ ends_at: string }>;
  revokeInvitation: FormAction<unknown>;
  /** From ?invite=…: open the invite dialog on this role and variety. */
  invite?: { role: InviteRole; variety: string | null } | null;
}) {
  const supabase = await serverSupabase();
  // The overview read is only for the publish gates, so the invite form can
  // start on a language learners see. If it fails, the form keeps name order.
  const [result, overview] = await Promise.all([
    callRpc<PeoplePage>(supabase, 'page_admin_people'),
    callRpc<OverviewData>(supabase, 'page_admin_overview'),
  ]);
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
  const openLanguages = overview.ok
    ? new Set(
        (overview.data.languages ?? [])
          .filter((l) => l.publish_gate === 'open')
          .map((l) => l.code),
      )
    : null;
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={TITLE}
        description={DESCRIPTION}
        actions={
          <InviteDialog
            // A new ?invite=… link opens a fresh dialog on its choice.
            key={invite ? `${invite.role}:${invite.variety ?? ''}` : 'plain'}
            initial={invite}
            action={createInvitation}
            languages={liveLanguagesFirst(result.data.languages, openLanguages)}
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
