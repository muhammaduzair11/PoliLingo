import { allCourses, type CourseId } from './courses.ts';

// Progress is checked against every course, shown or hidden: hiding a course
// must never make a learner's stored progress on it look invalid.
const findCourse = (id: string) => allCourses.find((c) => c.id === id);
export type Session = {
  id: string;
  course: CourseId;
  lesson: string;
  queue: number[];
  cursor: number;
  firstCorrect: number;
  attempts: number;
  studied: boolean;
  feedback: null | { correct: boolean };
  done: boolean;
  reward: number;
};
/**
 * The shape every release before v0.2 stored under `polilingo.progress.v1`.
 * It is backed up verbatim once, migrated, merged in again whenever an older
 * build has written to it since, and never written by this one. The reader
 * for it is never deleted.
 */
export type ProgressStateV1 = {
  version: 1;
  selected: CourseId | null;
  dailyGoal: number;
  xp: number;
  completed: Record<string, boolean>;
  activity: Record<string, number>;
  rewarded: string[];
  sessions: Record<string, Session>;
  prefs: { sound: boolean; reducedMotion: boolean; transliteration: boolean };
};
export type ProgressState = {
  version: 2;
  /** Generated once per browser. Identifies the device in a future sync envelope. */
  deviceId: string;
  /** Set when this state has been merged into an account. Null until D2. */
  userId: string | null;
  lastSyncedAt: string | null;
  importedIntoAccounts: string[];
  /**
   * A fingerprint of the v1 blob as it was when last merged into this state,
   * or null if none has been. Bookkeeping for loadProgress(), not progress.
   */
  v1Fingerprint: string | null;
  selected: CourseId | null;
  dailyGoal: number;
  xp: number;
  completed: Record<string, boolean>;
  activity: Record<string, number>;
  rewarded: string[];
  sessions: Record<string, Session>;
  prefs: { sound: boolean; reducedMotion: boolean; transliteration: boolean };
};
/** Legacy key. Read on every load, backed up once, and never written again. */
export const STORAGE_KEY_V1 = 'polilingo.progress.v1';
export const STORAGE_KEY = 'polilingo.progress.v2';
/** The verbatim copy of the v1 blob, taken before any migration write. */
export const BACKUP_KEY_PREFIX = 'polilingo.progress.v1.bak-';
/** Where a blob written by a newer app version is kept instead of discarded. */
export const UNKNOWN_KEY_PREFIX = 'polilingo.progress.unknown-';
export const EXPORT_FORMAT = 'polilingo.progress.export@1';
export function initialState(deviceId = ''): ProgressState {
  return {
    version: 2,
    deviceId,
    userId: null,
    lastSyncedAt: null,
    importedIntoAccounts: [],
    v1Fingerprint: null,
    selected: null,
    dailyGoal: 1,
    xp: 0,
    completed: {},
    activity: {},
    rewarded: [],
    sessions: {},
    prefs: { sound: false, reducedMotion: false, transliteration: true },
  };
}
export function migrateV1toV2(
  v1: ProgressStateV1,
  deviceId: string,
): ProgressState {
  return {
    version: 2,
    deviceId,
    userId: null,
    lastSyncedAt: null,
    importedIntoAccounts: [],
    v1Fingerprint: null,
    selected: v1.selected,
    dailyGoal: v1.dailyGoal,
    xp: v1.xp,
    completed: v1.completed,
    activity: v1.activity,
    rewarded: v1.rewarded,
    sessions: v1.sessions,
    prefs: v1.prefs,
  };
}
/**
 * "Reset progress" in Settings. A reset leaves the v1 key and its backups in
 * place, so it keeps `v1Fingerprint`: the next load then sees a v1 blob it has
 * already merged and does not bring the old progress back.
 */
export function resetProgress(state: ProgressState): ProgressState {
  return {
    ...initialState(state.deviceId),
    v1Fingerprint: state.v1Fingerprint,
  };
}
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function streak(
  activity: Record<string, number>,
  now = new Date(),
): number {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  if (!activity[localDate(date)]) date.setDate(date.getDate() - 1);
  let count = 0;
  while (activity[localDate(date)] > 0) {
    count++;
    date.setDate(date.getDate() - 1);
  }
  return count;
}
export const lessonKey = (course: string, lesson: string) =>
  `${course}/${lesson}`;
