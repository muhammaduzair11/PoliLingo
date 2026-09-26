/**
 * Invitations and roles in words (docs/platform.md 3.9 C, 4.10): the
 * one-time link and its WhatsApp share, what an invitation offers, where a
 * new team member lands, how each refusal reads on the invitation page, and
 * the dates on the people page.
 *
 * Pure: no React, no Supabase. Dates are shown in UTC so the server render
 * and the browser agree, and a role's end date means the start of that day
 * in UTC.
 */

export type InviteRole = 'admin' | 'editor' | 'language_reviewer';

/** Where an invitation or a grant applies, as the database names it. */
export type Scope = {
  role: InviteRole;
  language_name?: string | null;
  variety_name?: string | null;
};

export const ROLE_LABELS: Readonly<Record<InviteRole, string>> = {
  admin: 'Admin',
  editor: 'Editor',
  language_reviewer: 'Reviewer',
};

/** How long a new invitation link lasts, in days (create_invitation allows 1–30). */
export const EXPIRY_CHOICES: readonly number[] = [1, 3, 7, 14, 30];
export const DEFAULT_EXPIRY_DAYS = 7;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Whether a string can be an invitation token: 43 base64url characters. */
export function isInviteToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN.test(token);
}

export function isInviteRole(role: unknown): role is InviteRole {
  return role === 'admin' || role === 'editor' || role === 'language_reviewer';
}

export function roleLabel(role: string): string {
  return isInviteRole(role) ? ROLE_LABELS[role] : 'Team member';
}

/** "Northern Pashto (Yusufzai)", "Pashto", "Every language", "The whole workspace". */
export function scopeLabel(scope: Scope): string {
  switch (scope.role) {
    case 'admin':
      return 'The whole workspace';
    case 'editor':
      return scope.language_name || 'Every language';
    case 'language_reviewer':
      return scope.variety_name || scope.language_name || 'One variety';
  }
}

/** The invitation card's title. */
export function inviteHeadline(scope: Scope): string {
  switch (scope.role) {
    case 'admin':
      return "You're invited to help run PoliLingo";
    case 'editor':
      return scope.language_name
        ? `You're invited to write ${scope.language_name} lessons`
        : "You're invited to write lessons for PoliLingo";
    case 'language_reviewer':
      return `You're invited to review ${scopeLabel(scope)}`;
  }
}

/** A few words on what the role involves, for the invitation card. */
export function roleDuties(scope: Scope): string[] {
  switch (scope.role) {
    case 'admin':
      return [
        'Invite reviewers and editors, and end roles when work finishes',
        'Publish new lessons to learners',
        'See how every language is coming along',
      ];
    case 'editor':
      return [
        `Write and arrange lessons${scope.language_name ? ` in ${scope.language_name}` : ''}`,
        'Add phrases, meanings and exercises, with live spelling checks',
        'Send lessons to native-speaker reviewers',
      ];
    case 'language_reviewer':
      return [
        `Check phrases in ${scopeLabel(scope)} on your phone or computer`,
        'Approve them, suggest a fix, or ask for changes',
        'Your name is kept with every review you make',
      ];
  }
}

/** Where someone lands after accepting: their part of the workspace. */
export function consoleHomeFor(role: string): string {
  if (role === 'admin') return '/admin';
  if (role === 'editor') return '/edit';
  return '/review';
}

/**
 * The full link for create_invitation's `path` on this site's origin, or
 * null when either is not what it should be.
 */
