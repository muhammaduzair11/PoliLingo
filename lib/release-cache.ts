/**
 * STUB (foundation). Track G replaces the bodies (docs/platform.md 4.7); the
 * signatures are final.
 *
 *   activateCachedRelease(storage) reads polilingo.content.release,
 *     verifies it, activates it when it is newer than the baseline and
 *     returns the active release name.
 *   storeRelease(storage, copy) keeps a verified copy for the next load.
 *   fitSessions(state) drops unfinished runs whose lesson size changed, as
 *     playable() does.
 *
 * Until then nothing is cached or activated: the baseline release is active
 * and every state is left exactly as it is.
 */
import { contentVersion, type LearnerCopy } from './content.ts';
import type { ProgressState, StorageLike } from './progress.ts';

export const RELEASE_STORAGE_KEY = 'polilingo.content.release';

export function activateCachedRelease(_storage: StorageLike | null): string {
  return contentVersion;
}

export function storeRelease(
  _storage: StorageLike | null,
  _copy: LearnerCopy,
): void {
  // Stub: nothing is stored yet.
}

export function fitSessions(state: ProgressState): ProgressState {
  return state;
}
