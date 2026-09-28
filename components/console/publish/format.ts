/**
 * Dates and counts for the publish screen. Times are shown in Pakistan time
 * (PKT, UTC+5), where the team works, and say so; release names stay dated
 * in UTC (content@YYYY.MM.N), as the database makes them. The day is the
 * console's one day format (formatDay), as on the overview.
 */
import {
  formatPktDateTime,
  formatPktDay,
  formatPktTime,
} from '@/lib/console/invite-link';

/** "26 Sep 2026", the day in Pakistan. */
export function formatDate(value: string | null | undefined): string {
  return formatPktDay(value);
}

/** "7:05 pm PKT" */
export function formatTime(value: string | null | undefined): string {
  const time = formatPktTime(value);
  return time ? `${time} PKT` : '';
}

/** "26 Sep 2026, 7:05 pm PKT" */
export function formatDateTime(value: string | null | undefined): string {
  return formatPktDateTime(value);
}

/** "1 lesson", "3 lessons" */
export function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
}

/** "a, b and c" */
export function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
