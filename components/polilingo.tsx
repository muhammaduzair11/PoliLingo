'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  Flame,
  Star,
  Sparkles,
  Mountain,
  Heart,
  BookOpen,
  Settings2,
  Volume2,
  Pause,
  Play,
  Lock,
  Flag,
  RotateCcw,
  Trophy,
  MousePointer2,
  Globe2,
  Sun,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
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
import { useLearning } from '@/components/learning-provider';
import { courses, getCourse, type Course, type Phrase } from '@/lib/courses';
import {
  initialState,
  lessonKey,
  localDate,
  newSession,
  streak,
  unlocked,
} from '@/lib/progress';

export function Poli({
  pose = 'welcome',
  className = '',
  priority = false,
}: {
  pose?: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      className={`poli ${className}`}
      src={`/assets/poli-${pose}.webp`}
      width={800}
      height={800}
      sizes="(min-width: 768px) 260px, 40vw"
      alt={
        pose === 'welcome'
          ? 'Poli, your cream-colored markhor buddy with violet horns and an orange bag'
          : ''
      }
      priority={priority}
    />
  );
}
export function Native({
  phrase,
  course,
  large = false,
}: {
  phrase: Pick<Phrase, 'native' | 'roman'>;
  course: Course;
  large?: boolean;
}) {
  const { state } = useLearning();
  return (
    <span className={`phrase ${large ? 'phrase-large' : ''}`}>
      <span className="native" lang={course.lang} dir="rtl">
        {phrase.native}
      </span>
      {state.prefs.transliteration && (
        <span className="roman" dir="ltr">
          {phrase.roman}
        </span>
      )}
    </span>
  );
}
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="PoliLingo home">
      <span className="brand-icon">
        <Mountain size={23} strokeWidth={3} />
      </span>
      poli<span>lingo</span>
      <span className="brand-dot">®</span>
    </Link>
  );
}
export function MotionButton() {
  const { state, update } = useLearning();
  return (
    <button
      className="icon-button motion-button"
      aria-label={
        state.prefs.reducedMotion
          ? 'Enable decorative motion'
          : 'Pause decorative motion'
      }
      title={state.prefs.reducedMotion ? 'Enable motion' : 'Pause motion'}
      onClick={() =>
        update((s) => ({
          ...s,
          prefs: { ...s.prefs, reducedMotion: !s.prefs.reducedMotion },
        }))
      }
    >
      {state.prefs.reducedMotion ? <Play size={17} /> : <Pause size={17} />}
    </button>
  );
}
export function Header({ home = false }: { home?: boolean }) {
  const { state } = useLearning();
  return (
    <header className={`site-header ${home ? 'home-header' : ''}`}>
      <div className="header-inner">
        <Brand />
        <nav aria-label="Main navigation">
          {home ? (
            <>
              <a href="#languages">The languages</a>
              <a href="#how-it-works">The adventure</a>
              <a href="#meet-poli">
                Meet Poli <Heart size={13} />
              </a>
            </>
          ) : (
            <Link href={state.selected ? `/learn/${state.selected}` : '/'}>
              My adventure
            </Link>
          )}
        </nav>
        <div className="header-actions">
          <MotionButton />
          {!home && (
            <Link
              href="/settings"
              className="icon-button"
              aria-label="Settings"
            >
              <Settings2 size={20} />
            </Link>
          )}
          <Link
            className="button button-small button-ink"
            href={
              state.selected
                ? `/learn/${state.selected}`
                : home
                  ? '#languages'
                  : '/'
            }
          >
            {state.selected ? 'Keep going' : 'Let’s go'}
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </div>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <Brand />
      <p>Many languages. A little more together.</p>
      <div>
        <span>Made for connection.</span>
        <Link href="/settings">
          Settings & sources <ArrowUpRight size={14} />
        </Link>
      </div>
    </footer>
  );
}
export function Home() {
  const { state } = useLearning();
  const [sample, setSample] = useState<string | null>(null);
  const { play } = useLearning();
  return (
    <>
      <Header home />
      <main id="main-content">
        <section className="hero">
          <div className="hero-inner">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="live-dot" /> ROOTED HERE. READY FOR EVERYWHERE.
              </div>
              <h1>
                A little daily.
                <br />A lot more
                <br />
                <span className="connection">
                  connection.
                  <svg viewBox="0 0 520 22" aria-hidden="true">
                    <path d="M4 16 Q230 -4 513 10" />
                  </svg>
                </span>
              </h1>
              <p>
                Your people. Your roots. Your next adventure.
                <br />
                Learn Pakistan’s languages, one small win at a time.
              </p>
              <a href="#languages" className="button button-yellow">
                Find your first words <ArrowUpRight size={22} />
              </a>
              <div className="hero-footnote">
                <span>
                  <Check size={15} /> Start free
                </span>
                <span>
                  <Check size={15} /> Learn a little. Feel a lot.
                </span>
              </div>
              <nav
                className="hero-languages"
                aria-label="Start learning a language"
              >
                {courses.map((c) => (
                  <Link key={c.id} href={`/onboarding/${c.id}`}>
                    {c.name}
                    <ArrowUpRight size={14} />
                  </Link>
                ))}
              </nav>
              {state.selected && (
                <Link className="return-link" href={`/learn/${state.selected}`}>
                  Welcome back! Continue {getCourse(state.selected)?.name}{' '}
                  <ArrowRight size={16} />
                </Link>
              )}
            </div>
            <div
              className="hero-art"
              onPointerMove={(e) => {
                if (e.pointerType === 'mouse' && !state.prefs.reducedMotion) {
                  const r = e.currentTarget.getBoundingClientRect();
                  e.currentTarget.style.setProperty(
                    '--tilt',
                    `${(e.clientX - r.left - r.width / 2) / 80}deg`,
                  );
                }
              }}
              onPointerLeave={(e) =>
                e.currentTarget.style.setProperty('--tilt', '0deg')
              }
            >
              <div className="hero-orbit orbit-one" />
              <div className="hero-orbit orbit-two" />
              <div className="hero-halo" />
              <span className="deco-star star-one" aria-hidden="true">
                ✦
              </span>
              <span className="deco-star star-two" aria-hidden="true">
                ✳
              </span>
              <span className="hello-sticker native" lang="ur" dir="rtl">
                سلام!
              </span>
              <span className="poli-sticker">
                BIG HORNS.
                <br />
                BIGGER HYPE.
                <Sparkles size={17} />
              </span>
              <Poli priority className="hero-poli" />
              <div className="poli-caption">
                <span className="caption-line" /> your new adventure buddy
              </div>
              <span className="little-flower" aria-hidden="true">
                ✿
              </span>
            </div>
          </div>
          <div className="hero-bottom">
            <span>LESS SCROLLING. MORE CONNECTING.</span>
            <span>
              SCROLL TO FIND YOUR LANGUAGE <ArrowLeft size={15} />
            </span>
          </div>
        </section>
        <section id="languages" className="languages-section section-wrap">
          <div className="section-heading">
            <div>
              <div className="eyebrow purple">
                THREE LANGUAGES. SO MANY POSSIBILITIES.
              </div>
              <h2>
                Where will your
                <br className="mobile-break" /> words take you?
              </h2>
            </div>
            <p>
              Pick a language. We’ll bring the adventure.
              <br />
              No experience needed. Just a little curiosity.
            </p>
          </div>
          <div className="language-grid">
            {courses.map((course, i) => (
              <Link
                key={course.id}
                href={`/onboarding/${course.id}`}
                className={`language-card language-${course.id}`}
                style={{ '--course-color': course.color } as CSSProperties}
              >
                <div className="language-card-top">
                  <span className="course-number">0{i + 1} / EXPLORE</span>
                  <span className="native" lang={course.lang} dir="rtl">
                    {course.native}
                  </span>
                </div>
                <div className="world-frame">
                  <Image
                    src={course.image}
                    alt={`${course.name} miniature adventure world`}
                    width={900}
                    height={900}
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  />
                  <span className="world-spark" aria-hidden="true">
                    ✦
                  </span>
                </div>
                <div className="language-card-bottom">
                  <div>
                    <h3>{course.name}</h3>
                    <p>{course.tagline}</p>
                  </div>
                  <span className="round-arrow">
                    <ArrowUpRight size={24} />
                  </span>
                </div>
                <div className="language-card-meta">
                  <span>BEGINNER FRIENDLY</span>
                  <span>3 LITTLE LESSONS</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
        <div className="marquee" aria-hidden="true">
          <div>
            {[0, 1, 2, 3].map((i) => (
              <span key={i}>
                FIND YOUR WORDS <span>✳</span> FIND YOUR PEOPLE <span>✳</span> A
                LITTLE MORE YOU <span>✳</span>
              </span>
            ))}
          </div>
        </div>
        <section id="how-it-works" className="section-wrap how-section">
          <div className="how-intro">
            <div className="eyebrow purple">SMALL STEPS. REAL CONNECTIONS.</div>
            <h2>
              A little learning.
              <br />A whole lot of
              <br />
              <span className="purple">“I did that.”</span>
            </h2>
            <p>
              From your first hello to your next conversation.
              <br />
              This is learning you’ll actually look forward to.
            </p>
            <a href="#try-it" className="text-link">
              Get a little taste <ArrowRight size={20} />
            </a>
          </div>
          <div className="steps">
            <article>
              <span className="step-icon yellow">
                <Globe2 />
              </span>
              <div>
                <span className="step-label">01 · PICK YOUR PATH</span>
                <h3>Follow your curiosity.</h3>
                <p>
                  Connect with your roots or discover a whole new language.
                  There’s a path with your name on it.
                </p>
              </div>
            </article>
            <article>
              <span className="step-icon pink">
                <MousePointer2 />
              </span>
              <div>
                <span className="step-label">02 · PLAY A LITTLE</span>
                <h3>Small lessons. Big little wins.</h3>
                <p>
                  Match words, build meanings, and try everyday conversations.
                  Mistakes are part of the adventure.
                </p>
              </div>
            </article>
            <article>
              <span className="step-icon mint">
                <Sparkles />
              </span>
              <div>
                <span className="step-label">03 · KEEP YOUR SPARK</span>
                <h3>Come back for your next win.</h3>
                <p>
                  Collect XP, grow your streak, and earn your first badge. Poli
                  will be right there cheering you on.
                </p>
              </div>
            </article>
          </div>
        </section>
        <section id="try-it" className="sample-section section-wrap">
          <div className="sample-copy">
            <span className="pill">
              <Sparkles size={15} /> YOUR FIRST WIN STARTS HERE
            </span>
            <h2>
              You already have
              <br />
              it in you.
            </h2>
            <p>
              One word can open a whole conversation.
              <br />
              Try this little bit of Urdu.
            </p>
            <span className="handwritten">Go on. Take a guess. ↗</span>
          </div>
          <div className="sample-card">
            <div className="sample-top">
              <span>URDU · A LITTLE HELLO</span>
              <span>
                <Star size={15} /> FIRST WORD
              </span>
            </div>
            <h3>How do you say “Thank you”?</h3>
            <div className="sample-options">
              {[
                { n: 'سلام', r: 'Salaam', id: 'hello' },
                { n: 'شکریہ', r: 'Shukriya', id: 'thanks' },
                { n: 'خدا حافظ', r: 'Khuda hafiz', id: 'bye' },
              ].map((p) => (
                <button
                  key={p.id}
                  className={`sample-option ${sample === p.id ? (p.id === 'thanks' ? 'correct' : 'incorrect') : ''}`}
                  onClick={() => {
                    setSample(p.id);
                    play(p.id === 'thanks');
                  }}
                  aria-pressed={sample === p.id}
                >
                  <span className="native" lang="ur" dir="rtl">
                    {p.n}
                  </span>
                  <span>{p.r}</span>
                  {sample === p.id &&
                    (p.id === 'thanks' ? (
                      <Check size={17} />
                    ) : (
                      <RotateCcw size={17} />
                    ))}
                </button>
              ))}
            </div>
            <output className="sample-response">
              {sample === null ? (
                <>
                  <Heart size={17} /> No pressure. That’s how we learn.
                </>
              ) : sample === 'thanks' ? (
                <>
                  <Check size={18} /> Shukriya! Look at you, making connections.
                </>
              ) : (
                <>
                  <Heart size={17} /> A good try! Shukriya means “Thank you”.
                  Try it.
                </>
              )}
            </output>
            {sample === 'thanks' && (
              <Link href="/onboarding/urdu" className="button button-purple">
                Keep that feeling going <ArrowRight size={18} />
              </Link>
            )}
          </div>
        </section>
        <section id="meet-poli" className="meet-section">
          <div className="section-wrap meet-inner">
            <div className="meet-art">
              <div className="meet-circle" />
              <Poli pose="celebrate" />
              <span className="speech-bubble">
                Your wins?
                <br />
                My whole personality.
              </span>
              <span className="deco-star" aria-hidden="true">
                ✦
              </span>
            </div>
            <div className="meet-copy">
              <div className="eyebrow">
                SMALL BUDDY. MASSIVE BELIEVER IN YOU.
              </div>
              <h2>
                Meet Poli.
                <br />
                Your personal
                <br />
                <span>hype markhor.</span>
              </h2>
              <p>
                Part mountain explorer. Part biggest fan. Poli’s here for your
                first words, your happy mistakes, and every “wait, I actually
                know this!” moment.
              </p>
              <a href="#languages" className="button button-yellow">
                Let’s make some memories <ArrowUpRight size={20} />
              </a>
            </div>
          </div>
        </section>
        <section className="closing section-wrap">
          <span className="eyebrow purple">
            COME AS YOU ARE. LEAVE WITH A LITTLE MORE.
          </span>
          <h2>
            There’s a whole world
            <br />
            in a little <span>hello.</span>
          </h2>
          <a href="#languages" className="button button-purple">
            Find your language <ArrowUpRight size={21} />
          </a>
          <p>Free to start. Yours to explore.</p>
        </section>
      </main>
      <Footer />
    </>
  );
}

export function Loading() {
  return (
    <main id="main-content" className="loading-page" aria-busy="true">
      <div className="loading-mark">
        <Mountain size={42} />
      </div>
      <p>Getting your adventure ready…</p>
    </main>
  );
}
export function NotFoundView() {
  return (
    <>
      <Header />
      <main id="main-content" className="empty-page">
        <Poli pose="thinking" />
        <h1>A little off the trail.</h1>
        <p>This lesson or language could not be found.</p>
        <Link href="/" className="button button-purple">
          Find your way back <ArrowRight size={18} />
        </Link>
      </main>
    </>
  );
}
export function Onboarding({ courseId }: { courseId: string }) {
  const { state, ready, update } = useLearning();
  const router = useRouter();
  const course = getCourse(courseId);
  const [step, setStep] = useState(1);
  const [goalOverride, setGoal] = useState<number | null>(null);
  const goal = goalOverride ?? state.dailyGoal;
  if (!course) return <NotFoundView />;
  if (!ready) return <Loading />;
  return (
    <>
      <Header />
      <main id="main-content" className="onboarding-page">
        <div className="onboard-art" style={{ background: course.color }}>
          <span className="eyebrow">YOUR NEXT CHAPTER</span>
          <h2>
            {course.name}
            <span className="native" lang={course.lang} dir="rtl">
              {course.native}
            </span>
          </h2>
          <Image
            className="onboard-world"
            src={course.image}
            width={900}
            height={900}
            sizes="(min-width: 1024px) 50vw, 100vw"
            alt={`${course.name} adventure world`}
            priority
          />
          <div className="onboard-note">
            <Heart size={20} /> A little closer to your people.
          </div>
        </div>
        <div className="onboard-content">
          <div className="onboard-top">
            <button
              className="icon-button"
              aria-label="Go back"
              onClick={() =>
                step === 2 ? setStep(1) : router.push('/#languages')
              }
            >
              <ArrowLeft size={22} />
            </button>
            <span>YOUR ADVENTURE · {step} OF 2</span>
          </div>
          <Progress
            value={step * 50}
            aria-label="Onboarding progress"
            className="lesson-progress"
          />
          {step === 1 ? (
            <>
              <span className="eyebrow purple">
                LET’S START WITH A LITTLE HELLO
              </span>
              <h1>
                {course.name}?<br />
                Lovely choice.
              </h1>
              <p className="lead">
                {course.tagline} Your first words are closer than you think.
              </p>
              <div className="course-facts">
                <p>
                  <BookOpen />
                  <span>
                    <strong>Three little lessons</strong>Greetings,
                    introductions, and everyday essentials.
                  </span>
                </p>
                <p>
                  <Globe2 />
                  <span>
                    <strong>{course.variety}</strong>
                    {course.id === 'hindko'
                      ? 'Introductory sample. Local phrasing varies; speaker review is still pending.'
                      : 'A consistent starting point, with room to explore more later.'}
                  </span>
                </p>
                <p>
                  <Sparkles />
                  <span>
                    <strong>Your words, two ways</strong>Native script plus
                    Roman letters. English guidance all the way.
                  </span>
                </p>
              </div>
              <button
                className="button button-purple full-width"
                onClick={() => setStep(2)}
              >
                That’s my language <ArrowRight size={20} />
              </button>
              <Link href="/#languages" className="quiet-link">
                Explore another language
              </Link>
            </>
          ) : (
            <>
              <span className="eyebrow purple">
                A LITTLE SPACE FOR YOURSELF
              </span>
              <h1>
                Find your
                <br />
                daily rhythm.
              </h1>
              <p className="lead">
                Small and steady goes a long way. You can change this any time.
              </p>
              <RadioGroup
                value={String(goal)}
                onValueChange={(v) => setGoal(Number(v))}
                aria-label="Daily lesson goal"
                className="goal-options"
              >
                {[1, 2, 3].map((n) => (
                  <label
                    className={`goal-option ${goal === n ? 'chosen' : ''}`}
                    key={n}
                  >
                    <RadioGroupItem value={String(n)} />
                    <span>
                      <strong>
                        {n === 1
                          ? 'A little spark'
                          : n === 2
                            ? 'A lovely rhythm'
                            : 'Adventure mode'}
                      </strong>
                      <small>
                        {n} lesson{n > 1 ? 's' : ''} a day
                      </small>
                    </span>
                    {n === 1 ? <Sun /> : n === 2 ? <Flame /> : <Sparkles />}
                  </label>
                ))}
              </RadioGroup>
              <div className="kind-note">
                <Heart size={19} /> No pressure. A little is always enough.
              </div>
              <button
                className="button button-purple full-width"
                onClick={() => {
                  update((s) => ({
                    ...s,
                    selected: course.id,
                    dailyGoal: goal,
                  }));
                  router.push(`/learn/${course.id}`);
                }}
              >
                Let the adventure begin <ArrowRight size={20} />
              </button>
              <p className="saved-note">
                Your progress stays on this device. No sign-up needed.
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}

export function Dashboard({ courseId }: { courseId?: string }) {
  const { state, ready, update } = useLearning();
  const router = useRouter();
  const course = getCourse(courseId || state.selected || 'pashto');
  useEffect(() => {
    if (ready && course && state.selected !== course.id)
      update((s) => ({ ...s, selected: course.id }));
  }, [ready, course, state.selected, update]);
  if (!ready) return <Loading />;
  if (!course) return <NotFoundView />;
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
          [key]: newSession(course!.id, lesson, crypto.randomUUID()),
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
              <Image
                src={course.image}
                alt=""
                width={900}
                height={900}
                sizes="200px"
                loading="eager"
              />
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

function SettingRow({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <span className="setting-icon">{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
export function Settings() {
  const { state, ready, update } = useLearning();
  const [resetOpen, setResetOpen] = useState(false);
  const [notice, setNotice] = useState('');
  if (!ready) return <Loading />;
  return (
    <>
      <Header />
      <main id="main-content" className="settings-page section-wrap">
        <Link
          className="text-link"
          href={state.selected ? `/learn/${state.selected}` : '/'}
        >
          <ArrowLeft size={17} /> Back to your adventure
        </Link>
        <div className="eyebrow purple">YOUR LEARNING, YOUR WAY</div>
        <h1>Make yourself at home.</h1>
        <p className="lead">
          A few little things to make this feel more like you.
        </p>
        <section className="settings-card">
          <SettingRow
            icon={<Volume2 />}
            title="A little sound"
            description="Play gentle sounds for answers. No pronunciation audio in this sample."
          >
            <Switch
              checked={state.prefs.sound}
              onCheckedChange={(v) =>
                update((s) => ({ ...s, prefs: { ...s.prefs, sound: v } }))
              }
              aria-label="Game sounds"
            />
          </SettingRow>
          <SettingRow
            icon={<Pause />}
            title="A calmer adventure"
            description="Pause floating decorations and reduce movement. Your device’s motion preference is also respected."
          >
            <Switch
              checked={state.prefs.reducedMotion}
              onCheckedChange={(v) =>
                update((s) => ({
                  ...s,
                  prefs: { ...s.prefs, reducedMotion: v },
                }))
              }
              aria-label="Reduce motion"
            />
          </SettingRow>
          <SettingRow
            icon={<BookOpen />}
            title="A little help with the script"
            description="Show Roman transliteration alongside native-script words."
          >
            <Switch
              checked={state.prefs.transliteration}
              onCheckedChange={(v) =>
                update((s) => ({
                  ...s,
                  prefs: { ...s.prefs, transliteration: v },
                }))
              }
              aria-label="Show transliteration"
            />
          </SettingRow>
          <div className="daily-setting">
            <h3>Your daily rhythm</h3>
            <p>Pick a goal that fits your day.</p>
            <RadioGroup
              className="inline-goals"
              value={String(state.dailyGoal)}
              onValueChange={(v) =>
                update((s) => ({ ...s, dailyGoal: Number(v) }))
              }
              aria-label="Daily goal"
            >
              {[1, 2, 3].map((n) => (
                <label key={n}>
                  <RadioGroupItem value={String(n)} />
                  {n} lesson{n > 1 ? 's' : ''}
                </label>
              ))}
            </RadioGroup>
          </div>
        </section>
        <section className="settings-card sources-card">
          <h2>A note about your first words</h2>
          <p>
            These are introductory sample lessons, researched from phrase
            references and community language resources. They have not yet been
            reviewed by native-speaking teachers. Roman spellings are helpful
            approximations, not pronunciation recordings.
          </p>
          <p>
            Pashto uses a Northern/Peshawar starting point. Hindko targets
            Hazara/Abbottabad; available references are not always
            dialect-specific, so local wording needs further speaker review.
            Urdu uses everyday Pakistani expressions.
          </p>
          <div className="source-links">
            <a
              href="https://tplsites.s3.amazonaws.com/resources/PUSas-ENGus/grammar/ADDITIONAL_INFORMATION.htm"
              target="_blank"
              rel="noreferrer"
            >
              Pashto phrase reference <ArrowUpRight size={15} />
            </a>
            <a
              href="https://www.omniglot.com/language/phrases/urdu.php"
              target="_blank"
              rel="noreferrer"
            >
              Urdu phrase reference <ArrowUpRight size={15} />
            </a>
            <a
              href="https://www.hindko.org/hno/contact"
              target="_blank"
              rel="noreferrer"
            >
              Hindko Language & Culture Society <ArrowUpRight size={15} />
            </a>
            <a
              href="https://worldschoolbooks.com/hindko-for-beginners/"
              target="_blank"
              rel="noreferrer"
            >
              Hindko beginner reference <ArrowUpRight size={15} />
            </a>
          </div>
        </section>
        <section className="reset-card">
          <div>
            <h3>A fresh start</h3>
            <p>
              Progress is saved only in this browser. Resetting removes lessons,
              XP, badges, and preferences from this device.
            </p>
          </div>
          <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
            <AlertDialogTrigger className="button button-outline">
              Reset progress
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Start your adventure again?</AlertDialogTitle>
                <AlertDialogDescription>
                  This clears all lessons, XP, streaks, badges, and preferences
                  saved in this browser. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep my progress</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    update(() => initialState());
                    setResetOpen(false);
                    setNotice(
                      'A fresh start. Your progress and preferences have been reset.',
                    );
                  }}
                >
                  Reset everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
        <output>{notice}</output>
      </main>
      <Footer />
    </>
  );
}
