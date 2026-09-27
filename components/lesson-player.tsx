'use client';
/* oxlint-disable react/react-compiler -- The lesson initializes from persisted client state after hydration, resets local answer drafts when the persisted cursor advances, and reads its latest handlers from refs in a window key listener. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { preload } from 'react-dom';
import {
  ArrowRight,
  Check,
  Heart,
  Lightbulb,
  Star,
  Trophy,
  Flame,
  X,
  Volume2,
  VolumeX,
  Lock,
  BookOpen,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  attemptSeeds,
  bankOrder,
  choiceOrder,
  contextScene,
  crossedOut,
  hintNudge,
  matchOrders,
  scriptRuns,
  typeset,
  wrongChoiceCopy,
} from '@/app/lesson/lesson-logic';
import { useLearning } from './learning-provider';
import { Poli, artSrcSet } from './art';
import { Native } from './native';
import { SaveStreakCard } from './account/save-streak-card';
import { Loading, NotFoundView } from './status-views';
import {
  getCourse,
  evaluate,
  missingLessonRedirect,
  type Course,
} from '@/lib/content';
import { courseProgress } from '@/lib/learning-map';
import {
  advanceSession,
  lessonKey,
  localDate,
  newSession,
  recordAnswer,
  streak,
  unlocked,
} from '@/lib/progress';
import { randomId } from '@/lib/random-id';
import { plural } from '@/lib/words';

// How wide each Poli is drawn, so a phone fetches a small file, not the
// 840px one the landing page needs.
const SMALL_POLI = '(max-width: 580px) 96px, 150px';
const RESUME_POLI = '160px';
const CELEBRATION_POLI = '(max-width: 580px) 240px, 320px';

/** The small caps line above each question: what kind of question it is. */
const EYEBROW = {
  meaning: 'PICK THE MEANING',
  translation: 'PICK THE PHRASE',
  // The heading already asks “What would you say?”, so the eyebrow does not.
  context: 'PICK WHAT FITS',
  match: 'MATCH THE PAIRS',
  assemble: 'BUILD THE MEANING',
} as const;

/** A note in the content's words, its Arabic-script runs set as script. */
function ScriptText({ text, course }: { text: string; course: Course }) {
  return (
    <>
      {scriptRuns(typeset(text)).map((run, i) =>
        run.script ? (
          <span
            key={i}
            className="native note-script"
            lang={course.lang}
            dir={course.dir}
          >
            {run.text}
          </span>
        ) : (
          run.text
        ),
      )}
    </>
  );
}