export function inviteUrl(path: string, origin: string): string | null {
  if (!/^\/invite\/[A-Za-z0-9_-]{43}$/.test(path)) return null;
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  return `${base.origin}${path}`;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "3 Oct 2026", in UTC. Empty for a missing or unreadable date. Written out
 * by hand rather than with Intl, whose month names differ between runtimes
 * ("Sep" or "Sept"), so the server and the browser always agree.
 */
export function formatDay(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "Mon 28 Sep", in UTC, or empty. */
export function formatWeekday(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** The first name to greet someone by, or null. */
function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * The message that carries the link: warm, short, and clear that the link
 * is personal, works once and expires.
 */
export function inviteMessage({
  url,
  name,
  email,
  expiresAt,
  ...scope
}: Scope & {
  url: string;
  name?: string | null;
  /** The invited address, so they know which one to sign in with. */
  email?: string | null;
  expiresAt: string | Date;
}): string {
  const hello = firstName(name) ? `Salaam ${firstName(name)}!` : 'Salaam!';
  const what =
    scope.role === 'language_reviewer'
      ? `to review ${scopeLabel(scope)} on PoliLingo`
      : scope.role === 'editor'
        ? `to write ${scope.language_name ? `${scope.language_name} ` : ''}lessons on PoliLingo`
        : 'to help run PoliLingo';
  const until = formatDay(expiresAt);
  const address = email?.trim() || 'the email address this was sent to';
  return [
    `${hello} You're invited ${what}.`,
    `Open this link and sign in with ${address} to join. It's just for you, works once${until ? ` and expires on ${until}` : ''}:`,
    url,
  ].join('\n\n');
}

/** A WhatsApp share link that opens the chat picker with the message filled in. */
export function whatsAppShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** What the invitation page says for a refusal: a title, why, and what to do next. */
export type InviteRefusal = { title: string; message: string; next: string };

const REFUSALS: Readonly<Record<string, InviteRefusal>> = {
  PL404_INVITATION_NOT_FOUND: {
    title: "We couldn't find that invitation",
    message: 'The link may be incomplete, or it may have been mistyped.',
    next: 'Check you opened the whole link, or ask the person who invited you to send a new one.',
  },
  PL410_INVITATION_REVOKED: {
    title: 'This invitation was cancelled',
    message: 'The person who sent it has withdrawn it.',
    next: 'If you think that was a mistake, ask them for a new link.',
  },
  PL410_INVITATION_EXPIRED: {
    title: 'This invitation has expired',
    message: 'Invitation links only work for a short time, to keep them safe.',
    next: 'Ask the person who invited you to send a fresh link.',
  },
  PL410_INVITATION_USED: {
    title: 'This invitation has already been used',
    message: 'Each link works once, and this one has been accepted.',
    next: 'If that wasn’t you, ask the person who invited you for a new link.',
  },
  PL403_EMAIL_UNVERIFIED: {
    title: 'Confirm your email address first',
    message: 'We need to know this address is yours before you join the team.',
    next: 'Open the email we sent you and confirm it, then come back to this link.',
  },
  PL403_WRONG_EMAIL: {
    title: 'This invitation is for a different email address',
    message:
      'Invitations are personal, so only the invited address can accept.',
    next: 'Sign in with the address the invitation was sent to.',
  },
  PL403_NO_PROFILE: {
    title: 'One quick question first',
    message: 'Tell us your age band, then accept the invitation.',
    next: 'Answer the question above, then press Accept again.',
  },
  PL403_UNDER_18: {
    title: 'Team roles are for people 18 and over',
    message:
      'Your account says you are under 18, so this invitation can’t be accepted.',
    next: 'You can keep learning with PoliLingo as usual.',
  },
  PL409_ROLE_CONFLICT: {
    title: 'An admin can’t also be a reviewer',
    message: 'You already hold a role that doesn’t go with this one.',
    next: 'Ask an admin to end your other role first, then open this link again.',
  },
  PL409_ALREADY_HAS_ROLE: {
    title: 'You already have this role',
    message: 'There’s nothing more to do: your workspace is ready.',
    next: 'Open the workspace to carry on.',
  },
  PL401_NOT_SIGNED_IN: {
    title: 'Please sign in',
    message: 'You need to be signed in to accept an invitation.',
    next: 'Sign in with the address the invitation was sent to, then open this link again.',
  },
};

/**
 * The refusal for a code from peek_invitation or accept_invitation, or null
 * when the code is not one the invitation page explains itself (the caller
 * then shows describeDbError's sentence).
 */
export function inviteRefusal(code: string): InviteRefusal | null {
  return Object.hasOwn(REFUSALS, code) ? REFUSALS[code] : null;
}

/** A grant as page_admin_people returns it. */
export type GrantWindow = {
  starts_at: string;
  ends_at: string | null;
  state: 'active' | 'ending' | 'ended' | 'scheduled';
};

/** "Since 2 Sep 2026", "Until 5 Oct 2026", "Ended 1 Sep 2026", "Starts 9 Oct 2026". */
export function grantWindowLabel(grant: GrantWindow): string {
  switch (grant.state) {
    case 'scheduled':
      return `Starts ${formatDay(grant.starts_at)}`;
    case 'active':
      return `Since ${formatDay(grant.starts_at)}`;
    case 'ending':
      return `Until ${formatDay(grant.ends_at)}`;
    case 'ended':
      return `Ended ${formatDay(grant.ends_at)}`;
  }
}

/** YYYY-MM-DD of the UTC day after `now`: the earliest end date to offer. */
export function tomorrowUtc(now: Date): string {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return next.toISOString().slice(0, 10);
}

/**
 * A date picked for a role to end (YYYY-MM-DD) as the start of that UTC day,
 * or null unless it is a real date after today.
 */
export function endOfRoleTimestamp(date: unknown, now: Date): string | null {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return null;
  const at = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== date)
    return null;
  if (date < tomorrowUtc(now)) return null;
  return at.toISOString();
}
