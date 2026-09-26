/**
 * The browser's copy of a newer content release (docs/platform.md 4.7).
 *
 * The committed learner copy (content/release.json) is the baseline every
 * build ships with. When an admin publishes in the app, the refresher
 * (components/release-refresher.tsx) fetches the new learner copy, verifies
 * it and keeps it here, under polilingo.content.release, so the next visit
 * starts from it rather than from the baseline.
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

/**
 * Activates the stored learner copy when it verifies and is newer than the
 * baseline this build ships with, and returns the active release's name.
 * Called once, from the provider's mount effect, before progress is
 * hydrated. A copy that is missing, corrupt, refused or not newer (say the
 * app has since been rebuilt with a later baseline) leaves the active copy
 * as it is.
 */
export function activateCachedRelease(storage: StorageLike | null): string {
  try {
    const raw = storage?.getItem(RELEASE_STORAGE_KEY);
    if (raw) {
      const verified = verifyLearnerCopy(JSON.parse(raw));
      if (
        verified.ok &&
        isNewerRelease(verified.copy.release, baselineCopy.release)
      )
        activateRelease(verified.copy);
    }
  } catch {
    // Unreadable storage or JSON that does not parse: keep what is active.
  }
  return contentVersion;
}

/**
 * Keeps a verified learner copy for the next visit. Returns whether it was
 * stored: a full or blocked storage only means the next visit starts from
 * the baseline and fetches the copy again.
 */
export function storeRelease(
  storage: StorageLike | null,
  copy: LearnerCopy,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(RELEASE_STORAGE_KEY, JSON.stringify(copy));
    return true;
  } catch {
    return false;
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