export function unlocked(
  state: ProgressState,
  course: CourseId,
  lesson: string,
): boolean {
  const c = findCourse(course)!;
  const i = c.lessons.findIndex((l) => l.id === lesson);
  return (
    i >= 0 &&
    (i === 0 || !!state.completed[lessonKey(course, c.lessons[i - 1].id)])
  );
}
export function newSession(
  course: CourseId,
  lesson: string,
  id: string,
): Session {
  return {
    id,
    course,
    lesson,
    queue: [0, 1, 2, 3, 4, 5, 6, 7],
    cursor: 0,
    firstCorrect: 0,
    attempts: 0,
    studied: false,
    feedback: null,
    done: false,
    reward: 0,
  };
}
export function recordAnswer(session: Session, correct: boolean): Session {
  if (session.feedback || session.done) return session;
  return {
    ...session,
    attempts: session.attempts + 1,
    firstCorrect:
      session.firstCorrect + (session.cursor < 8 && correct ? 1 : 0),
    feedback: { correct },
    queue: correct
      ? session.queue
      : [...session.queue, session.queue[session.cursor]],
  };
}
export function advanceSession(
  state: ProgressState,
  key: string,
  day: string,
): ProgressState {
  const session = state.sessions[key];
  if (!session || !session.feedback || session.done) return state;
  const updated = { ...session, cursor: session.cursor + 1, feedback: null };
  if (updated.cursor < updated.queue.length)
    return { ...state, sessions: { ...state.sessions, [key]: updated } };
  if (state.rewarded.includes(session.id)) return state;
  const reward = state.completed[key] ? 5 : 20;
  return {
    ...state,
    xp: state.xp + reward,
    completed: { ...state.completed, [key]: true },
    activity: { ...state.activity, [day]: (state.activity[day] || 0) + 1 },
    rewarded: [...state.rewarded, session.id],
    sessions: { ...state.sessions, [key]: { ...updated, done: true, reward } },
  };
}
/**
 * The field checks shared by v1 and v2. Returns false rather than throwing so
 * that corrupt storage recovers to defaults instead of breaking the app.
 */
function fieldsValid(s: Record<string, unknown>): boolean {
  if (
    !Number.isSafeInteger(s.xp) ||
    (s.xp as number) < 0 ||
    ![1, 2, 3].includes(s.dailyGoal as number) ||
    (s.selected !== null && !findCourse(s.selected as string)) ||
    !s.prefs ||
    typeof s.prefs !== 'object' ||
    ['sound', 'reducedMotion', 'transliteration'].some(
      (k) => typeof (s.prefs as Record<string, unknown>)[k] !== 'boolean',
    )
  )
    return false;
  if (
    !s.completed ||
    typeof s.completed !== 'object' ||
    !s.activity ||
    typeof s.activity !== 'object' ||
    !s.sessions ||
    typeof s.sessions !== 'object' ||
    !Array.isArray(s.rewarded) ||
    !s.rewarded.every((x: unknown) => typeof x === 'string')
  )
    return false;
  const validKeys = allCourses.flatMap((c) =>
    c.lessons.map((l) => lessonKey(c.id, l.id)),
  );
  if (
    Object.entries(s.completed as object).some(
      ([k, v]) => !validKeys.includes(k) || typeof v !== 'boolean',
    )
  )
    return false;
  if (
    Object.entries(s.activity as object).some(
      ([k, v]) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(k) ||
        !Number.isSafeInteger(v) ||
        Number(v) < 0,
    )
  )
    return false;
  for (const [key, value] of Object.entries(s.sessions as object)) {
    const v = value as Session;
    if (
      !v ||
      !validKeys.includes(key) ||
      key !== lessonKey(v.course, v.lesson) ||
      typeof v.id !== 'string' ||
      !Array.isArray(v.queue) ||
      v.queue.length < 8 ||
      v.queue.length > 10000 ||
      !v.queue.every((n) => Number.isInteger(n) && n >= 0 && n < 8) ||
      !Number.isInteger(v.cursor) ||
      v.cursor < 0 ||
      v.cursor > v.queue.length ||
      (!v.done && v.cursor === v.queue.length) ||
      typeof v.studied !== 'boolean' ||
      typeof v.done !== 'boolean' ||
      !Number.isInteger(v.firstCorrect) ||
      v.firstCorrect < 0 ||
      v.firstCorrect > 8 ||
      !Number.isInteger(v.attempts) ||
      v.attempts < 0 ||
      ![0, 5, 20].includes(v.reward) ||
      (v.feedback !== null && typeof v.feedback?.correct !== 'boolean')
    )
      return false;
  }
  return true;
}
/**
 * Reads a stored blob of either version into the current shape, or null when
 * it is not usable. A v1 blob is migrated; a v2 blob keeps its own deviceId.
 */
