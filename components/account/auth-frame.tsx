import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Brand } from '../site-chrome';

/**
 * The quiet frame around sign-in: the brand, a way back to learning, and
 * the card in the middle of the ivory page. No header chip, no nav: one
 * thing to do here.
 */
export function AuthFrame({
  back,
  children,
}: {
  back: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-frame">
      <header className="auth-bar">
        <Brand />
        <Link className="text-link auth-back" href={back}>
          <ArrowLeft size={17} /> Back to learning
        </Link>
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
