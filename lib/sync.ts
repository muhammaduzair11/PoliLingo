/**
 * Progress sync between this device and a signed-in account
 * (docs/platform.md 3.7, 4.9). Pure: the sync agent
 * (components/account/sync-agent.tsx) does the calling and the timing.
 *
 * The device sends a `polilingo.sync@1` envelope built from its v3 state;
 * the database merges it into the account (import_local_progress) and
 * answers with the account's whole state, the snapshot, which the device
 * merges back with mergeProgress(). Every field only grows on both sides, so
 * syncing is idempotent and order does not matter: two devices end up with
 * the same lessons, days and XP whichever syncs first, and nothing is ever
 * taken away from either.
 *
 * XP identity: every reward appends one session id to `rewarded` and pays
 * 20 for a lesson new to `completed`, else 5, so a device's XP is
 * 15 x completed lessons + 5 x rewarded sessions (ledgerXp). The account
 * keeps that ledger (15 per lesson, 5 per session, never an amount the
 * device sends) and reports the larger of its sum and the most any device
 * has reported.
 */
import { canonicalJson } from './canonical-json.ts';
import { mergeProgress, type ProgressState } from './progress.ts';
import { sha256 } from './sha256.ts';

export const SYNC_FORMAT = 'polilingo.sync@1';

/** What import_local_progress accepts at most (docs/platform.md 3.7). */
export const SYNC_LIMITS = {
  completed: 5000,
  rewarded: 10000,
  activity: 3000,
  dayCount: 1000,
  xp: 10_000_000,
} as const;

/** The device id sent when this browser could not make one. */
export const UNKNOWN_DEVICE = 'device-unknown';

export type Envelope = {
  format: typeof SYNC_FORMAT;
  deviceId: string;
  /** The device's local date, YYYY-MM-DD. */
  localDate: string;
  xp: number;
  /** Lesson key -> the content release it was first completed in. */
  completed: Record<string, string>;
  /** Local date -> lessons finished that day. */
  activity: Record<string, number>;
  /** The session ids that have been rewarded. */
  rewarded: string[];
  dailyGoal: number | null;
  selected: string | null;
};

/** The account's progress, as import_local_progress and get_my_progress return it. */
export type Snapshot = {
  xp: number;
  completed: Record<string, string>;
  activity: Record<string, number>;
  rewarded: string[];
  dailyGoal: number | null;
  selected: string | null;
};

/** import_local_progress's answer: the snapshot, whether it changed anything, and the envelope's hash. */
export type ImportResult = Snapshot & {
  applied: boolean;
  envelope_hash: string;
};

// The same patterns the database checks, so an envelope built here is never
// refused for its contents. Anything that does not fit stays on the device,
// exactly as it is, and simply is not sent.
const LESSON_KEY = /^([a-z]{2,3}-lsn-[0-9a-f]{6}|[a-z]+\/[a-z0-9-]+)$/;
const PRINTABLE_ASCII = /^[\x21-\x7e]{1,100}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const COURSE_SLUG = /^[a-z]{2,20}$/;

/** Whether `day` is a real calendar date, YYYY-MM-DD, from 2020 to 2099. */
export function isSyncDate(day: string): boolean {
  const m = DATE.exec(day);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2020 || y > 2099) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * The envelope for `state` on the device's local date `today`. It carries
 * progress only: never the runs in progress (`sessions`) nor the settings
 * (`prefs`), and nothing about accounts.
 *
 * Entries the database would refuse are left out rather than failing the
 * whole sync (a malformed key, a day count of 0). Over a size limit, the
 * newest entries are sent: older ones are already in the account.
 */