function readState(raw: string | null, deviceId: string): ProgressState | null {
  if (!raw) return null;
  let s: unknown;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  if (o.version !== 1 && o.version !== 2) return null;
  if (!fieldsValid(o)) return null;
  if (o.version === 1) return migrateV1toV2(o as ProgressStateV1, deviceId);
  if (
    typeof o.deviceId !== 'string' ||
    (o.userId !== null && typeof o.userId !== 'string') ||
    (o.lastSyncedAt !== null && typeof o.lastSyncedAt !== 'string') ||
    !Array.isArray(o.importedIntoAccounts) ||
    !o.importedIntoAccounts.every((x: unknown) => typeof x === 'string')
  )
    return null;
  // A v2 blob without a fingerprint has simply not merged a v1 blob yet.
  const v2: ProgressState = {
    ...(o as ProgressState),
    v1Fingerprint: typeof o.v1Fingerprint === 'string' ? o.v1Fingerprint : null,
  };
  return v2.deviceId ? v2 : { ...v2, deviceId };
}
/** Tolerant hydration: v1 or v2 in, v2 out; anything else falls back to defaults. */
export function parseState(raw: string | null, deviceId = ''): ProgressState {
  return readState(raw, deviceId) ?? initialState(deviceId);
}
/** The `version` a stored blob claims, or null when it does not even parse. */
export function storedVersion(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return s && typeof s === 'object' && typeof s.version === 'number'
      ? s.version
      : null;
  } catch {
    return null;
  }
}
/**
 * A short fingerprint of a stored blob (cyrb53, widened to 64 bits, plus the
 * length). It is not cryptographic: it only has to notice that the v1 key
 * holds something other than what was last merged.
 */
