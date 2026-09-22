'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  Flame,
  Sparkles,
  Heart,
  BookOpen,
  Globe2,
  Sun,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useLearning } from '@/components/learning-provider';
import { getCourse } from '@/lib/courses';
import { Art } from './art';
import { Header } from './site-chrome';
import { Loading, NotFoundView } from './status-views';
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
          <Art
            className="onboard-world"
            name={course.image}
            sizes="(min-width: 1024px) 60vw, 100vw"
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
