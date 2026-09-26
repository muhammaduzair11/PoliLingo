'use client';
import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  Star,
  Sparkles,
  Heart,
  RotateCcw,
  MousePointer2,
  Globe2,
} from 'lucide-react';
import { useLearning } from './learning-provider';
import { courses, selectedCourse } from '@/lib/content';
import { landingTeaser, exclaimed } from '@/lib/teaser';
import { countWord, plural } from '@/lib/words';
import { Art, Poli } from './art';
import { Header, Footer } from './site-chrome';
export function Home() {
  const { state } = useLearning();
  // Only a course the learner can see: a stored Hindko choice from the MVP
  // shows no "Welcome back" link, and the language cards below are the way in.
  const remembered = selectedCourse(state.selected);
  // The "try it" card asks a question from the release, so it never names a
  // language the release does not hold. With none to ask, it is left out.
  const teaser = landingTeaser(courses);
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
              {remembered && (
                <Link className="return-link" href={`/learn/${remembered.id}`}>
                  Welcome back! Continue {remembered.name}{' '}
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
                {countWord(courses.length).toUpperCase()}{' '}
                {plural(courses.length, 'LANGUAGE')}. SO MANY POSSIBILITIES.
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
          <div
            className="language-grid"
            style={{ '--cards': courses.length } as CSSProperties}
          >
            {courses.map((course, i) => (
              <Link
                key={course.id}
                href={`/onboarding/${course.id}`}
                className={`language-card language-${course.id}`}
                style={{ '--course-color': course.color } as CSSProperties}
              >
                <div className="language-card-top">
                  <span className="course-number">
                    {String(i + 1).padStart(2, '0')} / EXPLORE
                  </span>
                  <span className="native" lang={course.lang} dir={course.dir}>
                    {course.native}
                  </span>
                </div>
                <div className="world-frame">
                  <Art
                    name={course.image}
                    alt={`${course.name} miniature adventure world`}
                    sizes="(min-width: 1024px) 36vw, (min-width: 640px) 55vw, 100vw"
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
                  <span>
                    {course.lessons.length} LITTLE{' '}
                    {plural(course.lessons.length, 'LESSON')}
                  </span>
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
            {teaser && (
              <a href="#try-it" className="text-link">
                Get a little taste <ArrowRight size={20} />
              </a>
            )}
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
        {teaser && (
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
                Try this little bit of {teaser.course.name}.
              </p>
              <span className="handwritten">Go on. Take a guess. ↗</span>
            </div>
            <div className="sample-card">
              <div className="sample-top">
                <span>
                  {teaser.course.name.toUpperCase()} ·{' '}
                  {teaser.lesson.title.toUpperCase()}
                </span>
                <span>
                  <Star size={15} /> FIRST WORD
                </span>
              </div>
              <h3>{teaser.prompt}</h3>
              <div className="sample-options">
                {teaser.options.map((p) => {
                  const right = p.id === teaser.answer.id;
                  return (
                    <button
                      key={p.id}
                      className={`sample-option ${sample === p.id ? (right ? 'correct' : 'incorrect') : ''}`}
                      onClick={() => {
                        setSample(p.id);
                        play(right);
                      }}
                      aria-pressed={sample === p.id}
                    >
                      <span
                        className="native"
                        lang={teaser.course.lang}
                        dir={teaser.course.dir}
                      >
                        {p.native}
                      </span>
                      <span>{p.roman}</span>
                      {sample === p.id &&
                        (right ? <Check size={17} /> : <RotateCcw size={17} />)}
                    </button>
                  );
                })}
              </div>
              <output className="sample-response">
                {sample === null ? (
                  <>
                    <Heart size={17} /> No pressure. That’s how we learn.
                  </>
                ) : sample === teaser.answer.id ? (
                  <>
                    <Check size={18} /> {exclaimed(teaser.answer.roman)} Look at
                    you, making connections.
                  </>
                ) : (
                  <>
                    <Heart size={17} /> A good try! {teaser.answer.roman} means
                    “{teaser.answer.meaning}”. Try it.
                  </>
                )}
              </output>
              {sample === teaser.answer.id && (
                <Link
                  href={`/onboarding/${teaser.course.id}`}
                  className="button button-purple"
                >
                  Keep that feeling going <ArrowRight size={18} />
                </Link>
              )}
            </div>
          </section>
        )}
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
