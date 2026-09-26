'use server';
/**
 * The invitation page's writes (docs/platform.md 3.9 C, 4.10). Opening the
 * page changes nothing; only pressing a button here does.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  actionError,
  actionOk,
  actionRefusal,
  fromRpc,
  type ActionResult,
} from '@/lib/console/action-result';
import { consoleHomeFor, isInviteToken } from '@/lib/console/invite-link';
import { invitePath, signInPath } from '@/lib/console/paths';
import { sentenceFor } from '@/lib/db-errors';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

const notFound = () =>
  actionRefusal(
    'PL404_INVITATION_NOT_FOUND',
    sentenceFor('PL404_INVITATION_NOT_FOUND') ??
      "We couldn't find that invitation.",
  );

/** Accepts the invitation, then opens the part of the workspace it grants. */
export async function acceptInvitation(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const token = text(formData, 'token');
  if (!isInviteToken(token)) return notFound();
  const result = await callRpc<{ role: string }>(
    await serverSupabase(),
    'accept_invitation',
    { p_token: token },
  );
  if (!result.ok) return fromRpc(result);
  revalidatePath('/', 'layout');
  redirect(consoleHomeFor(result.data.role));
}

/** Saves the age band of someone signed in with no profile yet (track A's ensure_profile). */
export async function declareAgeBand(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
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

/**
 * Signs out on this device (local progress is untouched) and returns the
 * sign-in path that brings the person back to this invitation. The browser
 * then does a full navigation, so the app boots again without the session.
 */
export async function switchAccount(
  _previous: ActionResult<{ next: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ next: string }>> {
  const token = text(formData, 'token');
  const supabase = await serverSupabase();
  if (supabase) {
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) return actionError(error);
    } catch (error) {
      return actionError(error);
    }
  }
  return actionOk({
    next: signInPath(isInviteToken(token) ? invitePath(token) : null),
  });
}

/** The account menu's sign-out on this page: this device only. */
export async function signOutHere(): Promise<ActionResult<null>> {
  const supabase = await serverSupabase();
  if (!supabase) return actionOk(null);
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    return error ? actionError(error) : actionOk(null);
  } catch (error) {
    return actionError(error);
  }
}
