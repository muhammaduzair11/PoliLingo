'use server';
/**
 * Review writes (docs/platform.md 3.9 D, 4.3). Each is a server action that
 * calls one database function as the signed-in person; the database checks
 * the role, the variety, the author rule and the fingerprint the reviewer
 * saw. Refusals come back as plain English through describeDbError.
 *
 * Shared by the queue, the phrase page and the lesson page.
 */
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  actionRefusal,
  fromRpc,
  type ActionResult,
} from '@/lib/console/action-result';
import { adminSuggestionsPath, reviewQueuePath } from '@/lib/console/paths';
import {
  formText,
  parseDecisionForm,
  parseSuggestionForm,
  staleFromItemPage,
  type ItemPage,
  type LessonPage,
  type StaleSnapshot,
} from '@/lib/console/review';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';

export type DecisionResult = {
  decision_id: string;
  status: string;
  sole_reviewer: boolean;
  countersign_required: boolean;
};

/** An action result that, when the text went stale, says what it is now. */
export type ReviewActionResult<T> = ActionResult<T> & {
  stale?: StaleSnapshot;
};

function refreshReviewPages() {
  revalidatePath(reviewQueuePath(), 'layout');
  revalidatePath(adminSuggestionsPath());
}

/** Adds the target's current state to a PL409_STALE refusal. */
async function withStale<T>(
  supabase: SupabaseClient | null,
  targetType: 'item' | 'lesson',
  targetId: string,
  result: ActionResult<T>,
): Promise<ReviewActionResult<T>> {
  if (result.ok || result.code !== 'PL409_STALE') return result;
  if (targetType === 'item') {
    const page = await callRpc<ItemPage>(supabase, 'page_review_item', {
      p_item_id: targetId,
    });
    return page.ok
      ? { ...result, stale: staleFromItemPage(page.data) }
      : result;
  }
  const page = await callRpc<LessonPage>(supabase, 'page_review_lesson', {
    p_lesson_id: targetId,
  });
  return page.ok
    ? {
        ...result,
        stale: {
          review_fingerprint: page.data.lesson.review_fingerprint,
          revision_no: page.data.lesson.revision_no,
        },
      }
    : result;
}

/** Approve, request changes or reject a phrase or a lesson. */
export async function recordDecision(
  _previous: ActionResult<DecisionResult> | null,
  formData: FormData,
): Promise<ReviewActionResult<DecisionResult>> {
  const parsed = parseDecisionForm(formData);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  const supabase = await serverSupabase();
  const result = fromRpc(
    await callRpc<DecisionResult>(supabase, 'record_review_decision', {
      p_target_type: input.target_type,
      p_target_id: input.target_id,
      p_decision: input.decision,
      p_seen_fingerprint: input.seen_fingerprint,
      p_scope: input.scope,
      p_comment: input.comment,
    }),
  );
  if (result.ok) refreshReviewPages();
  return withStale(supabase, input.target_type, input.target_id, result);
}

/** An admin countersigns a sole reviewer's approval of their own text. */
export async function countersignDecision(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const decisionId = formText(formData, 'decision_id');
  if (!decisionId)
    return actionRefusal(
      'PL422_BAD_INPUT',
      'That review could not be read. Reload the page and try again.',
    );
  const result = fromRpc(
    await callRpc(await serverSupabase(), 'countersign_decision', {
      p_decision_id: decisionId,
      p_comment: formText(formData, 'comment'),
    }),
  );
  if (result.ok) refreshReviewPages();
  return result;
}

/** A reviewer suggests a fix; an editor or admin applies it later. */
export async function suggestFix(
  _previous: ActionResult<string> | null,
  formData: FormData,
): Promise<ReviewActionResult<string>> {
  const parsed = parseSuggestionForm(formData);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  const supabase = await serverSupabase();
  const result = fromRpc(
    await callRpc<string>(supabase, 'create_suggestion', {
      p_item_id: input.item_id,
      p_seen_fingerprint: input.seen_fingerprint,
      p_proposed: input.proposed,
      p_note: input.note,
    }),
  );
  if (result.ok) refreshReviewPages();
  return withStale(supabase, 'item', input.item_id, result);
}

/** The suggester takes their open suggestion back. */
export async function withdrawSuggestion(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const id = formText(formData, 'suggestion_id');
  if (!id)
    return actionRefusal(
      'PL422_BAD_INPUT',
      'That suggestion could not be read. Reload the page and try again.',
    );
  const result = fromRpc(
    await callRpc(await serverSupabase(), 'withdraw_suggestion', {
      p_suggestion_id: id,
    }),
  );
  if (result.ok) refreshReviewPages();
  return result;
}

/** A comment on a phrase or lesson, or a reply to one. */
export async function addComment(
  _previous: ActionResult<string> | null,
  formData: FormData,
): Promise<ActionResult<string>> {
  const targetType = formText(formData, 'target_type');
  const targetId = formText(formData, 'target_id');
  const body = formText(formData, 'body');
  if ((targetType !== 'item' && targetType !== 'lesson') || !targetId)
    return actionRefusal(
      'PL422_BAD_INPUT',
      'That comment could not be read. Reload the page and try again.',
    );
  if (!body) return actionRefusal('PL422_LENGTH', 'Write something first.');
  const result = fromRpc(
    await callRpc<string>(await serverSupabase(), 'add_review_comment', {
      p_target_type: targetType,
      p_target_id: targetId,
      p_body: body,
      p_parent_id: formText(formData, 'parent_id'),
    }),
  );
  if (result.ok) refreshReviewPages();
  return result;
}

/** An admin removes a comment's text; the entry stays in the history. */
export async function redactComment(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const id = formText(formData, 'comment_id');
  const reason = formText(formData, 'reason');
  if (!id)
    return actionRefusal(
      'PL422_BAD_INPUT',
      'That comment could not be read. Reload the page and try again.',
    );
  if (!reason)
    return actionRefusal(
      'PL422_COMMENT_REQUIRED',
      'Please say why this comment is being removed.',
    );
  const result = fromRpc(
    await callRpc(await serverSupabase(), 'redact_comment', {
      p_comment_id: id,
      p_reason: reason,
    }),
  );
  if (result.ok) refreshReviewPages();
  return result;
}
