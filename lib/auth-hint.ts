/**
 * Whether the browser holds a Supabase session cookie, read without loading
 * supabase-js.
 *
 * Learner pages stay static and never load supabase-js for an anonymous
 * visitor (docs/platform.md 4.5). components/account-boot.tsx asks this
 * first, from document.cookie, and loads the account runtime only when it is
 * true. @supabase/ssr names the session cookie sb-<project ref>-auth-token,
 * split into .0, .1, … when it is large. The sb-…-auth-token-code-verifier
 * cookie is only a sign-in in progress, so it does not count.
 *
 * A hint is not a session: the runtime still asks Supabase, and an expired
 * cookie simply ends up anonymous.
 */
const SESSION_COOKIE = /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/;

export function hasSessionHint(cookie: string): boolean {
  return SESSION_COOKIE.test(cookie);
}
