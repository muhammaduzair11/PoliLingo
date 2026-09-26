/**
 * The button in the sign-in email lands here (docs/platform.md 4.8,
 * supabase/templates). Typing the 6-digit code on /sign-in is the main path;
 * this is for someone who taps the button instead.
 *
 * GET never uses the token. Mail scanners fetch every link in an email
 * before the person sees it, and a GET that signed in would use up the code
 * in the same email; a link crafted by someone else would sign a visitor in
 * to that person's account. So GET only sends the browser on to
 * /sign-in/confirm, a page with a "Finish signing in" button, and the
 * button's POST (from this site only) turns the token into a session and
 * finishes like Google does.
 *
 * The link also carries `n`, the value of this browser's EMAIL_LINK_COOKIE
 * when it asked for the code (lib/safe-next.ts). The POST signs in only when
 * they match, so a link someone else asked for signs nobody in here.
 */
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  EMAIL_LINK_COOKIE,
  emailLinkMatches,
  emailLinkNonce,
  emailLinkToken,
  emailLinkType,
  isSameOriginPost,
  safeNext,
} from '@/lib/safe-next';
import { serverSupabase } from '@/lib/supabase/server';
import { backToSignIn, finishSignIn } from '../finish';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get('next'));
  const tokenHash = emailLinkToken(params.get('token_hash'));
  const type = emailLinkType(params.get('type'));
  if (!tokenHash || !type) return backToSignIn(request, next, 'link');
  const confirm = new URL('/sign-in/confirm', request.url);
  confirm.searchParams.set('token_hash', tokenHash);
  confirm.searchParams.set('type', type);
  confirm.searchParams.set('next', next);
  const nonce = emailLinkNonce(params.get('n'));
  if (nonce) confirm.searchParams.set('n', nonce);
  const response = NextResponse.redirect(confirm, 303);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const next = safeNext(stringOf(form?.get('next')));
  const sameOrigin = isSameOriginPost({
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    host:
      request.headers.get('x-forwarded-host')?.split(',')[0] ??
      request.headers.get('host'),
  });
  const tokenHash = emailLinkToken(form?.get('token_hash'));
  const type = emailLinkType(form?.get('type'));
  if (!sameOrigin || !tokenHash || !type)
    return backToSignIn(request, next, 'link');
  const store = await cookies();
  if (!emailLinkMatches(store.get(EMAIL_LINK_COOKIE)?.value, form?.get('n')))
    return backToSignIn(request, next, 'browser');
  const supabase = await serverSupabase();
  if (!supabase) return backToSignIn(request, next, 'link');
  try {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (error) return backToSignIn(request, next, 'link');
  } catch {
    return backToSignIn(request, next, 'link');
  }
  store.delete(EMAIL_LINK_COOKIE);
  return finishSignIn(request, supabase, next);
}

function stringOf(value: FormDataEntryValue | null | undefined): string | null {
  return typeof value === 'string' ? value : null;
}
