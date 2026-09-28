/**
 * Where to send someone after they sign in (docs/platform.md 4.8).
 *
 * `next` arrives in a URL anyone can craft, so only a path on this site is
 * followed: it must start with exactly one "/", and may not smuggle in a
 * second slash or a backslash (browsers read "/\evil.com" as "//evil.com"),
 * a scheme, or a control character or space (browsers drop tabs and line
 * breaks, which turns "/\t/evil.com" into "//evil.com"). Anything else
 * falls back to the learning map.
 *
 * Pure, and safe on the server and in the browser.
 */

/** A control character, a space, or a line or paragraph separator. */
function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (
      code <= 0x20 ||
      (code >= 0x7f && code <= 0xa0) ||
      code === 0x2028 ||
      code === 0x2029
    )
      return true;
  }
  return false;
}

export const DEFAULT_NEXT = '/learn';

const BASE = 'https://polilingo.invalid';

export function safeNext(
  value: string | null | undefined,
  fallback: string = DEFAULT_NEXT,
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000)
    return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value[1] === '/' || value[1] === '\\') return fallback;
  if (value.includes('\\')) return fallback;
  // Controls, spaces and anything a browser might strip before parsing.
  if (hasUnsafeChar(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  // Dot segments can collapse into a leading "//" ("/a/../..//evil.com").
  if (!url.pathname.startsWith('/') || url.pathname.startsWith('//'))
    return fallback;
  // Sign-in pages lead nowhere new: going back to them would loop.
  if (/^\/(?:sign-in|auth)(?:\/|$)/.test(url.pathname)) return fallback;
  return url.pathname + url.search + url.hash;
}

/** /sign-in?next=<path>, or plain /sign-in when there is nowhere safe to go back to. */
export function signInHref(next: string | null | undefined): string {
  const path = safeNext(next, '');
  return path ? `/sign-in?next=${encodeURIComponent(path)}` : '/sign-in';
}

/** The link types the sign-in email's button can carry (supabase/templates). */
export const EMAIL_LINK_TYPES = ['email', 'magiclink', 'signup'] as const;
export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

/** The `type` of an email sign-in link, or null when it is not one of ours. */
export function emailLinkType(value: unknown): EmailLinkType | null {
  return typeof value === 'string' &&
    (EMAIL_LINK_TYPES as readonly string[]).includes(value)
    ? (value as EmailLinkType)
    : null;
}

/**
 * The `token_hash` of an email sign-in link, or null when it cannot be one
 * (hex, sometimes with a "pkce_" prefix; never long, never anything else).
 */
export function emailLinkToken(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(value)
    ? value
    : null;
}

/**
 * The email's sign-in link works only in the browser that asked for the
 * code. Asking sets this cookie to a random value and puts the same value in
 * the link (`&n=`); /sign-in/confirm and the POST to /auth/confirm refuse a
 * link whose value is not the cookie's. Without it, someone could send their
 * own sign-in link to a learner, whose browser would then sign in to the
 * sender's account and upload the learner's progress to it.
 */
export const EMAIL_LINK_COOKIE = 'pl_email_link';
/** An hour, in seconds: as long as the email's code lasts (otp_expiry). */
export const EMAIL_LINK_MAX_AGE = 60 * 60;

/** The link's browser value, or null when it cannot be one. */
export function emailLinkNonce(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{22,64}$/.test(value)
    ? value
    : null;
}

/** A fresh browser value: 18 random bytes, base64url (24 characters). */
export function newEmailLinkNonce(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The value of EMAIL_LINK_COOKIE in a Cookie header (document.cookie), or null. */
export function readEmailLinkCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === EMAIL_LINK_COOKIE) return emailLinkNonce(rest.join('='));
  }
  return null;
}

