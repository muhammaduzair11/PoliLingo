/**
 * What every console server action returns (docs/platform.md 4.3): the data,
 * or a code and a sentence that are safe to show. Forms read it with
 * useActionState; the kit's Notice and ConfirmAction show the sentence.
 */
import { describeDbError } from '../db-errors.ts';
import type { RpcResult } from '../rpc.ts';

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/** A refusal from anything thrown or returned by Supabase. */
export function actionError(error: unknown): {
  ok: false;
  code: string;
  message: string;
} {
  const { code, message } = describeDbError(error);
  return { ok: false, code, message };
}

/** A refusal of our own, such as a form field left empty. */
export function actionRefusal(
  code: string,
  message: string,
): { ok: false; code: string; message: string } {
  return { ok: false, code, message };
}

/** An RPC result as an action result. */
export function fromRpc<T>(result: RpcResult<T>): ActionResult<T> {
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, code: result.error.code, message: result.error.message };
}
