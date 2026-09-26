'use client';
import Link from 'next/link';
import {
  ArrowUpRight,
  Heart,
  Mountain,
  Pause,
  Play,
  Settings2,
} from 'lucide-react';
import { useLearning } from './learning-provider';
import { selectedCourse } from '@/lib/courses';
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
  const remembered = selectedCourse(state.selected);
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
            <Link href={remembered ? `/learn/${remembered.id}` : '/'}>
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
              remembered ? `/learn/${remembered.id}` : home ? '#languages' : '/'
            }
          >
            {remembered ? 'Keep going' : 'Let’s go'}
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
