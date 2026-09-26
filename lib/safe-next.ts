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
