/**
 * Who is signed in on this device, and how sync is going: a tiny external
 * store for useSyncExternalStore (docs/platform.md 4.6).
 *
 * The learner app reads it (the header chip, the finish screen's prompt)
 * without loading supabase-js. components/account-boot.tsx sets it to
 * anonymous when there is no session cookie; otherwise the account runtime,
 * loaded on demand, publishes the session here and the sync agent its status.
 *
 * It holds no progress and nothing here ever touches local progress: signing
 * in, out, or switching accounts only changes this record.
 */
import { useSyncExternalStore } from 'react';

export type AccountStatus = 'unknown' | 'anonymous' | 'signed-in';
export type SyncStatus =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'error'
  | 'paused';

export type AccountSnapshot = {
  status: AccountStatus;
  userId: string | null;
  email: string | null;
  /** One capital letter for the header chip, from the email. */
  initial: string | null;
  sync: SyncStatus;
  /** ISO timestamp of the last successful sync on this device. */
  lastSyncedAt: string | null;
};

export const initialAccount: AccountSnapshot = Object.freeze({
  status: 'unknown',
  userId: null,
  email: null,
  initial: null,
  sync: 'idle',
  lastSyncedAt: null,
});

let snapshot: AccountSnapshot = initialAccount;
const listeners = new Set<() => void>();

/**
 * Whether the account is known to hold everything on this device: signed in
 * and the last sync succeeded. Only then may a reset say the account will
 * bring the progress back. Paused, offline, failed or unfinished syncs may
 * have left progress that exists only here.
 */
export function accountHoldsProgress(
  account: Pick<AccountSnapshot, 'status' | 'sync'>,
): boolean {
  return account.status === 'signed-in' && account.sync === 'synced';
}

/** The first letter or digit of an email, upper-cased, or null. */
export function initialFor(email: string | null | undefined): string | null {
  const match = email?.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toLocaleUpperCase('en') : null;
}

export function getAccountSnapshot(): AccountSnapshot {
  return snapshot;
}

/** The server always renders the unknown state; the browser decides after mount. */
export function getServerAccountSnapshot(): AccountSnapshot {
  return initialAccount;
}

export function subscribeAccount(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Merges `patch` into the record and tells subscribers, only when something
 * changed, so an unchanged patch keeps the same snapshot object.
 *
 * Becoming anonymous (or unknown) forgets the account's identity and sync
 * status, so a signed-out tab never shows the last account's email. An email
 * without an `initial` gets one worked out from it.
 */
export function setAccount(patch: Partial<AccountSnapshot>): AccountSnapshot {
  const signedOut = patch.status && patch.status !== 'signed-in';
  const next: AccountSnapshot = {
    ...(signedOut ? initialAccount : snapshot),
    ...withoutUndefined(patch),
  };
  if ('email' in patch && !('initial' in patch))
    next.initial = initialFor(next.email);
  const changed = (Object.keys(next) as (keyof AccountSnapshot)[]).some(
    (key) => next[key] !== snapshot[key],
  );
  if (!changed) return snapshot;
  snapshot = Object.freeze(next);
  for (const listener of listeners) listener();
  return snapshot;
}

function withoutUndefined(
  patch: Partial<AccountSnapshot>,
): Partial<AccountSnapshot> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
}

/** Back to the unknown state. For tests. */
export function resetAccountStore(): void {
  snapshot = initialAccount;
  for (const listener of listeners) listener();
}

/** The account record, re-rendering when it changes. */
export function useAccount(): AccountSnapshot {
  return useSyncExternalStore(
    subscribeAccount,
    getAccountSnapshot,
    getServerAccountSnapshot,
  );
}
