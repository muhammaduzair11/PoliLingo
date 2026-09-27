/**
 * The two public Supabase settings (docs/platform.md 4.1): the project URL
 * and the publishable (anon) key. Both are public by design; the key
 * identifies the project and authorises nothing on its own, because every
 * table has Row Level Security and every privileged action is a database
 * function that checks auth.uid(). No service-role or secret key is ever
 * read by this app.
 *
 * Each is read literally, process.env.NEXT_PUBLIC_…, so Next inlines it
 * into the browser bundle. Without both, this returns null: the build still
 * passes, learner pages behave exactly as they always have, and the console
 * says it is not configured.
 */
export type SupabaseEnv = { url: string; publishableKey: string };

export function supabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}
