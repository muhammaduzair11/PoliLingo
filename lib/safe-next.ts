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

/**
 * Where "Back to learning" goes from the sign-in pages: `next` when it is a
 * learner page, else the learning map. It never lands on a workspace page.
 */
export function learnerBack(next: string): string {
  return /^\/(?:learn|lesson|onboarding|settings)(?:[/?#]|$)/.test(next) ||
    next === '/'
    ? next
    : DEFAULT_NEXT;
}
