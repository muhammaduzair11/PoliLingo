/**
 * Whether this build can sign anyone in: both public Supabase settings are
 * present. Read literally, so Next inlines them, and without importing
 * lib/supabase, so the learner surfaces that ask (the header chip, the
 * finish screen, Settings) stay free of Supabase code. Without them the
 * learner app looks exactly as it did before accounts.
 */
export const accountsEnabled = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
