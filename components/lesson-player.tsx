'use client';
/* oxlint-disable react/react-compiler -- The lesson initializes from persisted client state after hydration and resets local answer drafts when the persisted cursor advances. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Heart,
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
import { useLearning } from './learning-provider';
import { Poli } from './art';
import { Native } from './native';
import { MotionButton } from './site-chrome';
import { Loading, NotFoundView } from './status-views';
import { getCourse, evaluate } from '@/lib/courses';
import {
  advanceSession,
  lessonKey,
  localDate,
  newSession,
  recordAnswer,
  streak,
  unlocked,
} from '@/lib/progress';

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
  const heading = useRef<HTMLHeadingElement>(null);
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
          [key]: newSession(course.id, lesson.id, crypto.randomUUID()),
        },
      }));
    else if (!session.done && (session.studied || session.cursor > 0))
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
  }, [session?.cursor, session?.id]);
  if (!course || !lesson) return <NotFoundView />;
  if (!ready || !initialized) return <Loading />;
  if (!unlocked(state, course.id, lesson.id))
    return (
      <main id="main-content" className="locked-message">
        <Lock size={42} style={{ margin: 'auto', color: '#6935ce' }} />
        <h1>This stop is a little further ahead.</h1>
        <p>Finish the previous lesson to unlock this part of your adventure.</p>
        <Link className="button button-purple" href={`/learn/${course.id}`}>
          Back to the path <ArrowRight size={19} />
        </Link>
      </main>
    );
  if (!session) return <Loading />;
  const exercise =
    lesson.exercises[
      session.queue[Math.min(session.cursor, session.queue.length - 1)]
    ];
  const feedback = session.feedback;
  const bank = [...exercise.phrase.meaning.split(' '), 'tomorrow', 'friend'];
  const bankOrder = bank.map((_, i) => (i + 2) % bank.length);
  const answered =
    exercise.kind === 'assemble'
      ? tiles.length > 0
      : exercise.kind === 'match'
        ? Object.keys(pairs).length === exercise.options.length
        : !!selected;
  const displayProgress = session.done
    ? 100
    : Math.min(100, (session.cursor / session.queue.length) * 100);
  function restart() {
    update((s) => ({
      ...s,
      sessions: {
        ...s.sessions,
        [key]: newSession(course!.id, lesson!.id, crypto.randomUUID()),
      },
    }));
    setResume(false);
    setRestartOpen(false);
  }
  function check() {
    if (!answered || feedback) return;
    const answer =
      exercise.kind === 'assemble'
        ? tiles.map((i) => bank[i])
        : exercise.kind === 'match'
          ? pairs
          : selected;
    const correct =
      evaluate(exercise, answer) &&
      !(exercise.kind === 'match' && matchMistake);
    update((s) => ({
      ...s,
      sessions: {
        ...s.sessions,
        [key]: recordAnswer(s.sessions[key], correct),
      },
    }));
    play(correct);
  }
  function next() {
    update((s) => advanceSession(s, key, localDate()));
    setTimeout(() => heading.current?.focus(), 30);
  }
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
        className="icon-button"
        href={`/learn/${course.id}`}
        aria-label="Save and leave lesson"
      >
        <X size={23} />
      </Link>
      <Progress
        value={displayProgress}
        aria-label="Lesson progress"
        className="lesson-progress"
      />
      <span className="lesson-count">
        {session.done ? '8 / 8' : `${Math.min(session.cursor, 8)} / 8`}
      </span>
      <div className="lesson-tools">
        <button
          className="icon-button"
          aria-label={
            state.prefs.sound ? 'Turn game sounds off' : 'Turn game sounds on'
          }
          onClick={() =>
            update((s) => ({
              ...s,
              prefs: { ...s.prefs, sound: !s.prefs.sound },
            }))
          }
        >
          {state.prefs.sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
        </button>
        <MotionButton />
      </div>
    </header>
  );
  if (session.done) {
    const lessonIndex = course.lessons.findIndex((l) => l.id === lesson.id);
    const nextLesson = course.lessons[lessonIndex + 1];
    const earned = course.lessons.every(
      (l) => state.completed[lessonKey(course.id, l.id)],
    );
    return (
      <main id="main-content" className="lesson-page">
        {header}
        <section className="celebration">
          <div className="celebration-art">
            <Poli pose="celebrate" priority />
          </div>
          <span className="eyebrow purple">THAT LITTLE WIN? ALL YOURS.</span>
          <h1>
            You did a whole
            <br />
            new thing.
          </h1>
          <p>
            {lesson.title} · {course.name}
            <br />A little more language. A little more connection.
          </p>
          <div className="result-stats">
            <div className="result-stat">
              <Star />
              <strong>+{session.reward}</strong>
              <small>XP EARNED</small>
            </div>
            <div className="result-stat">
              <Check />
              <strong>{Math.round((session.firstCorrect / 8) * 100)}%</strong>
              <small>FIRST-TRY ACCURACY</small>
            </div>
            <div className="result-stat">
              <Flame />
              <strong>{streak(state.activity)}</strong>
              <small>DAY STREAK</small>
            </div>
          </div>
          {earned && (
            <div className="badge-earned">
              <Trophy size={35} />
              <div>
                <h3>{course.name} first steps</h3>
                <p>Your first course badge. You earned every bit of it.</p>
              </div>
            </div>
          )}
          <button
            className="button button-purple"
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
                            crypto.randomUUID(),
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
          <button className="restart-link" onClick={restart}>
            Play this lesson again · earn 5 XP
          </button>
        </section>
      </main>
    );
  }
  if (resume)
    return (
      <main id="main-content" className="lesson-page">
        {header}
        <section className="resume-card">
          <Poli pose="welcome" priority />
          <span className="eyebrow purple">RIGHT WHERE YOU LEFT OFF</span>
          <h1>Saved you a spot.</h1>
          <p>
            Your {course.name} lesson is ready when you are.
            <br />
            {lesson.title} · {Math.min(session.cursor, 8)} of 8 exercises
            finished{session.cursor >= 8 ? ' · review in progress' : ''}.
          </p>
          <button
            className="button button-purple"
            onClick={() => setResume(false)}
          >
            Let’s keep going <ArrowRight size={19} />
          </button>
          {restartControl}
        </section>
      </main>
    );
  if (!session.studied)
    return (
      <main id="main-content" className="lesson-page">
        {header}
        <section className="lesson-shell">
          <div className="lesson-label">
            <span>
              {course.name.toUpperCase()} · {lesson.title.toUpperCase()}
            </span>
            <span>MEET YOUR FIRST WORDS</span>
          </div>
          <div className="study-intro">
            <Poli pose="welcome" priority />
            <div>
              <h1>
                A few words
                <br />
                for the road.
              </h1>
              <p>Take your time. You’ll get to play with these next.</p>
            </div>
          </div>
          <div className="study-grid">
            {lesson.phrases.map((p) => (
              <article key={p.id} className="study-card">
                <Native phrase={p} course={course} />
                <strong>{p.meaning}</strong>
                <p>{p.note}</p>
              </article>
            ))}
          </div>
          <p className="study-note">
            You can peek at a hint whenever you need one. That’s learning, too.
          </p>
        </section>
        <div className="lesson-footer">
          <p>
            <BookOpen size={15} style={{ display: 'inline', marginRight: 6 }} />
            Script + meaning, at your pace.
          </p>
          <button
            className="button button-purple"
            onClick={() =>
              update((s) => ({
                ...s,
                sessions: {
                  ...s.sessions,
                  [key]: { ...s.sessions[key], studied: true },
                },
              }))
            }
          >
            Let’s try it <ArrowRight size={18} />
          </button>
        </div>
      </main>
    );
  return (
    <main id="main-content" className="lesson-page">
      {header}
      <section className="lesson-shell">
        <div className="lesson-label">
          <span>
            {course.name.toUpperCase()} · {lesson.title.toUpperCase()}
          </span>
          <span>
            {session.cursor >= 8
              ? 'A LITTLE SECOND TRY'
              : exercise.kind === 'match'
                ? 'CONNECT THE PAIRS'
                : exercise.kind === 'assemble'
                  ? 'BUILD A MEANING'
                  : 'ONE LITTLE CONNECTION'}
          </span>
        </div>
        <h1 ref={heading} tabIndex={-1}>
          {exercise.prompt}
        </h1>
        {exercise.kind === 'match' ? (
          <p className="lead">Tap an expression, then its English meaning.</p>
        ) : exercise.kind === 'assemble' ? (
          <p className="lead">
            Tap the words in order. Tap a placed word to take it back.
          </p>
        ) : exercise.kind === 'context' ? (
          <p className="lead">What would you say?</p>
        ) : null}
        <div className="lesson-mascot-row">
          <Poli
            pose={
              feedback
                ? feedback.correct
                  ? 'celebrate'
                  : 'encourage'
                : 'thinking'
            }
          />
          <div className="prompt-bubble">
            {exercise.kind === 'match' ? (
              <span className="english-meaning">
                Let’s connect
                <br />
                the dots.
              </span>
            ) : exercise.kind === 'context' ? (
              <span className="english-meaning">
                {feedback ? 'Every try counts.' : 'You’ve got this.'}
              </span>
            ) : exercise.kind === 'translation' ? (
              <span className="english-meaning">{exercise.phrase.meaning}</span>
            ) : (
              <Native phrase={exercise.phrase} course={course} large />
            )}
          </div>
        </div>
        {exercise.kind === 'match' ? (
          <>
            <div className="match-grid">
              <div className="match-column">
                {exercise.options.map((p) => (
                  <button
                    key={p.id}
                    className={`answer-option ${left === p.id ? 'selected' : ''} ${pairs[p.id] ? 'matched' : ''}`}
                    disabled={!!pairs[p.id] || !!feedback}
                    aria-pressed={left === p.id}
                    onClick={() => {
                      setLeft(p.id);
                      setMatchHint('Now choose the matching English meaning.');
                    }}
                  >
                    <Native phrase={p} course={course} />
                    {pairs[p.id] && <Check size={15} />}
                  </button>
                ))}
              </div>
              <div className="match-column">
                {[
                  ...exercise.options.slice(2),
                  ...exercise.options.slice(0, 2),
                ].map((p) => (
                  <button
                    key={p.id}
                    className={`answer-option ${Object.values(pairs).includes(p.id) ? 'matched' : ''}`}
                    disabled={Object.values(pairs).includes(p.id) || !!feedback}
                    onClick={() => {
                      if (!left) {
                        setMatchHint('Choose an expression on the left first.');
                        return;
                      }
                      if (left === p.id) {
                        setPairs((x) => ({ ...x, [left]: p.id }));
                        setLeft(null);
                        setMatchHint('A lovely connection. Keep going!');
                        play(true);
                      } else {
                        setMatchMistake(true);
                        setMatchHint('Not quite a pair. Try another meaning.');
                        play(false);
                      }
                    }}
                  >
                    {p.meaning}
                    {Object.values(pairs).includes(p.id) && <Check size={15} />}
                  </button>
                ))}
              </div>
            </div>
            <output className="match-hint">{matchHint}</output>
          </>
        ) : exercise.kind === 'assemble' ? (
          <>
            <div className="assembly-tray" aria-label="Your assembled answer">
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
              {bankOrder.map((i) => (
                <button
                  className="word-tile"
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
            className="answer-options"
          >
            {exercise.options.map((p, i) => (
              <label
                key={p.id}
                className={`answer-option ${selected === p.id ? 'selected' : ''} ${feedback && p.id === exercise.phrase.id ? 'answer-correct' : ''} ${feedback && selected === p.id && !feedback.correct ? 'answer-incorrect' : ''}`}
              >
                <RadioGroupItem className="sr-only" value={p.id} />
                <span className="option-index" aria-hidden="true">
                  {i + 1}
                </span>
                {exercise.kind === 'meaning' ? (
                  p.meaning
                ) : (
                  <Native phrase={p} course={course} />
                )}
              </label>
            ))}
          </RadioGroup>
        )}
        {!feedback && (
          <details className="lesson-help" key={exercise.id + session.cursor}>
            <summary>A little hint?</summary>
            <p>
              {exercise.kind === 'match'
                ? lesson.phrases
                    .map((p) => `${p.roman} = ${p.meaning}`)
                    .join(' · ')
                : `${exercise.phrase.roman} means “${exercise.phrase.meaning}”. ${exercise.phrase.note}`}
              <br />
              <a href={exercise.phrase.source} target="_blank" rel="noreferrer">
                Phrase reference ↗
              </a>
            </p>
          </details>
        )}
      </section>
      {feedback ? (
        <section
          className={`feedback ${feedback.correct ? '' : 'wrong'}`}
          aria-live="polite"
        >
          <div className="feedback-content">
            <h3>
              {feedback.correct ? <Check size={23} /> : <Heart size={23} />}{' '}
              {feedback.correct
                ? 'That’s a lovely little win.'
                : 'A little practice makes it stick.'}
            </h3>
            <p>
              {exercise.kind === 'match' ? (
                feedback.correct ? (
                  'Every pair, connected. You’re getting the hang of this.'
                ) : (
                  'You found the pairs. We’ll give this one another go so it feels familiar.'
                )
              ) : (
                <>
                  “{exercise.phrase.roman}” means{' '}
                  <strong>“{exercise.phrase.meaning}”</strong>.{' '}
                  {feedback.correct
                    ? exercise.phrase.note
                    : 'We’ll revisit this before you finish.'}
                </>
              )}
            </p>
          </div>
          <button className="button button-purple" onClick={next}>
            {session.cursor + 1 === session.queue.length
              ? 'Finish lesson'
              : 'Continue'}
            <ArrowRight size={18} />
          </button>
        </section>
      ) : (
        <div className="lesson-footer">
          <p>
            <Heart size={15} style={{ display: 'inline', marginRight: 6 }} />
            Good things take a little practice.
          </p>
          <button
            className="button button-purple"
            disabled={!answered}
            onClick={check}
          >
            Check answer <Check size={18} />
          </button>
        </div>
      )}
    </main>
  );
}
