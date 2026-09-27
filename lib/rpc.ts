/**
 * One call to a database function, with its failure already turned into a
 * safe sentence (docs/platform.md 4.3). Console reads call a page_<screen>()
 * function through this; server actions call the write functions.
 *
 * Never imported by a learner page (tests/boundaries.test.mjs).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { describeDbError, type DbError } from './db-errors.ts';

export type RpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: DbError };

/**
 * Calls `public.<fn>(args)`. `supabase` may be null when the app has no
 * Supabase settings; that is a refusal with the code NOT_CONFIGURED rather
 * than a crash. It never throws.
 */
export async function callRpc<T>(
  supabase: SupabaseClient | null,
  fn: string,
  args?: Record<string, unknown>,
): Promise<RpcResult<T>> {
  if (!supabase)
    return {
      ok: false,
      error: describeDbError({ code: 'NOT_CONFIGURED', message: '' }),
    };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, error: describeDbError(error) };
    return { ok: true, data: data as T };
  } catch (error) {
    return { ok: false, error: describeDbError(error) };
  }
}
