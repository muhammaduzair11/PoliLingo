import { Mountain } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ActionResult } from '@/lib/console/action-result';
import { ConsoleAnnouncer } from './announcer';
import { ConsoleNav, type NavGroup } from './nav';
import { SignOutButton } from './sign-out-button';

/**
 * The console's frame: a top bar (brand, "Workspace", the account menu with
 * sign-out) and, when there is anything to navigate, the side nav, which is
 * a tab strip under 800px. Pages render into <main id="main-content">, the
 * root layout's skip link target, under the live region that announces
 * what an action did (announcer.tsx).
 */
export function ConsoleShell({
  nav = [],
  account,
  signOut,
  children,
}: {
  nav?: NavGroup[];
  /** Who is signed in; no menu without it. */
  account?: { email: string | null; name: string | null } | null;
  signOut?: () => Promise<ActionResult<null>>;
  children: ReactNode;
}) {
  const initial =
    (account?.name ?? account?.email ?? '')
      .match(/[\p{L}\p{N}]/u)?.[0]
      ?.toLocaleUpperCase('en') ?? '?';
  return (
    <div className="console-shell">
      <header className="console-topbar">
        {/* The learner site's own mark and wordmark (site-chrome's Brand,
            written out here so the console doesn't load the learner
            header), plus the Workspace pill. */}
        <Link href="/" className="console-brand" aria-label="PoliLingo home">
          <span className="brand-icon console-brand-icon" aria-hidden="true">
            <Mountain size={20} strokeWidth={3} />
          </span>
          <span className="console-brand-name" aria-hidden="true">
            poli<span>lingo</span>
          </span>
          <span className="console-brand-tag">Workspace</span>
        </Link>
        {account && (
          <details className="console-account">
            <summary aria-label="Account menu">
              <span className="console-account-initial" aria-hidden="true">
                {initial}
              </span>
              <span className="console-account-name">
                {account.name ?? account.email}
              </span>
            </summary>
            <div className="console-menu">
              {account.email && (
                <p className="console-menu-email">{account.email}</p>
              )}
              <Link className="console-menu-item" href="/account">
                Your account
              </Link>
              <Link className="console-menu-item" href="/learn">
                Back to learning
              </Link>
              {signOut && <SignOutButton action={signOut} />}
            </div>
          </details>
        )}
      </header>
      <div className={`console-body${nav.length ? '' : ' console-body-plain'}`}>
        <ConsoleNav groups={nav} />
        <main id="main-content" className="console-main">
          <ConsoleAnnouncer>{children}</ConsoleAnnouncer>
        </main>
      </div>
    </div>
  );
}
