'use client';
import Link from 'next/link';
import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  ArrowUpRight,
  ArrowLeft,
  BookOpen,
  Volume2,
  Pause,
  Download,
  Upload,
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
import { useLearning } from './learning-provider';
import { selectedCourse } from '@/lib/courses';
import {
  exportProgress,
  importProgress,
  localDate,
  resetProgress,
} from '@/lib/progress';
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
  const fileInput = useRef<HTMLInputElement>(null);
  function exportNow() {
    const text = exportProgress(state, new Date().toISOString());
    const url = URL.createObjectURL(
      new Blob([text], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `polilingo-progress-${localDate()}.json`;
    // Some browsers ignore a click on a link that is not on the page, and iOS
    // Safari reads the file after click() returns, so revoking the URL at once
    // can cancel the download. The link is attached for the click, and the URL
    // is released a minute later.
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    // The page cannot tell whether the file was saved, so it does not say so.
    setNotice('Your progress file is downloading. Keep it somewhere safe.');
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    if (!importProgress(state, text).ok) {
      setNotice('That file is not a PoliLingo progress export.');
      return;
    }
    update((s) => {
      const result = importProgress(s, text);
      return result.ok ? result.state : s;
    });
    setNotice('Welcome back. Your progress has been merged in.');
  }
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
            <h3>Your progress, in your hands</h3>
            <p>
              Save a copy of your progress as a small file, or bring one back.
              When you bring one back, lessons and streak days from both are
              combined; your XP shows the higher of the two totals.
            </p>
          </div>
          <button
            type="button"
            className="button button-outline"
            onClick={exportNow}
          >
            <Download size={16} /> Export progress
          </button>
          <button
            type="button"
            className="button button-outline"
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={16} /> Import progress
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={importFile}
          />
        </section>
        <section className="reset-card">
          <div>
            <h3>A fresh start</h3>
            <p>
              Progress is saved only in this browser. Resetting clears your
              lessons, XP, badges, and preferences so you can start again.
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
                  This clears all your lessons, XP, streaks, badges, and
                  preferences. There is no undo, so export your progress first
                  if you might want it back.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep my progress</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    update(resetProgress);
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
