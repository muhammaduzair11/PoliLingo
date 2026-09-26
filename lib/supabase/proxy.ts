/**
 * Refreshes the Supabase session cookies for one request in the proxy and
 * says who is signed in (docs/platform.md 4.2).
 *
 * This follows @supabase/ssr's guidance for Next.js: the client reads the
 * request's cookies, writes refreshed ones to both the request (so the page
 * rendered after the proxy sees them) and the response (so the browser keeps
 * them), and the response carries the no-store headers the library passes,
 * so a CDN never serves one person's session to another. Nothing may run
 * between creating the client and getClaims().
 *
 * The request also gets an x-polilingo-path header with the path and query,
 * so the console layout can send someone back where they were after signing
 * in.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { PATH_HEADER } from '../console/paths';
import { supabaseEnv } from './env';

export type SessionUpdate = {
  response: NextResponse;
  /** The signed-in user's id and email, or null. */
  user: { id: string; email: string | null } | null;
};

export async function updateSession(
  request: NextRequest,
): Promise<SessionUpdate> {
  request.headers.set(
    PATH_HEADER,
    request.nextUrl.pathname + request.nextUrl.search,
  );
  let response = NextResponse.next({ request });
  const env = supabaseEnv();
  if (!env) return { response, user: null };

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet)
          request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {}))
          response.headers.set(key, value);
      },
    },
  });

  try {
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    const user =
      claims && typeof claims.sub === 'string'
        ? {
            id: claims.sub,
            email: typeof claims.email === 'string' ? claims.email : null,
          }
        : null;
    return { response, user };
  } catch {
    // Supabase unreachable: treat as signed out for routing; the page itself
    // shows the network sentence if it cannot load.
    return { response, user: null };
  }
}
