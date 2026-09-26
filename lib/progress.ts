import {
  contentVersion,
  getCourse,
  legacyLessonIds,
  lessonSize,
  type CourseId,
} from './content.ts';
/** One run through a lesson, stored in v3 under the lesson's key. */
export type Session = {
  id: string;
  /**
   * The course slug. A string rather than a CourseId: a run on a course this
   * build does not show is still kept.
   */
  course: string;
  /** The lesson's key in `completed` and `sessions`: its permanent id, e.g. ps-lsn-0a41c2. */
  lesson: string;
  /** How many exercises the lesson had when this session began. The first
   *  pass is exercises 0..size-1; retries are appended after them. */
  size: number;
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
 * A run as v1 and v2 stored it: under "course/lesson", with the MVP's lesson
 * slug and no `size`, since every MVP lesson had eight exercises.
 */
export type LegacySession = Omit<Session, 'size'>;
/** Every MVP lesson had eight exercises, and its runs do not say so. */
const MVP_LESSON_SIZE = 8;
/**
 * The shape every release before v0.2 stored under `polilingo.progress.v1`.
 * It is backed up verbatim once, migrated, merged in again whenever an older
 * build has written to it since, and never written by this one. The reader
 * for it is never deleted.
 */
export type ProgressStateV1 = {
  version: 1;
  selected: string | null;
  dailyGoal: number;
  xp: number;
  completed: Record<string, boolean>;
  activity: Record<string, number>;
  rewarded: string[];
  sessions: Record<string, LegacySession>;
  prefs: { sound: boolean; reducedMotion: boolean; transliteration: boolean };
};
type ProgressFields = {
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
  /**
   * The course slug the learner last chose. It may name a course this build
   * does not show; it is kept as it is, and the screens decide at read time.
   */
  selected: string | null;
  dailyGoal: number;
  xp: number;
  activity: Record<string, number>;
  rewarded: string[];
  prefs: { sound: boolean; reducedMotion: boolean; transliteration: boolean };
};
/** v2 (v0.2, before content releases): the v1 fields plus device and sync fields, still keyed by the MVP's "course/lesson" strings. */
export type ProgressStateV2 = ProgressFields & {
  version: 2;
  completed: Record<string, boolean>;
  sessions: Record<string, LegacySession>;
};
/**
 * v3: `completed` and `sessions` are keyed by permanent lesson ids from the
 * content release. It has its own key, polilingo.progress.v3.
 *
 * Nothing in it is dropped because a release does not know it. A completion
 * on a lesson the release does not have, or an MVP key its keymap does not
 * map, is kept as it is: stored, just not shown. An MVP key moves to its
 * permanent id when a later release maps it, and only an unfinished run the
 * release no longer fits is left out, both when a record is read
 * (readState()).
 */
export type ProgressState = ProgressFields & {
  version: 3;
  /**
   * A fingerprint of the v2 blob as it was when last merged into this state,
   * or null if none has been. Bookkeeping for loadProgress(), like
   * `v1Fingerprint`.
   */
  v2Fingerprint: string | null;
  /**
   * Each completed lesson, and the content release it was FIRST completed in,
   * e.g. "content@2026.09.1", or MVP_RELEASE. It is what lets Gate 1 tell
   * completions of demo content from reviewed content. Any non-empty string
   * is truthy, so `completed[key] ? ... : ...` reads as before.
   */
  completed: Record<string, string>;
  sessions: Record<string, Session>;
};
/**
 * The release recorded for a completion made before completions recorded
 * one: everything completed on the MVP (v1) or on v0.2 (v2), before content
 * releases existed, and any `true` in an older export.
 */
export const MVP_RELEASE = 'mvp';
/** Legacy key. Read on every load, backed up once, and never written again. */
export const STORAGE_KEY_V1 = 'polilingo.progress.v1';
/**
 * v0.2's key, from before content releases. Read on every load and never
 * written by this build, so it stays exactly as v0.2 left it: a rollback of
 * one deploy finds it intact, and it is a backup of the v2 state for free.
 */
export const STORAGE_KEY_V2 = 'polilingo.progress.v2';
/** The live key, and the only progress key this build writes. */
export const STORAGE_KEY = 'polilingo.progress.v3';
/** The verbatim copy of the v1 blob, taken before any migration write. */
export const BACKUP_KEY_PREFIX = 'polilingo.progress.v1.bak-';
/** Where a blob written by a newer app version is kept instead of discarded. */
export const UNKNOWN_KEY_PREFIX = 'polilingo.progress.unknown-';
/**
 * Where a live record this build cannot read at all is kept before a fresh
 * start replaces it: `invalid-<version>-<n>`, with `none` for a blob that
 * does not say its version, and n one more than any kept before.
 */
export const INVALID_KEY_PREFIX = 'polilingo.progress.invalid-';
export const EXPORT_FORMAT = 'polilingo.progress.export@1';
export function initialState(deviceId = ''): ProgressState {
  return {
    version: 3,
    deviceId,
    userId: null,
    lastSyncedAt: null,
    importedIntoAccounts: [],
    v1Fingerprint: null,
    v2Fingerprint: null,
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
): ProgressStateV2 {
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
 * "Reset progress" in Settings. A reset leaves the v1 and v2 keys and the v1
 * backups in place, so it keeps both fingerprints: the next load then sees
 * blobs it has already merged and does not bring the old progress back.
 */
export function resetProgress(state: ProgressState): ProgressState {
  return {
    ...initialState(state.deviceId),
    v1Fingerprint: state.v1Fingerprint,
    v2Fingerprint: state.v2Fingerprint,
  };
}
/**
 * The v3 key for an MVP "course/lesson" key: the permanent id the release's
 * keymap gives it, or the key itself when the keymap does not map it.
 */
function fromLegacyKey(key: string): string {
  return Object.prototype.hasOwnProperty.call(legacyLessonIds, key)
    ? legacyLessonIds[key]
    : key;
}
/**
 * v2 -> v3: lesson keys become permanent ids, via the keymap that travels
 * with the content release ("pashto/greetings" -> "ps-lsn-0a41c2"). A key the
 * keymap does not map, such as a Hindko lesson while the release has no
 * Hindko, is kept as it is: stored, just not shown, until a release maps it,
 * when readState() moves it to the permanent id. A completion on a lesson the
 * release does not show is kept too.
 *
 * Every completion records MVP_RELEASE: it was made before content releases.
 *
 * Unfinished runs are not carried over. They index into the MVP's eight
 * exercises, and the release changed which exercises a lesson has, so an old
 * cursor would point at a different question. Finished runs are kept, under
 * the same key as their completion, with the eight exercises they were played
 * with. Completed lessons, XP and the award ledger are untouched, which is
 * what protects the streak and stops a lesson being awarded twice.
 */
export function migrateV2toV3(v2: ProgressStateV2): ProgressState {
  const completed: Record<string, string> = {};
  for (const [key, done] of Object.entries(v2.completed))
    if (done) completed[fromLegacyKey(key)] = MVP_RELEASE;
  const sessions: Record<string, Session> = {};
  for (const [key, run] of Object.entries(v2.sessions)) {
    if (!run.done) continue;
    const lesson = fromLegacyKey(key);
    sessions[lesson] = { ...run, lesson, size: MVP_LESSON_SIZE };
  }
  return { ...v2, version: 3, v2Fingerprint: null, completed, sessions };
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
/**
 * The key for a lesson's progress is its permanent id. The course is implied
 * by the id's language prefix, so it is not repeated in the key; the
 * parameter stays so call sites read the same as before. (Until v3 the key
 * was "course/lesson", which is what migrations/mvp-v1-keymap.yaml maps.)
 */
export const lessonKey = (_course: string, lesson: string) => lesson;
export function unlocked(
  state: ProgressState,
  course: CourseId,
  lesson: string,
): boolean {
  const c = getCourse(course);
  if (!c) return false;
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
  size: number,
): Session {
  return {
    id,
    course,
    lesson,
    size,
    queue: Array.from({ length: size }, (_, i) => i),
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
      session.firstCorrect + (session.cursor < session.size && correct ? 1 : 0),
    feedback: { correct },
    queue: correct
      ? session.queue
      : [...session.queue, session.queue[session.cursor]],
  };
}
/**
 * Moves a run on after its feedback. At the end of the queue the lesson is
 * completed: XP (20 the first time, 5 on a replay), the day's activity, the
 * award ledger, and the content release `release` it was completed in, which
 * is this build's unless a test says otherwise. A lesson keeps the release it
 * was first completed in; a replay under a later one does not change it.
 *
 * TODO(D10): practice events will carry the content release id too, so Gate 1
 * can separate demo from reviewed content per answer, not only per lesson.
 */
export function advanceSession(
  state: ProgressState,
  key: string,
  day: string,
  release: string = contentVersion,
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
    completed: { ...state.completed, [key]: state.completed[key] ?? release },
    activity: { ...state.activity, [day]: (state.activity[day] || 0) + 1 },
    rewarded: [...state.rewarded, session.id],
    sessions: { ...state.sessions, [key]: { ...updated, done: true, reward } },
  };
}
type Json = Record<string, unknown>;
const isRecord = (x: unknown): x is Json =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const isCount = (x: unknown): x is number =>
  Number.isSafeInteger(x) && (x as number) >= 0;
/**
 * Whether a stored run is well formed. `key` is where it is stored. A v1 or
 * v2 run sits under "course/lesson" and was played with the MVP's eight
 * exercises; a v3 run sits under its lesson and says its own size. Nothing
 * here asks the content release: a run on a lesson the release no longer
 * has, or has at another size, is still well formed.
 */
function runWellFormed(value: unknown, key: string, legacy: boolean): boolean {
  if (!isRecord(value)) return false;
  const v = value as Session;
  const size = legacy ? MVP_LESSON_SIZE : v.size;
  return (
    typeof v.id === 'string' &&
    typeof v.course === 'string' &&
    typeof v.lesson === 'string' &&
    key === (legacy ? `${v.course}/${v.lesson}` : v.lesson) &&
    Number.isSafeInteger(size) &&
    size >= 1 &&
    Array.isArray(v.queue) &&
    v.queue.length >= size &&
    v.queue.length <= 10000 &&
    v.queue.every((n) => Number.isInteger(n) && n >= 0 && n < size) &&
    Number.isInteger(v.cursor) &&
    v.cursor >= 0 &&
    v.cursor <= v.queue.length &&
    typeof v.studied === 'boolean' &&
    typeof v.done === 'boolean' &&
    (v.done || v.cursor < v.queue.length) &&
    Number.isInteger(v.firstCorrect) &&
    v.firstCorrect >= 0 &&
    v.firstCorrect <= size &&
    isCount(v.attempts) &&
    [0, 5, 20].includes(v.reward) &&
    (v.feedback === null ||
      (isRecord(v.feedback) && typeof v.feedback.correct === 'boolean'))
  );
}
/**
 * Whether a stored record is well formed: every field of the right type and
 * in range. It is the only reason a record is ever set aside, and it asks
 * nothing of the content release, so no release can make a learner's record
 * unreadable. A completion or a run on a lesson the release does not have,
 * and a course slug this build does not show, are all well formed. Returns
 * false rather than throwing so that corrupt storage recovers instead of
 * breaking the app.
 */
function wellFormed(s: Json, legacy: boolean): boolean {
  const { prefs, completed, activity, sessions, rewarded } = s;
  return (
    isCount(s.xp) &&
    [1, 2, 3].includes(s.dailyGoal as number) &&
    (s.selected === null || typeof s.selected === 'string') &&
    isRecord(prefs) &&
    ['sound', 'reducedMotion', 'transliteration'].every(
      (k) => typeof prefs[k] === 'boolean',
    ) &&
    isRecord(completed) &&
    Object.values(completed).every(
      (v) =>
        typeof v === 'boolean' ||
        (!legacy && typeof v === 'string' && v.length > 0),
    ) &&
    isRecord(activity) &&
    Object.entries(activity).every(
      ([day, n]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && isCount(n),
    ) &&
    Array.isArray(rewarded) &&
    rewarded.every((x) => typeof x === 'string') &&
    isRecord(sessions) &&
    Object.entries(sessions).every(([key, run]) =>
      runWellFormed(run, key, legacy),
    ) &&
    // v1 had no device or sync fields.
    (s.version === 1 ||
      (typeof s.deviceId === 'string' &&
        (s.userId === null || typeof s.userId === 'string') &&
        (s.lastSyncedAt === null || typeof s.lastSyncedAt === 'string') &&
        Array.isArray(s.importedIntoAccounts) &&
        s.importedIntoAccounts.every((x) => typeof x === 'string')))
  );
}
/**
 * The runs a learner can carry on with under this release. An unfinished run
 * indexes into its lesson's exercises, so it is left out when the release no
 * longer has the lesson, or has it at another size: carrying on would ask
 * different questions, or none. Finished runs only record what happened, so
 * they are all kept.
 */
function playable(sessions: Record<string, Session>): Record<string, Session> {
  return Object.fromEntries(
    Object.entries(sessions).filter(
      ([key, run]) => run.done || lessonSize(key) === run.size,
    ),
  );
}
/**
 * A v3 record's `completed` or `sessions` with every MVP key the release's
 * keymap maps moved to the lesson's permanent id. The v1/v2 -> v3 migration
 * keeps a key the keymap does not map as it is: for instance while a lesson
 * is held back from the learner copy, whose keymap then has no row for it.
 * The first release that maps the key again moves it here, on every read, so
 * a completion never stays out of view because of the release a learner
 * happened to migrate under, and one lesson is not kept under two keys. An
 * entry already under the permanent id wins and is left as it is, so reading
 * a record twice changes nothing. `move` re-keys an entry's own contents.
 */
function underPermanentIds<T>(
  entries: Record<string, T>,
  move: (value: T, lesson: string) => T = (value) => value,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(entries))
    if (fromLegacyKey(key) === key) out[key] = value;
  for (const [key, value] of Object.entries(entries)) {
    const lesson = fromLegacyKey(key);
    if (lesson !== key && !Object.prototype.hasOwnProperty.call(out, lesson))
      out[lesson] = move(value, lesson);
  }
  return out;
}
/**
 * A v3 record's completions, each naming a release. A v3 record written
 * before completions recorded one (an early export) holds `true`, which is
 * read as MVP_RELEASE; `false` was never a completion.
 */
function withReleases(
  completed: Record<string, string | boolean>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(completed))
    if (value !== false) out[key] = value === true ? MVP_RELEASE : value;
  return out;
}
/**
 * Reads a stored blob of any version into the current shape, or null when it
 * is not a well-formed progress record. v1 and v2 blobs are migrated; a v2 or
 * v3 blob keeps its own deviceId.
 */
function readState(raw: string | null, deviceId: string): ProgressState | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(o) || ![1, 2, 3].includes(o.version as number)) return null;
  if (!wellFormed(o, o.version !== 3)) return null;
  if (o.version === 1)
    return migrateV2toV3(migrateV1toV2(o as ProgressStateV1, deviceId));
  // A blob without a fingerprint has simply not merged that key's blob yet.
  const stored = {
    ...o,
    v1Fingerprint: typeof o.v1Fingerprint === 'string' ? o.v1Fingerprint : null,
    deviceId: o.deviceId || deviceId,
  };
  if (o.version === 2) return migrateV2toV3(stored as ProgressStateV2);
  const v3 = stored as ProgressState;
  return {
    ...v3,
    v2Fingerprint: typeof o.v2Fingerprint === 'string' ? o.v2Fingerprint : null,
    completed: underPermanentIds(
      withReleases(o.completed as Record<string, string | boolean>),
    ),
    sessions: playable(
      underPermanentIds(v3.sessions, (run, lesson) => ({ ...run, lesson })),
    ),
  };
}
/** Tolerant hydration: v1, v2 or v3 in, v3 out; anything else falls back to defaults. */
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
 * length). It is not cryptographic: it only has to notice that the v1 or v2
 * key holds something other than what was last merged.
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
/** What loadProgress() reads: the progress keys as stored, and what is kept aside. */
export type StoredProgress = {
  v1?: string | null;
  v2?: string | null;
  v3?: string | null;
  /** Whether a v1 backup, `polilingo.progress.v1.bak-*`, already exists. */
  backupExists: boolean;
  /**
   * Blobs already kept aside, by key: every `polilingo.progress.unknown-*`
   * and `polilingo.progress.invalid-*`.
   */
  kept?: Record<string, string>;
};
/**
 * Where to keep `raw` aside under `base`: the plain name while it is free,
 * then `<base>-<n>`, one more than the highest n there, so a blob kept aside
 * never replaces another. Null when `raw` is already kept under one of them.
 */
