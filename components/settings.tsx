'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  ArrowLeft,
  BookOpen,
  Volume2,
  Pause,
} from 'lucide-react';
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
import { selectedCourse } from '@/lib/courses';
import { initialState } from '@/lib/progress';
import { Header, Footer } from './site-chrome';
import { Loading } from './status-views';
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
  const remembered = selectedCourse(state.selected);
  const [resetOpen, setResetOpen] = useState(false);
  const [notice, setNotice] = useState('');
  if (!ready) return <Loading />;
  return (
    <>
      <Header />
      <main id="main-content" className="settings-page section-wrap">
        <Link
          className="text-link"
          href={remembered ? `/learn/${remembered.id}` : '/'}
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
            Pashto uses a Northern/Peshawar starting point. Urdu uses everyday
            Pakistani expressions.
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
