'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import {
  ArrowUpRight,
  Check,
  Flame,
  Star,
  Heart,
  Lock,
  Flag,
  Trophy,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useLearning } from './learning-provider';
import { courses, getCourse, selectedCourse } from '@/lib/courses';
import {
  lessonKey,
  localDate,
  newSession,
  streak,
  unlocked,
} from '@/lib/progress';
import { randomId } from '@/lib/random-id';
import { Art, Poli } from './art';
import { Header, Footer } from './site-chrome';
import { Loading, NotFoundView } from './status-views';
export function Dashboard({ courseId }: { courseId?: string }) {
  const { state, ready, update } = useLearning();
  const router = useRouter();
  // /learn opens the remembered course. With none the learner can see -
  // nothing chosen yet, or a hidden one such as Hindko - it shows the
  // language picker instead of choosing a language for them, and the
  // stored choice is left as it is.
  const course = courseId
    ? getCourse(courseId)
    : selectedCourse(state.selected);
  useEffect(() => {
    if (ready && course && state.selected !== course.id)
      update((s) => ({ ...s, selected: course.id }));
  }, [ready, course, state.selected, update]);
  useEffect(() => {
    if (ready && !courseId && !course) router.replace('/#languages');
  }, [ready, courseId, course, router]);
  if (!ready) return <Loading />;
  if (!course) return courseId ? <NotFoundView /> : <Loading />;
  const completed = course.lessons.filter(
    (l) => state.completed[lessonKey(course.id, l.id)],
  ).length;
  const next =
    course.lessons.find((l) => !state.completed[lessonKey(course.id, l.id)]) ??
    course.lessons[0];
  const today = state.activity[localDate()] || 0;
  function start(lesson: string) {
    const key = lessonKey(course!.id, lesson);
    if (!state.sessions[key] || state.sessions[key].done)
      update((s) => ({
        ...s,
        sessions: {
          ...s.sessions,
          [key]: newSession(course!.id, lesson, randomId()),
        },
      }));
    router.push(`/lesson/${course!.id}/${lesson}`);
  }
  return (
    <>
      <Header />
      <main id="main-content" className="dashboard section-wrap">
        <div className="dashboard-heading">
          <div>
            <span className="eyebrow purple">A LITTLE MORE YOU, EVERY DAY</span>
            <h1>
              {completed === 3
                ? 'Look how far you’ve come.'
                : 'Your next little adventure.'}
            </h1>
            <p>
              {completed === 3
                ? 'Three lessons. A whole new beginning. Keep your words fresh with a replay.'
                : 'Take a breath. Make a little room for something good.'}
            </p>
          </div>
          <div className="stats-pills">
            <span>
              <Flame /> {streak(state.activity)} <small>day streak</small>
            </span>
            <span>
              <Star /> {state.xp} <small>XP earned</small>
            </span>
          </div>
        </div>
        <div className="dashboard-grid">
          <section className="learning-map">
            <div className="course-tabs" aria-label="Choose a language">
              {courses.map((c) => (
                <Link
                  key={c.id}
                  href={`/learn/${c.id}`}
                  aria-current={c.id === course.id ? 'page' : undefined}
                  className={c.id === course.id ? 'active' : ''}
                >
                  <span className="native" lang={c.lang} dir="rtl">
                    {c.native}
                  </span>
                  {c.name}
                </Link>
              ))}
            </div>
            <div className="map-banner" style={{ background: course.color }}>
              <div>
                <span className="eyebrow">
                  CHAPTER 01 · YOUR FIRST CONNECTIONS
                </span>
                <h2>{course.name}, here you come.</h2>
                <p>{course.variety} · Introductory sample</p>
              </div>
              <Art name={course.image} alt="" sizes="200px" priority />
            </div>
            <div className="path-area">
              <svg
                className="path-line"
                viewBox="0 0 400 530"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d="M190 25 C390 120 35 160 145 265 S350 360 210 490" />
              </svg>
              <div className="map-poli">
                <Poli pose={completed === 3 ? 'celebrate' : 'welcome'} />
                <span>
                  {completed === 3 ? 'You did that!' : 'I saved you a spot.'}
                </span>
              </div>
              {course.lessons.map((l, i) => {
                const done = state.completed[lessonKey(course.id, l.id)];
                const open = unlocked(state, course.id, l.id);
                const active = next.id === l.id && completed !== 3;
                return (
                  <div
                    className={`lesson-stop stop-${i} ${active ? 'next-stop' : ''}`}
                    key={l.id}
                  >
                    <button
                      className={`path-node ${done ? 'completed' : open ? 'available' : 'locked'}`}
                      disabled={!open}
                      onClick={() => start(l.id)}
                      aria-label={`${l.title}${done ? ', completed' : open ? ', start lesson' : ', locked'}`}
                    >
                      {done ? (
                        <Check size={31} />
                      ) : !open ? (
                        <Lock size={27} />
                      ) : i === 0 ? (
                        <Star size={31} fill="currentColor" />
                      ) : i === 1 ? (
                        <Heart size={30} />
                      ) : (
                        <Flag size={30} />
                      )}
                    </button>
                    <div className="stop-label">
                      {active && (
                        <span className="start-here">YOUR NEXT WIN</span>
                      )}
                      <h3>{l.title}</h3>
                      <p>
                        {!open
                          ? 'Complete the previous lesson'
                          : done
                            ? 'Completed · replay anytime'
                            : '8 playful exercises'}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div className={`path-trophy ${completed === 3 ? 'earned' : ''}`}>
                <Trophy size={35} />
                <span>
                  {completed === 3
                    ? `${course.name} first steps badge earned!`
                    : 'Your first badge is waiting.'}
                </span>
              </div>
            </div>
            <div className="map-footer">
              <Progress
                value={(completed / 3) * 100}
                aria-label="Course completion"
              />
              <span>{completed} of 3 lessons completed</span>
            </div>
          </section>
          <aside className="dashboard-aside">
            <section className="daily-card">
              <div className="card-title">
                <h3>Your daily spark</h3>
                <Flame />
              </div>
              <p>
                {today >= state.dailyGoal
                  ? 'Daily goal? Done. Look at you go.'
                  : 'A little effort. A lovely habit.'}
              </p>
              <div className="goal-dots">
                {Array.from({ length: state.dailyGoal }, (_, i) => (
                  <span key={i} className={today > i ? 'filled' : ''}>
                    {today > i ? <Check /> : <Star />}
                  </span>
                ))}
              </div>
              <strong>
                {Math.min(today, state.dailyGoal)} / {state.dailyGoal} lessons
                today
              </strong>
              <Link href="/settings">
                Make it your rhythm <ArrowUpRight size={15} />
              </Link>
            </section>
            <section className="poli-tip">
              <Poli pose="rest" />
              <h3>Progress has your pace.</h3>
              <p>
                Five minutes or one new word. Showing up is a win in my book.
              </p>
              <span>— Poli, your biggest fan</span>
            </section>
            <section className="badge-card">
              <div className="card-title">
                <h3>Little treasures</h3>
                <Trophy size={21} />
              </div>
              <div className="badge-row">
                {courses.map((c) => {
                  const earned = c.lessons.every(
                    (l) => state.completed[lessonKey(c.id, l.id)],
                  );
                  return (
                    <div
                      key={c.id}
                      className={earned ? 'earned' : ''}
                      aria-label={`${c.name} badge ${earned ? 'earned' : 'not yet earned'}`}
                    >
                      <span
                        style={{ background: earned ? c.color : undefined }}
                      >
                        {earned ? <Trophy /> : <Lock size={19} />}
                      </span>
                      <small>{c.name}</small>
                    </div>
                  );
                })}
              </div>
              <p>Finish a course to collect its first steps badge.</p>
            </section>
          </aside>
        </div>
      </main>
      <Footer />
    </>
  );
}