function keepAside(
  kept: Record<string, string>,
  base: string,
  raw: string,
  numbered = false,
): StorageWrite | null {
  let highest = 0;
  for (const [key, value] of Object.entries(kept)) {
    const suffix = key === base ? '0' : key.slice(base.length + 1);
    if (key !== base && !(key.startsWith(`${base}-`) && /^\d+$/.test(suffix)))
      continue;
    if (value === raw) return null;
    highest = Math.max(highest, Number(suffix));
  }
  if (!numbered && !(base in kept)) return { key: base, value: raw };
  return { key: `${base}-${highest + 1}`, value: raw };
}
/**
 * Decides what to load, and what to write, on every load without touching
 * storage itself, so the rules that cannot be retrofitted are testable:
 *
 *   - the v1 blob is copied verbatim to a backup key before anything else,
 *     exactly once;
 *   - this build writes only the v3 key. The v2 and v1 keys are read on every
 *     load and never written, so an older build rolled back to finds them as
 *     it left them;
 *   - a blob from a newer app version, in any of the three keys, is kept once
 *     under an `unknown-` key rather than discarded, and the learner sees the
 *     progress the other keys hold instead of a fresh start;
 *   - a v3 record this build cannot read at all is kept under an `invalid-`
 *     key before a fresh start can replace it. Nothing else is ever set
 *     aside: a record from an older or newer content release is read, and
 *     only an unfinished run the release no longer fits is left out;
 *   - progress an older build wrote to the v2 or v1 key after this build's
 *     state exists is merged back in.
 *
 * The last rule is for rollbacks and stale tabs. v0.2 reads and writes only
 * the v2 key (merging v1 into it), and every build before it only the v1 key,
 * so a learner who keeps going on one of them after the migration adds to
 * that key, and the v3 state would never show it. So whenever the v2 or v1
 * blob differs from the one last merged, it is merged into the v3 state with
 * mergeProgress(), and the state records its fingerprint. Merging only on a
 * change, rather than on every load, is what keeps a reset from being undone:
 * a reset leaves both keys in place but keeps the fingerprints, so the old
 * progress stays away until an older build writes to them again. v0.2 writes
 * a v2 key where there was none as soon as it is opened, so a new v2 blob that
 * holds only the v1 blob already merged is recorded, not merged (see
 * onlyV1Again()). The merge is idempotent, so loading twice changes nothing
 * either way.
 *
 * With no v3 state yet, the v2 state is migrated and becomes it, carrying the
 * fingerprint of the v1 blob v0.2 last merged, so that blob is not merged
 * twice. The v2 key is merged before the v1 key: where only one side can win,
 * as with an unfinished run, v0.2's newer copy does.
 */
