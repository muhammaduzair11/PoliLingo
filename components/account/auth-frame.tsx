import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { BackLink } from '@/lib/safe-next';
import { Brand } from '../site-chrome';

/**
 * The quiet frame around sign-in: the brand, a way back named for where it
 * goes (lib/safe-next.ts learnerBack), and the card in the middle of the
 * ivory page. No header chip, no nav: one thing to do here.
 *
 * `hardBack` makes the way back a full page load, for pages reached just
 * after an account was deleted, so nothing of the old session stays in
 * memory.
 */
export function AuthFrame({
  back,
  hardBack = false,
  children,
}: {
  back: BackLink;
  hardBack?: boolean;
  children: ReactNode;
}) {
  const content = (
    <>
      <ArrowLeft size={17} aria-hidden="true" /> <span>{back.label}</span>
    </>
  );
  return (
    <div className="auth-frame">
      <header className="auth-bar">
        <Brand />
        {hardBack ? (
          <a className="text-link auth-back" href={back.href}>
            {content}
          </a>
        ) : (
          <Link className="text-link auth-back" href={back.href}>
            {content}
          </Link>
        )}
      </header>
      <main id="main-content" className="auth-main">
        {children}
      </main>
      <footer className="auth-foot">
        <Link href="/privacy">Privacy</Link>
        <span aria-hidden="true">·</span>
        <Link href="/terms">Terms</Link>
      </footer>
    </div>
  );
}