export function buildEnvelope(state: ProgressState, today: string): Envelope {
  const completed = Object.fromEntries(
    Object.entries(state.completed)
      .filter(
        ([key, release]) =>
          key.length <= 80 &&
          LESSON_KEY.test(key) &&
          typeof release === 'string' &&
          PRINTABLE_ASCII.test(release),
      )
      .slice(-SYNC_LIMITS.completed),
  );

  const days = Object.entries(state.activity)
    .filter(([day, n]) => isSyncDate(day) && Number.isSafeInteger(n) && n >= 1)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(-SYNC_LIMITS.activity);
  const activity: Record<string, number> = {};
  for (const [day, n] of days)
    activity[day] = Math.min(n, SYNC_LIMITS.dayCount);

  const seen = new Set<string>();
  const rewarded: string[] = [];
  for (const id of state.rewarded)
    if (typeof id === 'string' && PRINTABLE_ASCII.test(id) && !seen.has(id)) {
      seen.add(id);
      rewarded.push(id);
    }

  const xp =
    Number.isSafeInteger(state.xp) && state.xp > 0
      ? Math.min(state.xp, SYNC_LIMITS.xp)
      : 0;

  return {
    format: SYNC_FORMAT,
    deviceId: state.deviceId.slice(0, 100) || UNKNOWN_DEVICE,
    localDate: today,
    xp,
    completed,
    activity,
    rewarded: rewarded.slice(-SYNC_LIMITS.rewarded),
    dailyGoal: [1, 2, 3].includes(state.dailyGoal) ? state.dailyGoal : null,
    selected:
      state.selected !== null && COURSE_SLUG.test(state.selected)
        ? state.selected
        : null,
  };
}

/**
 * The envelope's hash: SHA-256 of its canonical JSON, the same 64 hex digits
 * the database records in progress_imports.envelope_hash. Two envelopes with
 * the same key hold the same progress.
 */
