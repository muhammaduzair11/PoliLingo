import { courses, getCourse, type CourseId } from './courses.ts';
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
export type ProgressState = {
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
export const STORAGE_KEY = 'polilingo.progress.v1';
export function initialState(): ProgressState {
  return {
    version: 1,
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
  const c = getCourse(course)!;
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
export function parseState(raw: string | null): ProgressState {
  const fallback = initialState();
  if (!raw) return fallback;
  try {
    const s = JSON.parse(raw);
    if (
      s.version !== 1 ||
      !Number.isSafeInteger(s.xp) ||
      s.xp < 0 ||
      ![1, 2, 3].includes(s.dailyGoal) ||
      (s.selected !== null && !getCourse(s.selected)) ||
      !s.prefs ||
      ['sound', 'reducedMotion', 'transliteration'].some(
        (k) => typeof s.prefs[k] !== 'boolean',
      )
    )
      return fallback;
    if (
      !s.completed ||
      !s.activity ||
      !s.sessions ||
      !Array.isArray(s.rewarded) ||
      !s.rewarded.every((x: unknown) => typeof x === 'string')
    )
      return fallback;
    const validKeys = courses.flatMap((c) =>
      c.lessons.map((l) => lessonKey(c.id, l.id)),
    );
    if (
      Object.entries(s.completed).some(
        ([k, v]) => !validKeys.includes(k) || typeof v !== 'boolean',
      )
    )
      return fallback;
    if (
      Object.entries(s.activity).some(
        ([k, v]) =>
          !/^\d{4}-\d{2}-\d{2}$/.test(k) ||
          !Number.isSafeInteger(v) ||
          Number(v) < 0,
      )
    )
      return fallback;
    for (const [key, value] of Object.entries(s.sessions)) {
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
        return fallback;
    }
    return s as ProgressState;
  } catch {
    return fallback;
  }
}
