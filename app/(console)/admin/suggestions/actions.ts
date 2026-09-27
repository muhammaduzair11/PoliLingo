'use server';
/**
 * Accept or decline a reviewer's suggested fix (docs/platform.md 3.9 D).
 * Accepting applies it word for word with the reviewer as its author, which
 * sends the phrase back for review by someone else.
 */
import { revalidatePath } from 'next/cache';
import {
  actionRefusal,
  fromRpc,
  type ActionResult,
} from '@/lib/console/action-result';
import { adminSuggestionsPath, reviewQueuePath } from '@/lib/console/paths';
import { formText, isFingerprint } from '@/lib/console/review';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';

function refresh() {
  revalidatePath(adminSuggestionsPath());
  revalidatePath(reviewQueuePath(), 'layout');
}

export async function acceptSuggestion(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const id = formText(formData, 'suggestion_id');
  const seen = formText(formData, 'seen_fingerprint');
  if (!id || !isFingerprint(seen))
    return actionRefusal(
      'PL422_BAD_INPUT',
      'That suggestion could not be read. Reload the page and try again.',
    );
  const result = fromRpc(
    await callRpc(await serverSupabase(), 'accept_suggestion', {
      p_suggestion_id: id,
      p_seen_fingerprint: seen,
    }),
  );
  if (result.ok) refresh();
  return result;
}

export async function declineSuggestion(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const id = formText(formData, 'suggestion_id');
  const reason = formText(formData, 'reason');
  if (!id)
    return actionRefusal(
      'PL422_BAD_INPUT',
      'That suggestion could not be read. Reload the page and try again.',
    );
  if (!reason)
    return actionRefusal(
      'PL422_COMMENT_REQUIRED',
      'Please say why, so the reviewer knows.',
    );
  const result = fromRpc(
    await callRpc(await serverSupabase(), 'decline_suggestion', {
      p_suggestion_id: id,
      p_reason: reason,
    }),
  );
  if (result.ok) refresh();
  return result;
}