export function loadProgress(
  stored: StoredProgress,
  today: string,
  deviceId: string,
): { state: ProgressState; writes: StorageWrite[] } {
  const writes: StorageWrite[] = [];
  const kept = { ...stored.kept };
  const put = (write: StorageWrite | null) => {
    if (!write) return;
    writes.push(write);
    kept[write.key] = write.value;
  };
  const v1 = stored.v1 ?? null;
  if (v1 !== null && !stored.backupExists)
    put({ key: BACKUP_KEY_PREFIX + today, value: v1 });
  // True, once it is kept aside, for a blob a newer app version wrote.
  const fromNewerApp = (raw: string) => {
    const version = storedVersion(raw);
    if (version === null || version <= 3) return false;
    put(keepAside(kept, UNKNOWN_KEY_PREFIX + version, raw));
    return true;
  };
  const v3 = stored.v3 ?? null;
  let state: ProgressState | null = null;
  if (v3 !== null && !fromNewerApp(v3)) {
    state = readState(v3, deviceId);
    // The live key is about to be written, so a record in it that cannot be
    // read is kept first. If that write fails, nothing is persisted.
    if (!state)
      put(
        keepAside(
          kept,
          `${INVALID_KEY_PREFIX}${storedVersion(v3) ?? 'none'}`,
          v3,
          true,
        ),
      );
  }
  for (const [raw, field] of [
    [stored.v2 ?? null, 'v2Fingerprint'],
    [v1, 'v1Fingerprint'],
  ] as const) {
    if (raw === null || fromNewerApp(raw)) continue;
    const print = fingerprint(raw);
    if (state?.[field] === print) continue;
    // A blob this build cannot read merges nothing and is not recorded, so a
    // later build that can read it still merges it. Nothing writes these
    // keys, so it stays where it is, and a v1 blob in its backup too.
    const old = readState(raw, deviceId);
    if (!old) continue;
    if (state && field === 'v2Fingerprint' && onlyV1Again(old, v1, state))
      state = { ...state, v2Fingerprint: print };
    else
      state = { ...(state ? mergeProgress(state, old) : old), [field]: print };
  }
  return { state: state ?? initialState(deviceId), writes };
}
/**
 * Whether a v2 blob holds nothing but the v1 blob this state has already
 * merged. v0.2 writes one when it is merely opened on a device with no v2 key,
 * such as a learner who went straight from the MVP to content releases, during
 * a rollback: it migrates the v1 key, as it always does, and its provider
 * saves the result. Merging it would bring back what a reset since then took
 * away, although the learner did nothing, so loadProgress() records its
 * fingerprint instead. Anything more in it, a lesson, a replay, a streak day
 * or XP, and the whole blob is merged as usual.
 *
 * Only the v1 blob whose fingerprint the state and the v2 blob both hold is
 * compared, and only while it is still in the v1 key. Any doubt is a merge.
 */
