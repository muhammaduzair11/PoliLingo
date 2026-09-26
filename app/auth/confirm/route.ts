/**
 * The button in the sign-in email lands here (docs/platform.md 4.8,
 * supabase/templates): the token hash becomes a session, then the same
 * finish as Google. Typing the 6-digit code on /sign-in is the main path;
 * this is for someone who taps the button instead.
 */
import type { EmailOtpType } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { safeNext } from '@/lib/safe-next';
import { serverSupabase } from '@/lib/supabase/server';
import { backToSignIn, finishSignIn } from '../finish';

export const dynamic = 'force-dynamic';

const TYPES: ReadonlySet<string> = new Set(['email', 'magiclink', 'signup']);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get('next'));
  const tokenHash = params.get('token_hash');
  const type = params.get('type') ?? '';
  const supabase = await serverSupabase();
  if (!supabase || !tokenHash || !TYPES.has(type))
    return backToSignIn(request, next, 'link');
  try {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (error) return backToSignIn(request, next, 'link');
  } catch {
    return backToSignIn(request, next, 'link');
  }
  return finishSignIn(request, supabase, next);
}
