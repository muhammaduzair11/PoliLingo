'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import {
  ArrowUpRight,
  Heart,
  Mountain,
  Pause,
  Play,
  Settings2,
} from 'lucide-react';
import { useLearning } from './learning-provider';
import { selectedCourse } from '@/lib/content';
import { AccountChip } from './account/header-chip';
export function Brand({ current = false }: { current?: boolean }) {
  return (
    <Link
      href="/"
      className="brand"
      aria-label="PoliLingo home"
      aria-current={current ? 'page' : undefined}
    >
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
/**
 * The same decorative-motion switch as MotionButton, as words. On phones the
 * header has no room for an unlabelled icon, so this one sits in the footer
 * and beside the landing page's marquee. Its label stays the same and
 * aria-pressed says whether motion is paused.
 */
export function MotionToggle({ className = '' }: { className?: string }) {
  const { state, update } = useLearning();
  const paused = state.prefs.reducedMotion;
  return (
    <button
      type="button"
      className={`motion-toggle ${className}`}
      aria-pressed={paused}
      onClick={() =>
        update((s) => ({
          ...s,
          prefs: { ...s.prefs, reducedMotion: !s.prefs.reducedMotion },
        }))
      }
    >
      <Pause size={15} aria-hidden="true" /> Pause motion
    </button>
  );
}
export function Header({ home = false }: { home?: boolean }) {
  const { state, ready } = useLearning();
  const pathname = usePathname() ?? '';
  // Smooth in-page scrolling, declared the way Next.js expects, so it is
  // switched off during page changes (app/styles/base.css).
  useEffect(() => {
    document.documentElement.dataset.scrollBehavior = 'smooth';
  }, []);
  // The remembered course only when the learner can see it; otherwise these
  // links lead to the language picker, as for someone who has not chosen.
  const remembered = selectedCourse(state.selected);
  const adventure = remembered ? `/learn/${remembered.id}` : '/';
  const ctaHref = remembered
    ? `/learn/${remembered.id}`
    : home
      ? '#languages'
      : '/';
  // The CTA is a way onwards, so it never points at the page it is on
  // ("Keep going" on the map it opens) and it stays out of onboarding, which
  // has its own next step. Away from the home page it waits for the stored
  // progress, so it does not flash "Let’s go" at a returning learner.
  const showCta =
    (home || ready) &&
    ctaHref !== pathname &&
    !pathname.startsWith('/onboarding');
  return (
    <header className={`site-header ${home ? 'home-header' : ''}`}>
      <div className="header-inner">
        <Brand current={pathname === '/'} />
        <nav aria-label="Main navigation">
          {home ? (
            <>
              <a href="#languages">The languages</a>
              <a href="#how-it-works">The adventure</a>
              <a href="#meet-poli">
                Meet Poli <Heart size={13} />
              </a>
            </>
          ) : adventure === pathname ? (
            <span className="nav-current" aria-current="page">
              My adventure
            </span>
          ) : (
            <Link href={adventure}>My adventure</Link>
          )}
        </nav>
        <div className="header-actions">
          <MotionButton />
          {!home && pathname !== '/settings' && (
            <Link
              href="/settings"
              className="icon-button"
              aria-label="Settings"
            >
              <Settings2 size={20} />
            </Link>
          )}
          <AccountChip />
          {showCta && (
            <Link
              className="button button-small button-ink header-cta"
              href={ctaHref}
            >
              {/* One label shows at a time (responsive-580.css), so the name
                  read out is always the one on screen. Never arrow-only. */}
              <span className="header-cta-label">
                {remembered ? 'Keep going' : 'Let’s go'}
              </span>
              <span className="header-cta-short">
                {remembered ? 'Continue' : 'Start'}
              </span>
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
export function Footer() {
  const pathname = usePathname();
  return (
    <footer className="site-footer">
      <Brand current={pathname === '/'} />
      <p>Many languages. A little more together.</p>
      <div>
        <span>Made for connection.</span>
        <Link
          href="/settings"
          aria-current={pathname === '/settings' ? 'page' : undefined}
        >
          Settings & sources <ArrowUpRight size={14} />
        </Link>
        <nav className="footer-legal" aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
        <MotionToggle className="footer-motion" />
      </div>
    </footer>
  );
}
