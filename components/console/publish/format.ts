/**
 * Dates and counts for the publish screen. Release names are dated in UTC
 * (content@YYYY.MM.N), so their times are shown in UTC too.
 */
const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const TIME = new Intl.DateTimeFormat('en-GB', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC',
});

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "26 Sep 2026" */
export function formatDate(value: string | null | undefined): string {
  const date = parse(value);
  return date ? DATE.format(date) : '';
}

/** "26 Sep 2026, 2:05 pm UTC" */
export function formatDateTime(value: string | null | undefined): string {
  const date = parse(value);
  return date
    ? `${DATE.format(date)}, ${TIME.format(date).toLowerCase()} UTC`
    : '';
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