function fingerprint(raw: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${raw.length}-${hex(h2)}${hex(h1)}`;
}
export type StorageWrite = { key: string; value: string };
/**
 * Decides what to load, and what to write, on every load without touching
 * storage itself, so the rules that cannot be retrofitted are testable:
 *
 *   - the v1 blob is copied verbatim to a backup key before anything else,
 *     exactly once;
 *   - a blob from a newer app version is kept under an `unknown-` key rather
 *     than discarded, and the learner sees their v1 progress, if there is
 *     any, instead of a fresh start;
 *   - progress an older build wrote to the v1 key after the migration is
 *     merged back in.
 *
 * The last rule is for rollbacks and stale tabs. Every build before v0.2 reads
 * and writes only the v1 key, so a learner who keeps going on one after the
 * migration adds to v1, and the v2 state would never show it. So whenever the
 * v1 blob differs from the one last merged, it is merged into the v2 state
 * with mergeProgress(), and the state records its fingerprint. Merging only on
 * a change, rather than on every load, is what keeps a reset from being undone:
 * a reset leaves the v1 key in place but keeps the fingerprint, so the old
 * progress stays away until an older build writes to v1 again. The merge is
 * idempotent, so loading twice changes nothing either way.
 */
export function loadProgress(
  stored: { v1: string | null; v2: string | null; backupExists: boolean },
  today: string,
  deviceId: string,
): { state: ProgressState; writes: StorageWrite[] } {
  const writes: StorageWrite[] = [];
  if (stored.v1 !== null && !stored.backupExists)
    writes.push({ key: BACKUP_KEY_PREFIX + today, value: stored.v1 });
  let current: ProgressState | null = null;
  const version = storedVersion(stored.v2);
  if (stored.v2 !== null && version !== null && version !== 1 && version !== 2)
    writes.push({ key: UNKNOWN_KEY_PREFIX + version, value: stored.v2 });
  else current = readState(stored.v2, deviceId);
  if (stored.v1 === null)
    return { state: current ?? initialState(deviceId), writes };
  const print = fingerprint(stored.v1);
  if (current?.v1Fingerprint === print) return { state: current, writes };
  // A v1 blob this build cannot read merges nothing and is not recorded, so a
  // later build that can read it still merges it. It stays in the v1 key and
  // its backup meanwhile.
  const old = readState(stored.v1, deviceId);
  if (!old) return { state: current ?? initialState(deviceId), writes };
  const state = current ? mergeProgress(current, old) : old;
  return { state: { ...state, v1Fingerprint: print }, writes };
}
/** The parts of `localStorage` that hydrateProgress() uses. */
export type StorageLike = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};
/**
 * The first load against real storage, kept out of React so it can be tested
 * with a stub. `storage` is null when the browser will not even hand it over.
 *
 * It reads, lets loadProgress() decide, then makes the backup and stash writes.
 * `persist` says whether this session may write the live key. It is false when
 * storage cannot be read or one of those writes fails, and then the learner
 * keeps what was loaded in memory, with the storage warning showing, and the
 * live key is not written at all. So the live key is never written before the
 * v1 blob's backup exists, and a newer app's blob in it is never overwritten
 * before its copy is safe. The next load simply tries again.
 */
export function hydrateProgress(
  storage: StorageLike | null,
  today: string,
  newId: () => string,
): { state: ProgressState; persist: boolean } {
  let deviceId = '';
  try {
    deviceId = newId();
  } catch {
    /* An empty deviceId is filled in on a later load. */
  }
  let loaded: ReturnType<typeof loadProgress>;
  try {
    if (!storage) throw new Error('Storage is unavailable');
    let backupExists = false;
    for (let i = 0; i < storage.length; i++)
      if (storage.key(i)?.startsWith(BACKUP_KEY_PREFIX)) backupExists = true;
    loaded = loadProgress(
      {
        v1: storage.getItem(STORAGE_KEY_V1),
        v2: storage.getItem(STORAGE_KEY),
        backupExists,
      },
      today,
      deviceId,
    );
  } catch {
    return { state: initialState(deviceId), persist: false };
  }
  try {
    for (const { key, value } of loaded.writes) storage.setItem(key, value);
  } catch {
    return { state: loaded.state, persist: false };
  }
  return { state: loaded.state, persist: true };
}
/**
 * Writes a `polilingo.progress.export@1` file: `{ format, exportedAt, state }`,
 * with `state` exactly as stored.
 *
 * TODO(D2): `state.importedIntoAccounts` is in the file only because the whole
 * state is, and it is not part of this format's promise. mergeProgress()
 * unions it on import, so a file can make this device claim account merges it
 * never made. Decide before sign-in whether an export carries it at all.
 */
export function exportProgress(
  state: ProgressState,
  exportedAt: string,
): string {
  return JSON.stringify({ format: EXPORT_FORMAT, exportedAt, state }, null, 2);
}
/**
 * The merge from ADR-0010: every field is a grow-only set, a maximum or an
 * append-only ledger, so merging is idempotent - importing the same file twice
 * changes nothing. Preferences and the daily goal are the learner's current
 * ones; an import never silently overwrites them. XP takes the maximum until
 * the award ledger arrives with accounts (D2); it is never summed. The device's
 * own fields, such as `deviceId` and `v1Fingerprint`, stay local. Used for
 * imports, and by loadProgress() to merge back what an older build wrote.
 */
export function mergeProgress(
  local: ProgressState,
  incoming: ProgressState,
): ProgressState {
  const completed: Record<string, boolean> = { ...local.completed };
  for (const [k, v] of Object.entries(incoming.completed))
    if (v) completed[k] = true;
  const activity: Record<string, number> = { ...local.activity };
  for (const [day, n] of Object.entries(incoming.activity))
    activity[day] = Math.max(activity[day] ?? 0, n);
  const rewarded = [
    ...local.rewarded,
    ...incoming.rewarded.filter((id) => !local.rewarded.includes(id)),
  ];
  const sessions: Record<string, Session> = { ...local.sessions };
  for (const [key, theirs] of Object.entries(incoming.sessions)) {
    const mine = sessions[key];
    // Finished beats unfinished, and otherwise the local run stays. But an
    // unfinished run that has already been rewarded was finished on the other
    // side, which has since started the lesson again: advanceSession() would
    // never let it finish here, so their newer run replaces it.
    if (
      !mine ||
      (theirs.done && !mine.done) ||
      (!mine.done && rewarded.includes(mine.id))
    )
      sessions[key] = theirs;
  }
  // TODO(D2): an imported file's accounts are not this device's merges. Before
  // sign-in reads this list, stop unioning it here (see exportProgress()).
  const importedIntoAccounts = [
    ...local.importedIntoAccounts,
    ...incoming.importedIntoAccounts.filter(
      (a) => !local.importedIntoAccounts.includes(a),
    ),
  ];
  return {
    ...local,
    selected: local.selected ?? incoming.selected,
    xp: Math.max(local.xp, incoming.xp),
    completed,
    activity,
    rewarded,
    sessions,
    importedIntoAccounts,
  };
}
/** Accepts an export file or a bare stored blob of either version, and merges it in. */
export function importProgress(
  state: ProgressState,
  raw: string,
): { ok: true; state: ProgressState } | { ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  const envelope = parsed as Record<string, unknown> | null;
  const inner =
    envelope &&
    typeof envelope === 'object' &&
    envelope.format === EXPORT_FORMAT
      ? envelope.state
      : parsed;
  const incoming = readState(JSON.stringify(inner), state.deviceId);
  if (!incoming) return { ok: false };
  return { ok: true, state: mergeProgress(state, incoming) };
}
