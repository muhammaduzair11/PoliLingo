/**
 * Google comes back here (docs/platform.md 4.8): the PKCE code becomes a
 * session in cookies, the declared age band becomes the profile, and the
 * person goes on to `next`. A cancelled or failed sign-in goes back to
 * /sign-in with a plain sentence. Nothing here renders a page.
 */
import type { NextRequest } from 'next/server';
import { safeNext } from '@/lib/safe-next';
import { serverSupabase } from '@/lib/supabase/server';
import { backToSignIn, finishSignIn } from '../finish';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get('next'));
  const code = params.get('code');
  const supabase = await serverSupabase();
  if (!supabase || !code)
    return backToSignIn(
      request,
      next,
      params.get('error') ? 'cancelled' : 'link',
    );
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return backToSignIn(request, next, 'link');
  } catch {
    return backToSignIn(request, next, 'link');
  }
  return finishSignIn(request, supabase, next);
}
