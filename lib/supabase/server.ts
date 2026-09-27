/**
 * A Supabase client for one server render, route handler or server action,
 * acting as the signed-in person through their session cookies, or null
 * without settings. Create one per request; never share it.
 *
 * Server components cannot set cookies, so setAll swallows that error there;
 * the proxy (proxy.ts) refreshes the session on console routes before they
 * render, and route handlers and server actions can set cookies.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseEnv } from './env';

export async function serverSupabase(): Promise<SupabaseClient | null> {
  const env = supabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet)
            cookieStore.set(name, value, options);
        } catch {
          // Called from a server component, which cannot set cookies. The
          // proxy has already refreshed the session for this request.
        }
      },
    },
  });
}