function onlyV1Again(
  v2: ProgressState,
  v1Raw: string | null,
  state: ProgressState,
): boolean {
  if (v1Raw === null || state.v1Fingerprint === null) return false;
  if (v2.v1Fingerprint !== state.v1Fingerprint) return false;
  if (fingerprint(v1Raw) !== state.v1Fingerprint) return false;
  const v1 = readState(v1Raw, state.deviceId);
  if (!v1) return false;
  const merged = mergeProgress(v1, v2);
  const size = (x: object) => Object.keys(x).length;
  return (
    merged.xp === v1.xp &&
    size(merged.completed) === size(v1.completed) &&
    size(merged.sessions) === size(v1.sessions) &&
    merged.rewarded.length === v1.rewarded.length &&
    size(merged.activity) === size(v1.activity) &&
    Object.entries(merged.activity).every(([day, n]) => v1.activity[day] === n)
  );
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
 * It reads, lets loadProgress() decide, then makes the backup and the writes
 * that keep blobs aside.
 * `persist` says whether this session may write the live key, v3. It is false
 * when storage cannot be read or one of those writes fails, and then the
 * learner keeps what was loaded in memory, with the storage warning showing,
 * and the live key is not written at all. So the live key is never written
 * before the v1 blob's backup exists, and a newer app's blob or an unreadable
 * record in it is never overwritten before its copy is safe. The next load
 * simply tries again.
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
    const kept: Record<string, string> = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(BACKUP_KEY_PREFIX)) backupExists = true;
      else if (
        key?.startsWith(UNKNOWN_KEY_PREFIX) ||
        key?.startsWith(INVALID_KEY_PREFIX)
      )
        kept[key] = storage.getItem(key) ?? '';
    }
    loaded = loadProgress(
      {
        v1: storage.getItem(STORAGE_KEY_V1),
        v2: storage.getItem(STORAGE_KEY_V2),
        v3: storage.getItem(STORAGE_KEY),
        backupExists,
        kept,
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
 * with `state` exactly as stored, so each completion carries the content
 * release it was first completed in. An older file's `true` imports as
 * MVP_RELEASE.
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
 * the award ledger arrives with accounts (D2); it is never summed. Completions
 * are a union, and a lesson completed on both sides keeps the release recorded
 * locally. The device's own fields, such as `deviceId` and the fingerprints,
 * stay local. Used for imports, and by loadProgress() to merge back what an
 * older build wrote.
 */
export function mergeProgress(
  local: ProgressState,
  incoming: ProgressState,
): ProgressState {
  // A lesson completed on both sides keeps the release recorded here.
  const completed = { ...incoming.completed, ...local.completed };
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
/** Why a file did not import. */
export type ImportRefusal =
  /** Not a PoliLingo progress file at all. */
  | 'not-progress'
  /** A progress file from a newer version of the app. */
  | 'newer'
  /** A progress file this build cannot read. */
  | 'damaged';
/**
 * Accepts an export file or a bare stored blob of any version, and merges it
 * in. Anything well formed imports, whichever content release it was made
 * under: completions on lessons this release does not have, and MVP keys its
 * keymap does not map, are kept, and only an unfinished run the release no
 * longer fits is left out.
 */
export function importProgress(
  state: ProgressState,
  raw: string,
): { ok: true; state: ProgressState } | { ok: false; reason: ImportRefusal } {
  const refuse = (reason: ImportRefusal) => ({ ok: false as const, reason });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse('not-progress');
  }
  let inner = parsed;
  if (
    isRecord(parsed) &&
    typeof parsed.format === 'string' &&
    parsed.format.startsWith('polilingo.progress.export@')
  ) {
    if (parsed.format !== EXPORT_FORMAT) return refuse('newer');
    inner = parsed.state;
  } else if (!isRecord(parsed) || typeof parsed.version !== 'number')
    return refuse('not-progress');
  const version = isRecord(inner) ? inner.version : undefined;
  if (typeof version === 'number' && version > 3) return refuse('newer');
  const incoming = readState(JSON.stringify(inner) ?? null, state.deviceId);
  if (!incoming) return refuse('damaged');
  return { ok: true, state: mergeProgress(state, incoming) };
}
