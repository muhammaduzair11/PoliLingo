'use server';
/**
 * The account page's server actions (docs/platform.md 4.3, 4.8). Each
 * returns an ActionResult; every refusal goes through describeDbError.
 * None of them touches local progress: that lives in the browser, and
 * stays there whatever happens to the account.
 */
import { revalidatePath } from 'next/cache';
import {
  actionError,
  actionOk,
  actionRefusal,
  fromRpc,
  type ActionResult,
} from '@/lib/console/action-result';
import { sentenceFor } from '@/lib/db-errors';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';

/** The age band for a signed-in person who has none yet (ensure_profile). */
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
  if (result.ok) revalidatePath('/account');
  return result;
}

/** Everything the database holds about the caller, for a JSON download. */
export async function exportMyData(): Promise<ActionResult<unknown>> {
  return fromRpc(await callRpc(await serverSupabase(), 'export_my_data'));
}

/**
 * Deletes the account (delete_my_account), then signs this device out.
 * Local progress is kept; the page tells the person so.
 */
export async function deleteMyAccount(
  _previous: ActionResult<null> | null,
  _formData: FormData,
): Promise<ActionResult<null>> {
  const supabase = await serverSupabase();
  const deleted = fromRpc(await callRpc(supabase, 'delete_my_account'));
  if (!deleted.ok) return deleted;
  try {
    // The user is gone, so the server may refuse the sign-out call; the
    // cookies are cleared either way.
    await supabase?.auth.signOut({ scope: 'local' });
  } catch {
    // Nothing to undo: the account no longer exists.
  }
  // No revalidatePath here: it would render /account again in this same
  // response with the session already gone, which redirects to /sign-in and
  // hides the farewell (or the under-13) screen. Both callers finish with a
  // full page load instead.
  return actionOk(null);
}

/** Signs out on this device only. Local progress is untouched. */
export async function signOutHere(): Promise<ActionResult<null>> {
  const supabase = await serverSupabase();
  if (!supabase) return actionOk(null);
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) return actionError(error);
  } catch (error) {
    return actionError(error);
  }
  // No revalidatePath, as in deleteMyAccount: the caller loads / afresh.
  return actionOk(null);
}
