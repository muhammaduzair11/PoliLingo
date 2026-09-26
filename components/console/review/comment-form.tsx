'use client';
import { useActionState, useId, useState } from 'react';
import { Notice } from '@/components/console/notice';
import { SubmitButton } from '@/components/console/submit-button';
import type { ActionResult } from '@/lib/console/action-result';

type CommentAction = (
  previous: ActionResult<string> | null,
  formData: FormData,
) => Promise<ActionResult<string>>;

/**
 * Add a comment to a phrase or lesson, or reply to one. Comments are part
 * of the review history: they are kept, and only an admin can remove the
 * text of one.
 */
export function CommentForm({
  targetType,
  targetId,
  parentId,
  action,
  label = 'Add a comment',
  placeholder = 'A question, a pronunciation tip, a note for the editor…',
}: {
  targetType: 'item' | 'lesson';
  targetId: string;
  parentId?: string;
  action: CommentAction;
  label?: string;
  placeholder?: string;
}) {
  const id = useId();
  const [round, setRound] = useState(0);
  const [result, formAction] = useActionState(
    async (previous: ActionResult<string> | null, formData: FormData) => {
      const next = await action(previous, formData);
      if (next.ok) setRound((r) => r + 1);
      return next;
    },
    null,
  );
  return (
    <form
      key={round}
      action={formAction}
      className={`console-form review-comment-form${parentId ? ' review-comment-form-reply' : ''}`}
    >
      <input type="hidden" name="target_type" value={targetType} />
      <input type="hidden" name="target_id" value={targetId} />
      {parentId && <input type="hidden" name="parent_id" value={parentId} />}
      <div className="console-field">
        <label className="console-label" htmlFor={`${id}-body`}>
          {label}
        </label>
        <textarea
          id={`${id}-body`}
          name="body"
          rows={parentId ? 2 : 3}
          maxLength={4000}
          required
          placeholder={placeholder}
          className="console-input"
        />
      </div>
      {result && !result.ok && (
        <Notice tone="error" code={result.code}>
          {result.message}
        </Notice>
      )}
      {result?.ok && round > 0 && (
        <Notice tone="success">
          {parentId ? 'Reply posted.' : 'Comment posted.'}
        </Notice>
      )}
      <div className="console-actions">
        <SubmitButton pendingLabel="Posting…" tone="outline">
          {parentId ? 'Post reply' : 'Post comment'}
        </SubmitButton>
      </div>
    </form>
  );
}
