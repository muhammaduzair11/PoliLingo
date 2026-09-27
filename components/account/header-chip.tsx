'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserRound } from 'lucide-react';
import { useAccount } from '@/lib/account-store';
import { signInHref } from '@/lib/safe-next';
import { accountsEnabled } from './accounts-enabled';
import { chipLabel, SYNC_SHORT } from './sync-words';

/**
 * The account chip in the site header (docs/platform.md 4.8). It reads only
 * the account store, so an anonymous visitor never loads Supabase for it.
 *
 *   anonymous  an icon link to /sign-in, back to this page afterwards
 *   signed in  the email's initial in a circle, to /account, with a dot for
 *              how saving is going
 *   unknown    an empty space of the same size, so nothing jumps
 */
export function AccountChip() {
  const account = useAccount();
  const pathname = usePathname();
  if (!accountsEnabled) return null;
  if (account.status === 'signed-in')
    return (
      <Link
        href="/account"
        className="account-chip"
        aria-label={chipLabel(account)}
        title={`${account.email ?? 'Your account'} · ${SYNC_SHORT[account.sync]}`}
      >
        <span className="account-chip-initial" aria-hidden="true">
          {account.initial ?? <UserRound size={17} />}
        </span>
        <span
          className={`account-chip-dot account-chip-dot-${account.sync}`}
          aria-hidden="true"
        />
      </Link>
    );
  if (account.status === 'anonymous')
    return (
      <Link
        href={signInHref(pathname)}
        className="icon-button account-sign-in"
        aria-label="Sign in to save your progress"
        title="Sign in to save your progress"
      >
        <UserRound size={20} />
      </Link>
    );
  return <span className="account-chip-placeholder" aria-hidden="true" />;
}
