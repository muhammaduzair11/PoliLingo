/**
 * The browser's Supabase client, one per tab, or null without settings.
 *
 * Imported only by components/account/**, and the client parts of
 * app/sign-in/** and app/invite/**, so a learner page never loads it
 * (tests/boundaries.test.mjs). components/account-boot.tsx reaches it only
 * through a dynamic import, after a session cookie is seen.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseEnv } from './env';

let client: SupabaseClient | null = null;

export function browserSupabase(): SupabaseClient | null {
  if (client) return client;
  const env = supabaseEnv();
  if (!env) return null;
  client = createBrowserClient(env.url, env.publishableKey);
  return client;
}
