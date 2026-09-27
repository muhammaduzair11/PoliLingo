/**
 * Runs before the console, account and invitation routes only: refreshes
 * the Supabase session and sends someone who is not signed in to
 * /sign-in?next=<where they were going> (docs/platform.md 4.2).
 *
 * Learner routes, /sign-in and /auth/* never run it: learner pages stay
 * static and never touch Supabase. The matcher is a literal, as Next
 * requires, and tests/boundaries.test.mjs checks it holds only these
 * prefixes. Without Supabase settings nothing is redirected, and the console
 * says it is not configured.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseEnv } from './lib/supabase/env';
import { updateSession } from './lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  if (user || !supabaseEnv()) return response;
  const signIn = request.nextUrl.clone();
  signIn.pathname = '/sign-in';
  signIn.search = '';
  signIn.searchParams.set(
    'next',
    request.nextUrl.pathname + request.nextUrl.search,
  );
  const redirect = NextResponse.redirect(signIn);
  // Keep any cookie the refresh wrote (for example, a cleared session).
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  redirect.headers.set('Cache-Control', 'private, no-store');
  return redirect;
}

export const config = {
  matcher: [
    '/account/:path*',
    '/review/:path*',
    '/admin/:path*',
    '/edit/:path*',
    '/invite/:path*',
  ],
};
