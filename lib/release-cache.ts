/**
 * The browser's copy of a newer content release (docs/platform.md 4.7).
 *
 * The committed learner copy (content/release.json) is the baseline every
 * build ships with. When an admin publishes in the app, the refresher
 * (components/release-refresher.tsx) fetches the new learner copy, verifies
 * it and keeps it here, under polilingo.content.release, so the next visit
 * starts from it rather than from the baseline.
 *
 * A stored copy is tied to the Supabase project it came from: the value is
 * `{ source, copy }`, where `source` is the project URL. A browser that has
 * run the app against one project (a local fixture stack, say) and then
 * against another never shows the first project's copy, even when both
 * hold a release of the same name.
 *
 * Nothing here may cost a learner their place: a stored copy that cannot be
 * read, parsed or verified is ignored, a full or blocked storage is shrugged
 * off, and none of these functions throws. Progress (completions, XP,
 * activity) is never touched; only unfinished runs that the active release
 * can no longer continue are dropped, exactly as loading does.
 */
import {
  activateRelease,
  baselineCopy,
  contentVersion,
  lessonSize,
  type LearnerCopy,
} from './content.ts';
import type { ProgressState, Session, StorageLike } from './progress.ts';
import { isNewerRelease, verifyLearnerCopy } from './release-verify.ts';

export const RELEASE_STORAGE_KEY = 'polilingo.content.release';

/** Storage that may also remove a key, as the browser's does. */
type ReleaseStorage = StorageLike & { removeItem?: (key: string) => void };

/**
 * Where this build's published releases come from: the Supabase project
 * URL, or null without Supabase settings (then no release is ever fetched,
 * and none stored earlier is shown). Read literally, like lib/supabase/env.ts,
 * so Next inlines it; learner code may not import that module.
 */
export function releaseSource(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? url : null;
}

/**
 * Activates the stored learner copy when it came from `source` (this
 * build's Supabase project), verifies and is newer than the baseline this
 * build ships with, and returns the active release's name. Called once,
 * from the provider's mount effect, before progress is hydrated. A copy
 * that is missing, corrupt, refused, from another project or not newer (say
 * the app has since been rebuilt with a later baseline) leaves the active
 * copy as it is.
 */
export function activateCachedRelease(
  storage: StorageLike | null,
  source: string | null = releaseSource(),
): string {
  try {
    const raw = source ? storage?.getItem(RELEASE_STORAGE_KEY) : null;
    if (raw) {
      const stored: unknown = JSON.parse(raw);
      if (
        stored &&
        typeof stored === 'object' &&
        'source' in stored &&
        stored.source === source &&
        'copy' in stored
      ) {
        const verified = verifyLearnerCopy(stored.copy);
        if (
          verified.ok &&
          isNewerRelease(verified.copy.release, baselineCopy.release)
        )
          activateRelease(verified.copy);
      }
    }
  } catch {
    // Unreadable storage or JSON that does not parse: keep what is active.
  }
  return contentVersion;
}

/**
 * Keeps a verified learner copy from `source` for the next visit. A full or
 * blocked storage only means the next visit starts from the baseline and
 * fetches the copy again.
 */
export function storeRelease(
  storage: StorageLike | null,
  copy: LearnerCopy,
  source: string | null = releaseSource(),
): void {
  if (!storage || !source) return;
  try {
    storage.setItem(RELEASE_STORAGE_KEY, JSON.stringify({ source, copy }));
  } catch {
    // The next visit fetches it again.
  }
}

/**
 * Forgets the stored copy, so the next visit starts from the baseline: the
 * server no longer vouches for it (the kill switch, or a release that is
 * not newer than this build's content).
 */
export function forgetRelease(storage: ReleaseStorage | null): void {
  if (!storage) return;
  try {
    if (storage.removeItem) storage.removeItem(RELEASE_STORAGE_KEY);
    else storage.setItem(RELEASE_STORAGE_KEY, '');
  } catch {
    // Blocked storage: a stale copy is still refused once the server answers.
  }
}

/**
 * `state` without the unfinished runs the active release cannot continue:
 * a run indexes into its lesson's exercises, so it is dropped when the
 * lesson has gone or now has another number of exercises, as loading does
 * (playable() in lib/progress.ts). Finished runs, completions, XP, activity
 * and everything else are kept as they are. Returns `state` itself when
 * nothing is dropped, so an update that changes nothing writes nothing.
 */
export function fitSessions(state: ProgressState): ProgressState {
  const kept: Record<string, Session> = {};
  let dropped = false;
  for (const [key, run] of Object.entries(state.sessions)) {
    if (run.done || lessonSize(key) === run.size) kept[key] = run;
    else dropped = true;
  }
  return dropped ? { ...state, sessions: kept } : state;
}
