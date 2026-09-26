/**
 * GET /api/release?known=<contentHash> (docs/platform.md 4.7).
 *
 * Tells a browser which learner copy the server stands behind, and hands it
 * over when the browser does not have it. The upstream read is
 * public.get_learner_release() through Supabase's REST API with the
 * publishable key: the one function anonymous visitors may call. It is
 * fetched once and kept in the Next data cache under the tag
 * 'learner-release', so every learner's poll is answered from the cache.
 * The cache refreshes itself every minute, which also picks up what Publish
 * cannot tag, such as the overlay kill switch. When Publish (track F)
 * expires the tag (updateTag('learner-release') in its Server Action, or
 * revalidateTag('learner-release', 'max'), which serves the old answer once
 * while it refreshes), learners get the new release on a poll after the
 * cache has refreshed: within about a minute.
 *
 * The answer (releaseAnswer() in lib/release-verify.ts) is one of
 *   { release, contentHash, payload }  the latest release, when `known` is
 *                                      not its hash;
 *   { unchanged: true }                the browser has it, or the route could
 *                                      not ask (no Supabase settings, the
 *                                      database unreachable, an error): a
 *                                      learner keeps the content they have;
 *   { reset: true }                    the function answered null (the kill
 *                                      switch is off, or nothing is
 *                                      released): browsers go back to the
 *                                      build's own content.
 * Always with status 200. The browser verifies any payload before it shows
 * it.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { releaseAnswer, type ReleaseAnswer } from '@/lib/release-verify';
import { supabaseEnv } from '@/lib/supabase/env';

/** How long a cached upstream answer is served before it is refreshed, in seconds. */
const REFRESH_SECONDS = 60;
/** Longer than this and the learner keeps their content; the next poll tries again. */
const UPSTREAM_TIMEOUT_MS = 8000;

/** The function's answer (null included), or undefined when it could not be asked. */
async function latestRelease(): Promise<unknown> {
  const env = supabaseEnv();
  if (!env) return undefined;
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
  if (!response.ok) return undefined;
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
