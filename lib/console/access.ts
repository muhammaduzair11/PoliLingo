/**
 * Who is using the console, from public.my_context(), once per request
 * (docs/platform.md 3.6, 4.3).
 *
 * UI guards built on this are cosmetic: every read and write is decided by
 * the database against auth.uid(). This only chooses what to show.
 */
import 'server-only';
import { cache, createElement, type ReactElement } from 'react';
import { NoAccess } from '../../components/console/no-access';
import { callRpc } from '../rpc';
import type { DbError } from '../db-errors';
import { serverSupabase } from '../supabase/server';

export type AgeBand = '13-17' | '18+';

/** public.my_context() */
export type MyContext = {
  user_id: string;
  email: string | null;
  profile: { age_band: AgeBand } | null;
  contributor: { id: string; display_name: string } | null;
  is_admin: boolean;
  editor_languages: string[] | 'all';
  review_varieties: { id: string; language: string; name: string }[];
  /** Variety ids where the caller is the only active reviewer. */
  sole_reviewer_varieties: string[];
};

export type Access =
  /** No Supabase settings: the console says it is not configured. */
  | { state: 'not-configured' }
  | { state: 'signed-out' }
  /** Signed in, but my_context() failed (network, session, …). */
  | { state: 'error'; error: DbError }
  | { state: 'ready'; context: MyContext };

export type ConsoleRole = 'admin' | 'editor' | 'reviewer' | 'staff';

/** The caller's access, fetched once per request however many components ask. */
export const getAccess = cache(async (): Promise<Access> => {
  const supabase = await serverSupabase();
  if (!supabase) return { state: 'not-configured' };
  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = typeof data?.claims?.sub === 'string';
  } catch {
    signedIn = false;
  }
  if (!signedIn) return { state: 'signed-out' };
  const result = await callRpc<MyContext>(supabase, 'my_context');
  if (result.ok) return { state: 'ready', context: result.data };
  if (result.error.code === 'PL401_NOT_SIGNED_IN')
    return { state: 'signed-out' };
  return { state: 'error', error: result.error };
});

/** Whether the context holds `role`. Admins count as editors; staff is any role. */
export function hasRole(context: MyContext, role: ConsoleRole): boolean {
  const editor =
    context.is_admin ||
    context.editor_languages === 'all' ||
    context.editor_languages.length > 0;
  const reviewer = context.review_varieties.length > 0;
  switch (role) {
    case 'admin':
      return context.is_admin;
    case 'editor':
      return editor;
    case 'reviewer':
      return reviewer;
    case 'staff':
      return context.is_admin || editor || reviewer;
  }
}

export type RoleGate =
  | { ok: true; context: MyContext }
  | { ok: false; view: ReactElement };

/**
 * The context when the caller holds `role`, otherwise the kit's NoAccess
 * panel to render in its place:
 *
 *   const gate = await requireRole('admin');
 *   if (!gate.ok) return gate.view;
 *   const { context } = gate;
 *
 * The console layout has already handled not configured, signed out and no
 * profile, so a page reaching here with any of those gets NoAccess too.
 */
export async function requireRole(role: ConsoleRole): Promise<RoleGate> {
  const access = await getAccess();
  if (access.state === 'ready' && hasRole(access.context, role))
    return { ok: true, context: access.context };
  return {
    ok: false,
    view: createElement(NoAccess, {
      reason: access.state === 'error' ? access.error : undefined,
    }),
  };
}
