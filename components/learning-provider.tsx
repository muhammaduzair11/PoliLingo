'use client';
/* oxlint-disable react/react-compiler -- Mount effects hydrate browser-only persistence after SSR, activate a cached content release and report storage availability. No React Compiler is configured. */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  hydrateProgress,
  initialState,
  latestStored,
  localDate,
  STORAGE_KEY,
  type ProgressState,
} from '@/lib/progress';
import { randomId } from '@/lib/random-id';
import { contentVersion } from '@/lib/content';
import { activateCachedRelease, fitSessions } from '@/lib/release-cache';
import { ReleaseRefresher } from './release-refresher';
type Context = {
  state: ProgressState;
  ready: boolean;
  storageError: boolean;
  update: (fn: (s: ProgressState) => ProgressState) => void;
  play: (correct: boolean) => void;
  /** The content release the screens are showing: the baseline, or a newer one. */
  contentRelease: string;
  /**
   * Called when a newer release has been activated (components/release-refresher.tsx):
   * re-renders every consumer and drops unfinished runs the new release no
   * longer fits.
   */
  refreshContent: (name: string) => void;
};
const LearningContext = createContext<Context | null>(null);
/** `localStorage`, or null when the browser blocks even reaching it. */
function browserStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
export function LearningProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [contentRelease, setContentRelease] = useState(contentVersion);
  const audio = useRef<AudioContext | null>(null);
  // False until hydration says the live key may be written. It stays false for
  // the whole session when storage could not be read or the backup could not
  // be made, so a failed load can never save a blank state over progress.
  const canPersist = useRef(false);
  useEffect(() => {
    // A newer release cached by an earlier visit becomes the active content
    // first, so hydration below reads lessons and sizes from the copy the
    // screens will show.
    setContentRelease(activateCachedRelease(browserStorage()));
    // All of the first-load rules live in hydrateProgress(): it makes the
    // backup and stash writes itself, before the live key is ever written.
    const { state, persist } = hydrateProgress(
      browserStorage(),
      localDate(),
      randomId,
    );
    canPersist.current = persist;
    setState(state);
    setStorageError(!persist);
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (canPersist.current)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    document.documentElement.dataset.motion = state.prefs.reducedMotion
      ? 'reduced'
      : 'full';
  }, [state, ready]);
  function refreshContent(name: string) {
    setContentRelease(name);
    // A release can activate in a tab left idle: start from what another
    // tab may have saved since, never write this tab's old copy over it.
    setState((s) => fitSessions(latestStored(s, browserStorage())));
  }
  function play(correct: boolean) {
    if (!state.prefs.sound) return;
    try {
      const ctx = (audio.current ??= new AudioContext());
      void ctx.resume();
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(correct ? 660 : 220, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(
        correct ? 990 : 165,
        ctx.currentTime + 0.15,
      );
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.26);
    } catch {
      /* Optional sound. */
    }
  }
  return (
    <LearningContext.Provider
      value={{
        state,
        ready,
        storageError,
        update: setState,
        play,
        contentRelease,
        refreshContent,
      }}
    >
      {children}
      <ReleaseRefresher />
      {storageError && (
        <output className="storage-warning">
          Your browser cannot save progress right now. You can keep learning in
          this tab.
        </output>
      )}
    </LearningContext.Provider>
  );
}
export function useLearning() {
  const context = useContext(LearningContext);
  if (!context) throw new Error('LearningProvider required');
  return context;
}