/** The Set-Cookie attributes: an hour, the whole site, first-party only. */
export function emailLinkCookie(nonce: string, secure: boolean): string {
  return [
    `${EMAIL_LINK_COOKIE}=${nonce}`,
    'Path=/',
    `Max-Age=${EMAIL_LINK_MAX_AGE}`,
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** Whether a link's value is this browser's (both present and equal). */
export function emailLinkMatches(cookie: unknown, fromLink: unknown): boolean {
  const mine = emailLinkNonce(cookie);
  return mine !== null && mine === emailLinkNonce(fromLink);
}

/** emailRedirectTo for signInWithOtp: /auth/confirm with next and the browser value. */
export function emailLinkRedirect(
  origin: string,
  next: string,
  nonce: string,
): string {
  return `${origin}/auth/confirm?next=${encodeURIComponent(next)}&n=${nonce}`;
}

/**
 * Whether a form POST came from a page on this site. The browser's Origin
 * header must name this host; without one, Sec-Fetch-Site must say
 * "same-origin". Anything else (another site, a sandboxed "null" origin, a
 * request with neither header) is refused. `host` is the host the request
 * was sent to (x-forwarded-host behind a proxy, else Host).
 */
export function isSameOriginPost({
  origin,
  secFetchSite,
  host,
}: {
  origin: string | null;
  secFetchSite: string | null;
  host: string | null;
}): boolean {
  if (secFetchSite && secFetchSite !== 'same-origin') return false;
  if (!origin) return secFetchSite === 'same-origin';
  if (!host || origin === 'null') return false;
  try {
    return new URL(origin).host === host.trim().toLowerCase();
  } catch {
    return false;
  }
}

export type SignInAudience = 'invite' | 'workspace' | 'learner';

/**
 * Who the sign-in pages are talking to, from `next` (already through
 * safeNext): someone opening an invitation, a team member on the way to the
 * workspace, or a learner saving progress. It only chooses the words.
 */
export function signInAudience(next: string): SignInAudience {
  if (next.startsWith('/invite/')) return 'invite';
  if (/^\/(?:admin|edit|review)(?:[/?#]|$)/.test(next)) return 'workspace';
  return 'learner';
}

export type SignInWords = {
  /** The eyebrow, before the step count. */
  eyebrow: string;
  /** Step 1: the line under "First, when were you born?". */
  ageLead: string;
  /** Step 1: what Poli says above it. */
  hello: string;
  /** Step 2: the heading and the line under it. */
  title: string;
  lead: string;
};

/** The sign-in pages' words for each audience. */
export const SIGN_IN_WORDS: Readonly<Record<SignInAudience, SignInWords>> = {
  invite: {
    eyebrow: 'JOIN THE POLILINGO TEAM',
    // Team members are not told "you never need an account": they do.
    ageLead: 'We ask everyone once, for safety. Only your age band is kept.',
    hello: 'Welcome to the team! One quick check first.',
    title: 'Accept your invitation',
    // The invitation only opens for the address it was sent to.
    lead: 'No password to remember. Use the email address this invitation was sent to.',
  },
  workspace: {
    eyebrow: 'SIGN IN TO THE WORKSPACE',
    ageLead: 'We ask everyone once, for safety. Only your age band is kept.',
    hello: 'Good to see you. One quick check first.',
    title: 'Sign in to the workspace',
    lead: 'No password to remember. Use the email address your workspace role is linked to.',
  },
  learner: {
    eyebrow: 'SAVE YOUR PROGRESS',
    ageLead:
      'New here or coming back, it starts the same way: your birth month and year once, then your email. We keep only your age band.',
    hello: 'I’ll keep your lessons, XP and streak safe.',
    title: 'Keep your progress on every device',
    lead: 'No password to remember. Your progress on this device stays here either way.',
  },
};

/** The sign-in steps, as the eyebrow counts them: age, email, code. */
export const SIGN_IN_STEPS = 3;

/** "SAVE YOUR PROGRESS · STEP 2 OF 3" */
export function stepEyebrow(eyebrow: string, step: number): string {
  return `${eyebrow} · STEP ${step} OF ${SIGN_IN_STEPS}`;
}

export type BackLink = { href: string; label: string };

/**
 * The sign-in pages' way back, named for where it goes: `next` when it is a
 * learner page, else the learning map for a learner and the home page for
 * someone on the way to the workspace or an invitation. It never lands on a
 * workspace page, and never says "learning" to someone who came from
 * Settings.
 */
export function learnerBack(target: string): BackLink {
  // Going back is not signing in: never carry the "just signed in" flag.
  const next = withoutSignedIn(target);
  if (/^\/settings(?:[/?#]|$)/.test(next))
    return { href: next, label: 'Back to settings' };
  if (/^\/lesson(?:[/?#]|$)/.test(next))
    return { href: next, label: 'Back to your lesson' };
  if (/^\/learn(?:[/?#]|$)/.test(next))
    return { href: next, label: 'Back to your map' };
  if (/^\/onboarding(?:[/?#]|$)/.test(next) || /^\/(?:[?#]|$)/.test(next))
    return { href: next, label: 'Back to PoliLingo' };
  if (signInAudience(next) !== 'learner')
    return { href: '/', label: 'Back to PoliLingo' };
  return { href: DEFAULT_NEXT, label: 'Back to your map' };
}

/** The query flag that tells the next page someone has just signed in. */
export const SIGNED_IN_PARAM = 'signed_in';

/**
 * `next` (already through safeNext) with ?signed_in=1, so the page it opens
 * can say who just signed in (components/account/runtime.tsx). Adding it
 * twice changes nothing, and the hash stays last.
 */
export function withSignedIn(next: string): string {
  const url = new URL(next, BASE);
  url.searchParams.set(SIGNED_IN_PARAM, '1');
  return url.pathname + url.search + url.hash;
}

/** `path` without ?signed_in; anything else in it is left exactly as it was. */
export function withoutSignedIn(path: string): string {
  if (!path.includes(`${SIGNED_IN_PARAM}=`)) return path;
  const url = new URL(path, BASE);
  url.searchParams.delete(SIGNED_IN_PARAM);
  return url.pathname + url.search + url.hash;
}