/** A study card's note: two lines, and the rest behind “More”. */
function StudyNote({ text, course }: { text: string; course: Course }) {
  const id = useId();
  const box = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || open) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // Noto Naskh arriving late changes how much of the note fits.
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [open, text]);
  return (
    <div className="study-card-note">
      <p ref={box} id={id} className={open ? 'is-open' : undefined}>
        <ScriptText text={text} course={course} />
      </p>
      {(clamped || open) && (
        <button
          type="button"
          className="study-more"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}

/** The bar that keeps a screen's main action at the bottom of the viewport. */
function ActionBar({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`lesson-footer ${className}`}>
      <div className="lesson-bar">{children}</div>
    </div>
  );
}

export function LessonPlayer({
  courseId,
  lessonId,
}: {
  courseId: string;
  lessonId: string;
}) {
  const { state, ready, update, play } = useLearning();
  const router = useRouter();
  const course = getCourse(courseId);
  const lesson = course?.lessons.find((l) => l.id === lessonId);
  const key = lessonKey(courseId, lessonId);
  const session = state.sessions[key];
  const [resume, setResume] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [tiles, setTiles] = useState<number[]>([]);
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [left, setLeft] = useState<string | null>(null);
  const [matchMistake, setMatchMistake] = useState(false);
  const [matchHint, setMatchHint] = useState('');
  const [wrongTap, setWrongTap] = useState<string | null>(null);
  const [hintUsed, setHintUsed] = useState(false);
  const [hintPair, setHintPair] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  // Set by the action that changes the screen, so the effects below move
  // focus and scroll only then, never on a reload or a sync.
  const focusHeading = useRef(false);
  const focusContinue = useRef(false);
  // The latest handlers, for the window key listener and the timer that
  // checks a finished match board.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  const checkNow = useRef<() => void>(() => {});
  // A lesson this release does not hold, in a course it does (retired, or an
  // old bookmark of one): the course's map instead of "not found". Only once
  // ready: the provider activates a published release in its mount effect,
  // after this component's first effects, so a lesson that exists only in
  // that release would otherwise be sent away on a direct load.
  const away = ready ? missingLessonRedirect(courseId, lessonId) : undefined;
  useEffect(() => {
    if (away) router.replace(away);
  }, [away, router]);
  useEffect(() => {
    if (initialized || !ready || !course || !lesson) return;
    if (!unlocked(state, course.id, lesson.id)) {
      setInitialized(true);
      return;
    }
    if (!session)
      update((s) => ({
        ...s,
        selected: course.id,
        sessions: {
          ...s.sessions,
          [key]: newSession(
            course.id,
            lesson.id,
            randomId(),
            lesson.exercises.length,
          ),
        },
      }));
    // Only a run with an answer in it has a spot worth offering back. One
    // left on its study screen or first question simply opens there.
    else if (!session.done && (session.cursor > 0 || session.feedback))
      setResume(true);
    setInitialized(true);
  }, [initialized, ready, key, course, lesson, session, state, update]);
  useEffect(() => {
    setSelected('');
    setTiles([]);
    setPairs({});
    setLeft(null);
    setMatchMistake(false);
    setMatchHint('');
    setWrongTap(null);
    setHintUsed(false);
    setHintPair(null);
  }, [session?.cursor, session?.id]);
  // A new screen starts at its top, with focus on its heading.
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    heading.current?.focus({ preventScroll: true });
  }, [session?.cursor, session?.id, session?.studied, session?.done, resume]);
  // After Check, focus moves to Continue, so Enter goes on.
  useEffect(() => {
    if (!session?.feedback || !focusContinue.current) return;
    focusContinue.current = false;
    continueButton.current?.focus({ preventScroll: true });
  }, [session?.feedback]);
  // A wrong pair flashes for a moment, then the board is calm again.
  useEffect(() => {
    if (!wrongTap) return;
    const timer = setTimeout(() => setWrongTap(null), 400);
    return () => clearTimeout(timer);
  }, [wrongTap]);
  // Number keys pick the numbered answers; Enter checks, then continues.
  useEffect(() => {
    function listener(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing)
        return;
      const target = e.target instanceof Element ? e.target : null;
      if (
        target?.closest(
          'input:not([type="radio"]):not([type="checkbox"]), textarea, select, [contenteditable]:not([contenteditable="false"])',
        )
      )
        return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]'))
        return;
      onKey.current(e);
    }
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  // The tab names the lesson. The server titles the baseline release's
  // lessons; this covers one that only a newer published release holds.
  const titleLesson = lesson?.title;
  const titleCourse = course?.name;
  useEffect(() => {
    if (titleLesson && titleCourse)
      document.title = `${titleLesson} · ${titleCourse} · PoliLingo`;
  }, [titleLesson, titleCourse]);
  const exercise =
    lesson && session
      ? (lesson.exercises[
          session.queue[Math.min(session.cursor, session.queue.length - 1)]
        ] ?? lesson.exercises[0])
      : undefined;
  const onExercise =
    initialized && !!session && session.studied && !session.done && !resume;
  // Poli's answer poses, fetched while the learner thinks, so the reaction
  // to Check is instant.
  useEffect(() => {
    if (!onExercise) return;
    for (const pose of ['celebrate', 'encourage'])
      preload(`/assets/poli-${pose}-360.avif`, {
        as: 'image',
        type: 'image/avif',
        imageSrcSet: artSrcSet(`poli-${pose}`, 'avif'),
        imageSizes: SMALL_POLI,
      });
  }, [onExercise]);
  // The last pair found checks the board by itself.
  const boardComplete =
    onExercise &&
    exercise?.kind === 'match' &&
    !session?.feedback &&
    exercise.options.every((p) => pairs[p.id]);
  useEffect(() => {
    if (!boardComplete) return;
    const timer = setTimeout(() => checkNow.current(), 450);
    return () => clearTimeout(timer);
  }, [boardComplete]);
  if (!course) return <NotFoundView />;
  if (!lesson) return <Loading />;
  if (!ready || !initialized) return <Loading />;
  if (!unlocked(state, course.id, lesson.id)) {
    const previous =
      course.lessons[course.lessons.findIndex((l) => l.id === lesson.id) - 1];
    return (
      <main id="main-content" className="locked-message">
        <Poli pose="rest" priority sizes={RESUME_POLI} />
        <Lock size={26} className="locked-icon" aria-hidden="true" />
        <h1>This stop is a little further ahead.</h1>
        <p>
          {previous
            ? `Finish “${previous.title}” to unlock this part of your adventure.`
            : 'Finish the previous lesson to unlock this part of your adventure.'}
        </p>
        <Link className="button button-purple" href={`/learn/${course.id}`}>
          Back to your map <ArrowRight size={19} />
        </Link>
      </main>
    );
  }
  if (!session || !exercise) return <Loading />;
  // The lesson's own exercise count, recorded when the session began. The
  // first pass is exercises 0..size-1; anything after that is a retry.
  // A finished run is kept even when the release has since changed the
  // lesson's exercises, so its queue may point past them. It only shows its
  // results, which do not use the exercise.
  const size = session.size;
  const feedback = session.feedback;
  const retrying = !session.done && session.cursor >= size;
  const retryNumber = session.cursor - size + 1;
  const retryCount = session.queue.length - size;
  // First pass: the share of questions done. Second tries keep it full, so
  // the bar never goes backwards when a wrong answer joins the queue.
  const progress =
    session.done || retrying ? 100 : (session.cursor / size) * 100;
  const progressText = session.done
    ? 'Lesson complete'
    : retrying
      ? `Second tries, ${retryNumber} of ${retryCount}`
      : session.studied
        ? `Question ${session.cursor + 1} of ${size}`
        : 'Not started yet';
  const seeds = attemptSeeds(
    exercise.id,
    session.id,
    session.queue,
    session.cursor,
  );
  const choice =
    exercise.kind === 'meaning' ||
    exercise.kind === 'translation' ||
    exercise.kind === 'context';
  const options = choice
    ? choiceOrder(exercise.options, seeds)
    : exercise.options;
  const board =
    exercise.kind === 'match'
      ? matchOrders(exercise.options, seeds)
      : { left: [], right: [] };
  const answerWords = exercise.phrase.meaning.split(' ');
  const bank = [...answerWords, ...exercise.tiles];
  const bankIndexes =
    exercise.kind === 'assemble'
      ? bankOrder(bank, answerWords.length, seeds)
      : [];
  const matchedRight = new Set(Object.values(pairs));
  const pairNumber = (id: string) => Object.keys(pairs).indexOf(id) + 1;
  // What "A little hint?" does: say something that nudges without naming
  // the answer, or, when nothing safe can be said, cross out a wrong choice.
  const nudge = choice ? hintNudge(exercise) : '';
  const crossable =
    choice && !nudge ? crossedOut(exercise, seeds[seeds.length - 1]) : '';
  const crossed = hintUsed ? crossable : '';
  const answered =
    exercise.kind === 'assemble'
      ? tiles.length > 0
      : exercise.kind === 'match'
        ? Object.keys(pairs).length === exercise.options.length
        : !!selected;
  function restart() {
    focusHeading.current = true;
    update((s) => ({
      ...s,
      sessions: {
        ...s.sessions,
        [key]: newSession(
          course!.id,
          lesson!.id,
          randomId(),
          lesson!.exercises.length,
        ),
      },
    }));
    setResume(false);
    setRestartOpen(false);
  }
  function check() {
    if (!answered || feedback) return;
    const answer =
      exercise!.kind === 'assemble'
        ? tiles.map((i) => bank[i])
        : exercise!.kind === 'match'
          ? pairs
          : selected;
    const correct =
      evaluate(exercise!, answer) &&
      !(exercise!.kind === 'match' && matchMistake);
    focusContinue.current = true;
    update((s) => ({
      ...s,
      sessions: {
        ...s.sessions,
        [key]: recordAnswer(s.sessions[key], correct),
      },
    }));
    play(correct);
  }
  checkNow.current = check;
  function next() {
    focusHeading.current = true;
    update((s) => advanceSession(s, key, localDate()));
  }
  function openHint() {
    setHintUsed(true);
    if (exercise!.kind === 'match')
      setHintPair(board.left.find((p) => !pairs[p.id])?.id ?? null);
    if (crossable && selected === crossable) setSelected('');
  }
  function pickLeft(id: string) {
    setLeft(id);
    setWrongTap(null);
    setMatchHint('Now choose its English meaning.');
  }
  function pickRight(id: string) {
    if (!left) {
      setMatchHint('Choose an expression on the left first.');
      return;
    }
    if (left === id) {
      const found = { ...pairs, [left]: id };
      const all = exercise!.options.every((p) => found[p.id]);
      setPairs(found);
      setLeft(null);
      setMatchHint(
        all ? 'All pairs found!' : 'A lovely connection. Keep going!',
      );
      // The last pair's sound is the board's own result, played by check().
      if (!all) play(true);
    } else {
      setMatchMistake(true);
      setLeft(null);
      setWrongTap(id);
      setMatchHint('Not quite a pair. Pick an expression and try again.');
      play(false);
    }
  }
  onKey.current = (e: KeyboardEvent) => {
    if (!onExercise) return;
    if (/^[1-8]$/.test(e.key)) {
      if (feedback) return;
      const n = Number(e.key);
      if (exercise.kind === 'match') {
        const card = n <= 4 ? board.left[n - 1] : board.right[n - 5];
        if (!card) return;
        if (n <= 4 && !pairs[card.id]) pickLeft(card.id);
        if (n > 4 && !matchedRight.has(card.id)) pickRight(card.id);
      } else if (choice) {
        const option = options[n - 1];
        if (!option || option.id === crossed) return;
        setSelected(option.id);
      } else return;
      e.preventDefault();
      return;
    }
    if (e.key !== 'Enter') return;
    // Buttons, links and the hint answer Enter themselves.
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('a, button, summary, [role="button"]')) return;
    if (feedback) next();
    else if (answered) check();
    else return;
    e.preventDefault();
  };
  const restartControl = (
    <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
      <AlertDialogTrigger className="restart-link">
        Start this lesson again
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>A fresh run at this lesson?</AlertDialogTitle>
          <AlertDialogDescription>
            Your unfinished answers for this lesson will be cleared. Your
            completed lessons, XP, and streak stay safe.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep learning</AlertDialogCancel>
          <AlertDialogAction onClick={restart}>
            Restart lesson
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  const header = (
    <header className="lesson-header">
      <Link
        className="icon-button lesson-leave"
        href={`/learn/${course.id}`}
        aria-label="Save and leave lesson"
        title="Save and leave"
      >
        <X size={23} />
      </Link>
      <Progress
        value={progress}
        aria-label="Lesson progress"
        aria-valuetext={progressText}
        className="lesson-progress"
      />
      {retrying ? (
        <span className="lesson-retry-chip">
          Second tries {retryNumber} of {retryCount}
        </span>
      ) : session.studied ? (
        <span className="lesson-count">
          {Math.min(session.cursor + 1, size)} / {size}
        </span>
      ) : null}
      <div className="lesson-tools">
        <button
          className="icon-button"
          aria-label={
            state.prefs.sound ? 'Turn game sounds off' : 'Turn game sounds on'
          }
          title={state.prefs.sound ? 'Sounds on' : 'Sounds off'}
          onClick={() =>
            update((s) => ({
              ...s,
              prefs: { ...s.prefs, sound: !s.prefs.sound },
            }))
          }
        >
          {state.prefs.sound ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
      </div>
    </header>
  );
  if (session.done) {
    const lessonIndex = course.lessons.findIndex((l) => l.id === lesson.id);
    const nextLesson = course.lessons[lessonIndex + 1];
    const earned = courseProgress(state.completed, course).finished;
    return (
      <main id="main-content" className="lesson-page lesson-page-done">
        <header className="lesson-header lesson-header-done">
          <Link className="lesson-back" href={`/learn/${course.id}`}>
            <X size={20} aria-hidden="true" /> Back to your map
          </Link>
        </header>
        <section className="celebration">
          <div className="celebration-art">
            <Poli pose="celebrate" priority sizes={CELEBRATION_POLI} />
          </div>
          <span className="eyebrow purple">THAT LITTLE WIN? ALL YOURS.</span>
          <h1 ref={heading} tabIndex={-1}>
            You did a whole new thing.
          </h1>
          <p>
            {lesson.title} · {course.name}
            <br />A little more language. A little more connection.
          </p>
          <div className="result-stats">
            <div className="result-stat">
              <Star aria-hidden="true" />
              <strong>+{session.reward}</strong>
              <small>XP EARNED</small>
            </div>
            <div className="result-stat">
              <Check aria-hidden="true" />
              <strong>
                {Math.round((session.firstCorrect / size) * 100)}%
              </strong>
              <small>FIRST-TRY ACCURACY</small>
            </div>
            <div className="result-stat">
              <Flame aria-hidden="true" />
              <strong>{streak(state.activity)}</strong>
              <small>DAY STREAK</small>
            </div>
          </div>
          {earned && (
            <div className="badge-earned">
              <Trophy size={35} aria-hidden="true" />
              <div>
                <h2>{course.name} first steps</h2>
                <p>Your first course badge. You earned every bit of it.</p>
              </div>
            </div>
          )}
        </section>
        <ActionBar className="celebration-bar">
          <button
            className="button button-purple lesson-cta"
            onClick={() => {
              if (nextLesson) {
                const nextKey = lessonKey(course!.id, nextLesson.id);
                update((s) => ({
                  ...s,
                  sessions: {
                    ...s.sessions,
                    [nextKey]:
                      s.sessions[nextKey] && !s.sessions[nextKey].done
                        ? s.sessions[nextKey]
                        : newSession(
                            course!.id,
                            nextLesson.id,
                            randomId(),
                            nextLesson.exercises.length,
                          ),
                  },
                }));
                router.push(`/lesson/${course!.id}/${nextLesson.id}`);
              } else router.push(`/learn/${course!.id}`);
            }}
          >
            {nextLesson
              ? 'On to the next little win'
              : 'Back to your adventure'}
            <ArrowRight size={20} />
          </button>
        </ActionBar>
        <div className="celebration-after">
          <SaveStreakCard
            streak={streak(state.activity)}
            completedCount={Object.keys(state.completed).length}
            mapHref={`/learn/${course.id}`}
          />
          <button className="restart-link" onClick={restart}>
            Play this lesson again · earn 5 XP
          </button>
        </div>
      </main>
    );
  }
  if (resume) {
    const toRevisit = session.queue.length - session.cursor;
    return (
      <main id="main-content" className="lesson-page">
        {header}
        <section className="resume-card">
          <Poli pose="welcome" priority sizes={RESUME_POLI} />
          <span className="eyebrow purple">RIGHT WHERE YOU LEFT OFF</span>
          <h1 ref={heading} tabIndex={-1}>
            Saved you a spot.
          </h1>
          <p>
            {lesson.title} · {course.name}
            <br />
            {retrying
              ? `${toRevisit} ${plural(toRevisit, 'answer')} left to revisit.`
              : `Question ${session.cursor + 1} of ${size}.`}
          </p>
          <button
            className="button button-purple"
            onClick={() => {
              focusHeading.current = true;
              setResume(false);
            }}
          >
            Let’s keep going <ArrowRight size={19} />
          </button>
          {restartControl}
        </section>
      </main>
    );
  }
  if (!session.studied)
    return (
      <main id="main-content" className="lesson-page">
        {header}
        <section className="lesson-shell lesson-study">
          <div className="lesson-label">
            <span>
              {course.name.toUpperCase()} · LESSON{' '}
              {course.lessons.findIndex((l) => l.id === lesson.id) + 1}
            </span>
            <span>MEET YOUR FIRST WORDS</span>
          </div>
          <div className="study-intro">
            <Poli pose="welcome" priority sizes={SMALL_POLI} />
            <div>
              <h1 ref={heading} tabIndex={-1}>
                {lesson.title}
              </h1>
              <p>{typeset(lesson.objective)}</p>
            </div>
          </div>
          <div className="study-grid">
            {lesson.phrases.map((p) => (
              <article key={p.id} className="study-card">
                <Native phrase={p} course={course} />
                <strong>{p.meaning}</strong>
                {p.note && <StudyNote text={p.note} course={course} />}
              </article>
            ))}
          </div>
          <p className="study-note">
            You can peek at a hint whenever you need one. That’s learning, too.
          </p>
        </section>
        <ActionBar>
          <p className="lesson-bar-note">
            <BookOpen size={16} aria-hidden="true" />
            Script + meaning, at your pace.
          </p>
          <button
            className="button button-purple lesson-cta"
            onClick={() => {
              focusHeading.current = true;
              update((s) => ({
                ...s,
                sessions: {
                  ...s.sessions,
                  [key]: { ...s.sessions[key], studied: true },
                },
              }));
            }}
          >
            Let’s try it <ArrowRight size={18} />
          </button>
        </ActionBar>
      </main>
    );
  const title =
    exercise.kind === 'translation'
      ? 'How do you say this?'
      : exercise.kind === 'context'
        ? 'What would you say?'
        : exercise.kind === 'assemble'
          ? 'Build what this means.'
          : typeset(exercise.prompt);
  const picked = choice
    ? exercise.options.find((p) => p.id === selected)
    : undefined;
  const answerLine = `“${exercise.phrase.roman}” means “${exercise.phrase.meaning}”.`;
  const feedbackTitle = !feedback
    ? ''
    : feedback.correct
      ? 'That’s a lovely little win.'
      : exercise.kind === 'match'
        ? 'All pairs found. We’ll practise one again.'
        : 'A little practice makes it stick.';
  const sources = [
    ...new Set(
      (exercise.kind === 'match' ? exercise.options : [exercise.phrase]).map(
        (p) => p.source,
      ),
    ),
  ];
  let feedbackBody: ReactNode = null;
  if (feedback) {
    if (exercise.kind === 'match')
      feedbackBody = feedback.correct
        ? 'Every pair, connected. You’re getting the hang of this.'
        : 'There was a slip on the way, so this board comes back before you finish.';
    else if (feedback.correct)
      feedbackBody = (
        <>
          <strong>{answerLine}</strong>{' '}
          {exercise.phrase.note && (
            <ScriptText text={exercise.phrase.note} course={course} />
          )}
        </>
      );
    else {
      const said =
        exercise.kind === 'assemble' && tiles.length
          ? `You built “${tiles.map((i) => bank[i]).join(' ')}”.`
          : picked
            ? wrongChoiceCopy(exercise.kind, picked, exercise.phrase).picked
            : '';
      feedbackBody = (
        <>
          {said && `${said} `}
          <strong>{answerLine}</strong> We’ll come back to it before you finish.
        </>
      );
    }
  }
  return (
    <main id="main-content" className="lesson-page">
      {header}
      <section className={`lesson-shell lesson-kind-${exercise.kind}`}>
        <div className="lesson-label">
          <span>
            {course.name.toUpperCase()} · {lesson.title.toUpperCase()}
          </span>
          <span>
            {retrying ? 'A LITTLE SECOND TRY' : EYEBROW[exercise.kind]}
          </span>
        </div>
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        {exercise.kind === 'match' ? (
          <p className="lead">Tap an expression, then its English meaning.</p>
        ) : exercise.kind === 'assemble' ? (
          <p className="lead">
            Tap the words in order. Tap a placed word to take it back.
          </p>
        ) : null}
        {exercise.kind !== 'match' && (
          <div className="lesson-mascot-row">
            <Poli
              pose={
                feedback
                  ? feedback.correct
                    ? 'celebrate'
                    : 'encourage'
                  : 'thinking'
              }
              sizes={SMALL_POLI}
            />
            <div className="prompt-bubble">
              {exercise.kind === 'context' ? (
                feedback ? (
                  <span className="english-meaning">
                    {feedback.correct ? 'Exactly that.' : 'Every try counts.'}
                  </span>
                ) : (
                  <span className="prompt-scene">
                    {contextScene(typeset(exercise.prompt))}
                  </span>
                )
              ) : exercise.kind === 'translation' ? (
                <span className="english-meaning">
                  {exercise.phrase.meaning}
                </span>
              ) : (
                <Native phrase={exercise.phrase} course={course} large />
              )}
            </div>
          </div>
        )}
        {exercise.kind === 'match' ? (
          <>
            <div className="match-grid">
              <div className="match-column">
                {board.left.map((p) => {
                  const n = pairNumber(p.id);
                  return (
                    <button
                      key={p.id}
                      className={`answer-option ${left === p.id ? 'selected' : ''} ${n ? 'matched' : ''} ${hintPair === p.id && !n ? 'match-hinted' : ''}`}
                      disabled={!!n || !!feedback}
                      aria-pressed={left === p.id}
                      onClick={() => pickLeft(p.id)}
                    >
                      <Native phrase={p} course={course} />
                      {n > 0 && (
                        <span className="match-badge">
                          <Check size={12} aria-hidden="true" />
                          <span aria-hidden="true">{n}</span>
                          <span className="sr-only">, pair {n}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="match-column">
                {board.right.map((p) => {
                  const n = matchedRight.has(p.id) ? pairNumber(p.id) : 0;
                  return (
                    <button
                      key={p.id}
                      className={`answer-option ${n ? 'matched' : ''} ${wrongTap === p.id ? 'match-wrong' : ''} ${hintPair === p.id && !n ? 'match-hinted' : ''}`}
                      disabled={!!n || !!feedback}
                      onClick={() => pickRight(p.id)}
                    >
                      <span className="answer-text">{p.meaning}</span>
                      {n > 0 && (
                        <span className="match-badge">
                          <Check size={12} aria-hidden="true" />
                          <span aria-hidden="true">{n}</span>
                          <span className="sr-only">, pair {n}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <output className="match-hint">{matchHint}</output>
          </>
        ) : exercise.kind === 'assemble' ? (
          <>
            <div
              className={`assembly-tray ${feedback ? (feedback.correct ? 'tray-right' : 'tray-wrong') : ''}`}
              aria-label="Your assembled answer"
            >
              {tiles.length ? (
                tiles.map((i, position) => (
                  <button
                    key={i}
                    className="word-tile"
                    disabled={!!feedback}
                    aria-label={`Remove ${bank[i]} at position ${position + 1}`}
                    onClick={() => setTiles((t) => t.filter((n) => n !== i))}
                  >
                    {bank[i]}
                  </button>
                ))
              ) : (
                <span>Your words go here…</span>
              )}
            </div>
            <div className="word-bank" aria-label="Available words">
              {bankIndexes.map((i) => (
                <button
                  className={`word-tile ${hintUsed && i === 0 && !tiles.includes(0) ? 'word-hinted' : ''}`}
                  key={i}
                  disabled={tiles.includes(i) || !!feedback}
                  onClick={() => setTiles((t) => [...t, i])}
                >
                  {bank[i]}
                </button>
              ))}
            </div>
          </>
        ) : (
          <RadioGroup
            value={selected}
            onValueChange={(v) => {
              if (!feedback) setSelected(String(v));
            }}
            aria-label="Choose your answer"
            disabled={!!feedback}
            className={`answer-options ${exercise.kind === 'meaning' ? '' : 'answer-options--native'}`}
          >
            {options.map((p, i) => {
              const isAnswer = p.id === exercise.phrase.id;
              const wrongPick =
                !!feedback && !feedback.correct && selected === p.id;
              const isCrossed = crossed === p.id;
              return (
                <label
                  key={p.id}
                  className={`answer-option ${selected === p.id ? 'selected' : ''} ${feedback && isAnswer ? 'answer-correct' : ''} ${wrongPick ? 'answer-incorrect' : ''} ${isCrossed ? 'answer-crossed' : ''}`}
                >
                  <RadioGroupItem
                    className="sr-only"
                    value={p.id}
                    disabled={isCrossed}
                  />
                  <span className="option-index" aria-hidden="true">
                    {i + 1}
                  </span>
                  {exercise.kind === 'meaning' ? (
                    <span className="answer-text">{p.meaning}</span>
                  ) : (
                    <Native phrase={p} course={course} />
                  )}
                  {feedback && isAnswer && (
                    <span className="answer-mark answer-mark-right">
                      <Check size={16} aria-hidden="true" />
                      <span className="sr-only">, the answer</span>
                    </span>
                  )}
                  {wrongPick && (
                    <span className="answer-mark answer-mark-wrong">
                      <X size={16} aria-hidden="true" />
                      <span className="sr-only">, your pick</span>
                    </span>
                  )}
                  {isCrossed && (
                    <span className="sr-only">, crossed out by Poli</span>
                  )}
                </label>
              );
            })}
          </RadioGroup>
        )}
        {!feedback && (
          <details
            className="lesson-help"
            key={exercise.id + session.cursor}
            onToggle={(e) => {
              if (e.currentTarget.open) openHint();
            }}
          >
            <summary>
              <Lightbulb size={17} aria-hidden="true" />A little hint?
            </summary>
            <p>
              {exercise.kind === 'match' ? (
                'Poli lit up one pair for you.'
              ) : exercise.kind === 'assemble' ? (
                `It starts with “${bank[0]}”.`
              ) : nudge ? (
                <ScriptText text={nudge} course={course} />
              ) : (
                'Poli crossed one out. One fewer to choose from.'
              )}
            </p>
          </details>
        )}
      </section>
      <p className="sr-only" aria-live="polite">
        {feedback
          ? `${feedbackTitle} ${exercise.kind === 'match' ? '' : answerLine}`
          : ''}
      </p>
      {feedback ? (
        <section
          className={`lesson-footer feedback ${feedback.correct ? 'right' : 'wrong'}`}
          aria-label="How you did"
        >
          <div className="lesson-bar">
            <div className="feedback-content">
              <h2 className="feedback-title">
                {feedback.correct ? (
                  <Check size={23} aria-hidden="true" />
                ) : (
                  <Heart size={23} aria-hidden="true" />
                )}
                {feedbackTitle}
              </h2>
              <p className="feedback-body">{feedbackBody}</p>
              <p className="feedback-source">
                {sources.map((s, i) => (
                  <span key={s}>
                    {i > 0 && ' · '}
                    {/^https?:\/\//.test(s) ? (
                      <a href={s} target="_blank" rel="noreferrer">
                        Phrase reference ↗
                      </a>
                    ) : (
                      `Source: ${s}`
                    )}
                  </span>
                ))}
              </p>
            </div>
            <button
              ref={continueButton}
              className="button button-purple lesson-cta"
              onClick={next}
            >
              {session.cursor + 1 === session.queue.length
                ? 'Finish lesson'
                : 'Continue'}
              <ArrowRight size={18} />
            </button>
          </div>
        </section>
      ) : (
        <ActionBar>
          <p className="lesson-bar-note">
            <Heart size={16} aria-hidden="true" />
            Good things take a little practice.
          </p>
          <button
            className="button button-purple lesson-cta"
            disabled={!answered}
            onClick={check}
          >
            Check answer <Check size={18} />
          </button>
        </ActionBar>
      )}
    </main>
  );
}
