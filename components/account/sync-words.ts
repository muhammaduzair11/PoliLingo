import type { AccountSnapshot, SyncStatus } from '@/lib/account-store';

/**
 * What each sync state is called on screen (the header chip's label, the
 * account page). Short, and never alarming: local progress is always safe,
 * whatever the account is doing.
 */
export const SYNC_SHORT: Readonly<Record<SyncStatus, string>> = {
  idle: 'Ready to save',
  syncing: 'Saving…',
  synced: 'Saved',
  offline: 'Offline',
  error: 'Not saved yet',
  paused: 'Saving paused',
};

export const SYNC_SENTENCE: Readonly<Record<SyncStatus, string>> = {
  idle: 'Your progress will save to your account as you learn.',
  syncing: 'Saving your progress to your account…',
  synced: 'Your progress is saved to your account.',
  offline:
    'You’re offline. Your progress is safe here and saves when you’re back online.',
  error:
    'We couldn’t save to your account just now. Your progress is safe here, and we’ll try again.',
  paused:
    'Saving to your account is paused on this device. Your progress is safe here.',
};

/** "just now", "5 minutes ago", "yesterday"… for the last save. */
export function sinceWords(
  iso: string | null,
  now = Date.now(),
): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const seconds = Math.round((then - now) / 1000);
  if (seconds > -60) return 'just now';
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const minutes = Math.round(seconds / 60);
  if (minutes > -60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours > -24) return format.format(hours, 'hour');
  return format.format(Math.round(hours / 24), 'day');
}

/** The header chip's accessible name. */
export function chipLabel(account: AccountSnapshot): string {
  const who = account.email ? `Your account, ${account.email}` : 'Your account';
  return `${who}. ${SYNC_SHORT[account.sync]}.`;
}
