/**
 * The end of both sign-in routes (docs/platform.md 4.8): the session exists,
 * so save the age band declared before signing in, clear its cookie, and
 * send the person on with a full page load.
 *
 * Someone without a profile and without the cookie (the email link opened
 * on another device, or after the 30 minutes) goes to /account, which asks
 * the age question before anything else.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AGE_BAND_COOKIE, parseAgeBand } from '@/lib/age-gate';
import { callRpc } from '@/lib/rpc';

/** 303, so the browser follows with a GET after the confirm route's POST. */
function redirectTo(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

/** Back to /sign-in with a reason the page puts in words. */
export function backToSignIn(
  request: NextRequest,
  next: string,
  reason: 'link' | 'cancelled' | 'profile',
): NextResponse {
  return redirectTo(
    request,
    `/sign-in?next=${encodeURIComponent(next)}&error=${reason}`,
  );
}

export async function finishSignIn(
  request: NextRequest,
  supabase: SupabaseClient,
  next: string,
): Promise<NextResponse> {
  const store = await cookies();
  const band = parseAgeBand(store.get(AGE_BAND_COOKIE)?.value);
  store.delete(AGE_BAND_COOKIE);

  if (band) {
    const saved = await callRpc(supabase, 'ensure_profile', {
      p_age_band: band,
    });
    if (saved.ok) return redirectTo(request, next);
  }
  const context = await callRpc<{ profile: unknown }>(supabase, 'my_context');
  if (context.ok && context.data.profile) return redirectTo(request, next);
  if (!context.ok && context.error.code === 'NETWORK')
    return backToSignIn(request, next, 'profile');
  return redirectTo(request, `/account?next=${encodeURIComponent(next)}`);
}
