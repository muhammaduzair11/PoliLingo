'use server';
/**
 * The people page's writes (docs/platform.md 3.9 C, 4.3): invite someone,
 * end a role, cancel an invitation. Each calls one database function, which
 * decides whether the caller may; the result is always an ActionResult with
 * a sentence that is safe to show.
 */
import { revalidatePath } from 'next/cache';
import {
  actionRefusal,
  fromRpc,
  type ActionResult,
} from '@/lib/console/action-result';
import type { CreatedInvitation } from '@/components/console/admin/types';
import { endOfRoleTimestamp, isInviteRole } from '@/lib/console/invite-link';
import { adminOverviewPath, adminPeoplePath } from '@/lib/console/paths';
import { sentenceFor } from '@/lib/db-errors';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

const refuse = (code: string, fallback: string) =>
  actionRefusal(code, sentenceFor(code) ?? fallback);

function refresh() {
  revalidatePath(adminPeoplePath());
  revalidatePath(adminOverviewPath());
}

/** Invite someone to a role. Returns the one-time path; the token is never stored. */
export async function createInvitation(
  _previous: ActionResult<CreatedInvitation> | null,
  formData: FormData,
): Promise<ActionResult<CreatedInvitation>> {
  const role = text(formData, 'role');
  if (!isInviteRole(role))
    return refuse('PL422_BAD_SCOPE', 'Choose a role for this person.');
  const email = text(formData, 'email');
  if (!email) return refuse('PL422_BAD_EMAIL', 'Add their email address.');
  const days = Number.parseInt(text(formData, 'expires_in_days') || '7', 10);
  const endsOn = text(formData, 'grant_ends_on');
  const grantEndsAt = endsOn ? endOfRoleTimestamp(endsOn, new Date()) : null;
  if (endsOn && !grantEndsAt)
    return actionRefusal(
      'PL422_BAD_DATE',
      'Choose an end date after today, or leave it empty.',
    );
  const language = role === 'admin' ? '' : text(formData, 'language');
  const variety = role === 'language_reviewer' ? text(formData, 'variety') : '';
  const displayName = text(formData, 'display_name');

  const result = await callRpc<{
    invitation_id: string;
    path: string;
    expires_at: string;
  }>(await serverSupabase(), 'create_invitation', {
    p_role: role,
    p_email: email,
    p_language: language || null,
    p_variety: variety || null,
    p_display_name: displayName || null,
    p_expires_in_days: Number.isFinite(days) ? days : 7,
    p_grant_ends_at: grantEndsAt,
  });
  if (!result.ok) return fromRpc(result);
  refresh();
  return {
    ok: true,
    data: {
      invitation_id: result.data.invitation_id,
      path: result.data.path,
      expires_at: result.data.expires_at,
      role,
      email: email.toLowerCase(),
      display_name: displayName || null,
      language_name: text(formData, 'language_name') || null,
      variety_name: text(formData, 'variety_name') || null,
    },
  };
}

/** End a role now, or at the start of a chosen (UTC) day. */
export async function revokeRole(
  _previous: ActionResult<{ ends_at: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ ends_at: string }>> {
  const grantId = text(formData, 'grant_id');
  if (!grantId) return refuse('PL404_NOT_FOUND', 'We couldn’t find that role.');
  const when = text(formData, 'when');
  let effectiveAt: string | undefined;
  if (when === 'date') {
    const at = endOfRoleTimestamp(text(formData, 'end_date'), new Date());
    if (!at)
      return actionRefusal(
        'PL422_BAD_DATE',
        'Choose a date after today, or end the role now.',
      );
    effectiveAt = at;
  }
  const reason = text(formData, 'reason');
  const result = await callRpc<{ ends_at: string }>(
    await serverSupabase(),
    'revoke_role',
    {
      p_grant_id: grantId,
      ...(effectiveAt ? { p_effective_at: effectiveAt } : {}),
      p_reason: reason || null,
    },
  );
  if (result.ok) refresh();
  return fromRpc(result);
}

/** Cancel an invitation that has not been accepted: its link stops working. */
export async function revokeInvitation(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const id = text(formData, 'invitation_id');
  if (!id)
    return refuse('PL404_NOT_FOUND', 'We couldn’t find that invitation.');
  const result = await callRpc(await serverSupabase(), 'revoke_invitation', {
    p_invitation_id: id,
  });
  if (result.ok) refresh();
  return fromRpc(result);
}