export function envelopeKey(envelope: Envelope): string {
  return sha256(canonicalJson(envelope));
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const isCount = (x: unknown): x is number =>
  Number.isSafeInteger(x) && (x as number) >= 0;

/**
 * The snapshot in an answer from the database, or null when it is not one.
 * The agent applies nothing it cannot read, so a surprise from the server
 * never reaches local progress.
 */
export function parseSnapshot(x: unknown): Snapshot | null {
  if (!isRecord(x)) return null;
  const { xp, completed, activity, rewarded, dailyGoal, selected } = x;
  if (!isCount(xp)) return null;
  if (
    !isRecord(completed) ||
    !Object.values(completed).every((v) => typeof v === 'string' && v !== '')
  )
    return null;
  if (
    !isRecord(activity) ||
    !Object.entries(activity).every(([day, n]) => DATE.test(day) && isCount(n))
  )
    return null;
  if (
    !Array.isArray(rewarded) ||
    !rewarded.every((id) => typeof id === 'string')
  )
    return null;
  if (
    dailyGoal !== null &&
    dailyGoal !== undefined &&
    ![1, 2, 3].includes(dailyGoal as number)
  )
    return null;
  if (
    selected !== null &&
    selected !== undefined &&
    typeof selected !== 'string'
  )
    return null;
  return {
    xp,
    completed: completed as Record<string, string>,
    activity: activity as Record<string, number>,
    rewarded: rewarded as string[],
    dailyGoal: (dailyGoal as number | null | undefined) ?? null,
    selected: (selected as string | null | undefined) ?? null,
  };
}

/**
 * The account's snapshot as a progress state on top of `base`, the device's
 * own: the device's id, fingerprints, settings and account fields stay as
 * they are. It holds no runs, since the account keeps none.
 */
export function snapshotToState(
  snapshot: Snapshot,
  base: ProgressState,
): ProgressState {
  return {
    ...base,
    xp: snapshot.xp,
    completed: { ...snapshot.completed },
    activity: { ...snapshot.activity },
    rewarded: [...snapshot.rewarded],
    sessions: {},
    dailyGoal: snapshot.dailyGoal ?? base.dailyGoal,
    selected: snapshot.selected ?? base.selected,
  };
}

/**
 * Local progress with the account's merged in (mergeProgress(): lessons and
 * sessions a union, each day's maximum, the larger XP; the device's daily
 * goal and settings stay), marked as synced to `userId` at `now`. Applying
 * the same snapshot again changes nothing, and XP and the streak never go
 * down.
 */
export function applySnapshot(
  local: ProgressState,
  snapshot: Snapshot,
  userId: string,
  now: Date,
): ProgressState {
  const merged = mergeProgress(local, snapshotToState(snapshot, local));
  return {
    ...merged,
    userId,
    lastSyncedAt: now.toISOString(),
    importedIntoAccounts: merged.importedIntoAccounts.includes(userId)
      ? merged.importedIntoAccounts
      : [...merged.importedIntoAccounts, userId],
  };
}

/** Whether a state holds any progress worth asking about. */
export function holdsProgress(state: ProgressState): boolean {
  return (
    state.xp > 0 ||
    state.rewarded.length > 0 ||
    Object.keys(state.completed).length > 0 ||
    Object.values(state.activity).some((n) => n > 0)
  );
}

/**
 * What to do when `userId` is signed in on this device:
 *
 *   - 'sync' when this device has never synced, last synced to this very
 *     account, or holds no progress: its progress simply joins the account.
 *   - 'ask' when it last synced to a different account and holds progress,
 *     some of which may be that account's. Nothing is sent until the learner
 *     says so (AccountSwitchDialog).
 */
export function accountChoice(
  state: ProgressState,
  userId: string,
): 'sync' | 'ask' {
  const last =
    state.userId ??
    state.importedIntoAccounts[state.importedIntoAccounts.length - 1] ??
    null;
  if (last === null || last === userId) return 'sync';
  return holdsProgress(state) ? 'ask' : 'sync';
}

/** XP by the ledger: 15 per completed lesson plus 5 per rewarded session. */
export function ledgerXp(
  state: Pick<ProgressState, 'completed' | 'rewarded'>,
): number {
  return 15 * Object.keys(state.completed).length + 5 * state.rewarded.length;
}

/** Focus syncs are at least this far apart. */
export const FOCUS_INTERVAL_MS = 15_000;
/** The first retry after a failure, doubling up to RETRY_MAX_MS. */
export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 5 * 60_000;

/** How long to wait before retrying after `failures` failures in a row (1, 2, …). */
export function retryDelay(failures: number): number {
  const n = Math.max(1, Math.floor(failures));
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(n - 1, 16));
}

/** Whether a focus at `now` should sync, given the last sync started at `last` (ms). */
export function focusDue(last: number | null, now: number): boolean {
  return last === null || now - last >= FOCUS_INTERVAL_MS;
}

export type SyncFailure = {
  /** The account store's sync status to show. */
  status: 'offline' | 'error' | 'paused';
  /** Whether trying again later can help. */
  retry: boolean;
};

/**
 * How the agent treats a failed sync, by its code (lib/db-errors.ts). A
 * refusal that the same envelope would meet again is not retried on a
 * timer; the next change, focus or sign-in tries again.
 */
export function syncFailure(code: string): SyncFailure {
  switch (code) {
    case 'NETWORK':
      return { status: 'offline', retry: true };
    case 'PL460_SYNC_DISABLED':
      return { status: 'paused', retry: true };
    case 'PL429_RATE_LIMITED':
      return { status: 'error', retry: true };
    case 'PL401_NOT_SIGNED_IN':
    case 'PL403_NO_PROFILE':
    case 'PL422_BAD_ENVELOPE':
    case 'NOT_CONFIGURED':
    case 'SESSION_ENDED':
    case 'PGRST301':
    case 'PGRST302':
    case 'PGRST303':
    case 'BAD_SNAPSHOT':
      return { status: 'error', retry: false };
    default:
      return { status: 'error', retry: true };
  }
}

/** The sessionStorage key that holds the account "Not now" paused sync for, in this tab. */
export const PAUSE_KEY = 'polilingo.sync.paused';
