'use server';
/**
 * Publish's writes (docs/platform.md 4.3, 4.10). The database decides who
 * may publish and what goes in; these check the form, pass it through, map
 * refusals to plain sentences, and refresh what depends on the release.
 */
import { revalidatePath, updateTag } from 'next/cache';
import type {
  PublishCheck,
  PublishOutcome,
  PublishPageData,
  PublishResult,
  RollbackResult,
} from '@/components/console/publish/types';
import {
  actionOk,
  actionRefusal,
  fromRpc,
  type ActionResult,
} from '@/lib/console/action-result';
import { adminPublishPath } from '@/lib/console/paths';
import { readBackVerdict } from '@/lib/console/release-diff';
import { sentenceFor } from '@/lib/db-errors';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';

/**
 * The cache tag on the learner release fetch (app/api/release/route.ts).
 * updateTag, not revalidateTag: inside a server action it expires the tag
 * at once, so the next learner fetch waits for the new release instead of
 * being served the old one while it refreshes.
 */
const LEARNER_RELEASE_TAG = 'learner-release';

const HASH = /^sha256-[0-9a-f]{64}$/;
const RELEASE_NAME = /^content@\d{4}\.\d{2}\.\d{1,6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MAX = 500;

/** PostgREST's "no such function" and Postgres's "undefined function". */
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);

/** Codes after which the page is out of date and should show the new state. */
const STALE_PAGE = new Set([
  'PL409_RELEASE_CHANGED',
  'PL409_NOTHING_TO_PUBLISH',
]);

type Supabase = Awaited<ReturnType<typeof serverSupabase>>;

function refusal(code: string, fallback: string) {
  return actionRefusal(code, sentenceFor(code) ?? fallback);
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** public.get_learner_release() (track G). */
type LearnerRelease = {
  release?: string;
  contentHash?: string;
  payload?: unknown;
  unchanged?: boolean;
} | null;

/**
 * Reads a new release back and recomputes its contentHash here, so a copy
 * that the learner app's own check would refuse is caught at once. First as
 * learners get it (get_learner_release); when that isn't available, or live
 * updates are switched off, from the admin page's own read of the latest
 * release.
 */
async function readBack(
  supabase: Supabase,
  published: PublishResult,
): Promise<PublishCheck> {
  const learner = await callRpc<LearnerRelease>(
    supabase,
    'get_learner_release',
    { p_known_hash: null },
  );
  if (
    learner.ok &&
    learner.data?.payload &&
    learner.data.release === published.name
  )
    return readBackVerdict(
      learner.data.payload,
      learner.data.contentHash,
      published.contentHash,
    );
  const overlayOff = learner.ok && learner.data === null;

  const page = await callRpc<PublishPageData>(supabase, 'page_admin_publish');
  if (page.ok && page.data.latest?.name === published.name) {
    const verdict = readBackVerdict(
      page.data.latest.payload,
      page.data.latest.contentHash,
      published.contentHash,
    );
    if (verdict === 'mismatch') return 'mismatch';
    return overlayOff ? 'overlay_off' : 'verified';
  }
  return overlayOff ? 'overlay_off' : 'unavailable';
}

/** After a new release: learners' next fetch gets it, and this page shows it. */
function refreshAfterRelease() {
  updateTag(LEARNER_RELEASE_TAG);
  revalidatePath(adminPublishPath());
}

/** Publishes what the preview showed: the admin's expected content hash. */
export async function publishRelease(
  _previous: ActionResult<PublishOutcome> | null,
  formData: FormData,
): Promise<ActionResult<PublishOutcome>> {
  const expected = text(formData, 'expected_hash');
  const note = text(formData, 'note');
  if (!HASH.test(expected))
    return refusal(
      'PL422_BAD_INPUT',
      'Open the preview again, then publish what it shows.',
    );
  if (note.length > NOTE_MAX)
    return actionRefusal(
      'PL422_LENGTH',
      `Keep the note under ${NOTE_MAX} characters.`,
    );

  const supabase = await serverSupabase();
  const result = fromRpc(
    await callRpc<PublishResult>(supabase, 'publish_release', {
      p_expected_content_hash: expected,
      p_note: note || null,
    }),
  );
  if (!result.ok) {
    // A stale preview, or a publish that already happened: show the new state.
    if (STALE_PAGE.has(result.code)) revalidatePath(adminPublishPath());
    return result;
  }

  refreshAfterRelease();
  const check = await readBack(supabase, result.data);
  return actionOk({ ...result.data, check });
}

/**
 * Gives learners an earlier release's lessons again, as a new release
 * (public.rollback_release). A reason is required; it goes in the history.
 */
export async function rollbackRelease(
  _previous: ActionResult<PublishOutcome> | null,
  formData: FormData,
): Promise<ActionResult<PublishOutcome>> {
  const name = text(formData, 'release');
  const reason = text(formData, 'reason');
  if (!RELEASE_NAME.test(name))
    return refusal(
      'PL422_BAD_INPUT',
      'Choose a release from the history to go back to.',
    );
  if (!reason)
    return actionRefusal(
      'PL422_COMMENT_REQUIRED',
      'Say in a few words why learners should go back to it.',
    );
  if (reason.length > NOTE_MAX)
    return actionRefusal(
      'PL422_LENGTH',
      `Keep the reason under ${NOTE_MAX} characters.`,
    );

  const supabase = await serverSupabase();
  const result = fromRpc(
    await callRpc<RollbackResult>(supabase, 'rollback_release', {
      p_release_name: name,
      p_reason: reason,
    }),
  );
  if (!result.ok) {
    if (result.code === 'PL409_NOT_PUBLISHABLE')
      return actionRefusal(
        result.code,
        `${name} can't come back as it was: since then, some of its lessons were retired, held back by a publish gate, or replaced as starter content. Publish a fix instead.`,
      );
    if (STALE_PAGE.has(result.code)) revalidatePath(adminPublishPath());
    return result;
  }

  refreshAfterRelease();
  const check = await readBack(supabase, result.data);
  return actionOk({ ...result.data, check });
}

/** An admin's countersign on a sole reviewer's approval (track D's function). */
export async function countersignDecision(
  _previous: ActionResult<{ decision_id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ decision_id: string }>> {
  const decisionId = text(formData, 'decision_id');
  const comment = text(formData, 'comment');
  if (!UUID.test(decisionId))
    return refusal('PL422_BAD_INPUT', "Something in the form isn't right.");
  if (comment.length > 2000)
    return actionRefusal(
      'PL422_LENGTH',
      'Keep the comment under 2,000 characters.',
    );

  const result = await callRpc<unknown>(
    await serverSupabase(),
    'countersign_decision',
    { p_decision_id: decisionId, p_comment: comment || null },
  );
  if (!result.ok) {
    if (MISSING_FUNCTION.has(result.error.code))
      return actionRefusal(
        'NOT_AVAILABLE',
        "Countersigning isn't switched on in this workspace yet. Nothing was changed.",
      );
    return {
      ok: false,
      code: result.error.code,
      message: result.error.message,
    };
  }
  revalidatePath(adminPublishPath());
  return actionOk({ decision_id: decisionId });
}
