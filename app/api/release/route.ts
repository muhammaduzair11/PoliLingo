/**
 * GET /api/release?known=<contentHash> (docs/platform.md 4.7).
 *
 * Tells a browser whether a newer learner copy has been published, and
 * hands it over when there is one. The upstream read is
 * public.get_learner_release() through Supabase's REST API with the
 * publishable key: the one function anonymous visitors may call. It is
 * fetched once and kept in the Next data cache under the tag
 * 'learner-release', so every learner's poll is answered from the cache;
 * Publish (track F) calls revalidateTag('learner-release') and the next poll
 * sees the new release. The cache also refreshes itself every minute, which
 * picks up what Publish cannot tag, such as the overlay kill switch.
 *
 * The answer is { unchanged: true } or { release, contentHash, payload }.
 * Whatever goes wrong (no Supabase settings, the database unreachable, an
 * error, a kill switch) is { unchanged: true } with status 200: a learner
 * simply keeps the content they have. The browser verifies any payload
 * before it shows it (lib/release-verify.ts).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { releaseAnswer, type ReleaseAnswer } from '@/lib/release-verify';
import { supabaseEnv } from '@/lib/supabase/env';

/** How long a cached upstream answer is served before it is refreshed, in seconds. */
const REFRESH_SECONDS = 60;
/** Longer than this and the learner keeps their content; the next poll tries again. */
const UPSTREAM_TIMEOUT_MS = 8000;

async function latestRelease(): Promise<unknown> {
  const env = supabaseEnv();
  if (!env) return null;
  // A GET, because the function is stable: PostgREST then runs it read-only,
  // and Next caches only GET requests. Only the apikey header is sent: an
  // Authorization header would keep Next from caching the response, and
  // anon is the role the publishable key gets without one.
  const response = await fetch(
    new URL('/rest/v1/rpc/get_learner_release', env.url),
    {
      headers: { apikey: env.publishableKey, accept: 'application/json' },
      cache: 'force-cache',
      next: { revalidate: REFRESH_SECONDS, tags: ['learner-release'] },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    },
  );
  // Only a 200 is cached, so a failure is retried on the next poll.
  if (!response.ok) return null;
  return response.json();
}

export async function GET(request: NextRequest) {
  const known = request.nextUrl.searchParams.get('known') || null;
  let answer: ReleaseAnswer = { unchanged: true };
  try {
    answer = releaseAnswer(await latestRelease(), known);
  } catch {
    // Unreachable, timed out or not JSON: nothing new, as far as anyone knows.
  }
  return NextResponse.json(answer, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
