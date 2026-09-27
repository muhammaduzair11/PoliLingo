'use client';
import { useId, useState, type ReactNode } from 'react';
import { ConfirmAction } from '@/components/console/confirm-action';
import type { ButtonTone } from '@/components/console/submit-button';
import { retireContent, setPublishGate } from '@/app/(console)/edit/actions';
import type { Gate } from '@/lib/console/editor';

/**
 * The kit's confirm dialog with a "why?" box, for the changes the history
 * keeps a reason for. The box is controlled, so a refusal does not wipe
 * what was typed.
 */
function ReasonDialog({
  action,
  fields,
  triggerLabel,
  triggerTone = 'quiet',
  title,
  description,
  confirmLabel,
  pendingLabel,
  tone,
}: {
  action: typeof retireContent;
  fields: Record<string, string>;
  triggerLabel: ReactNode;
  triggerTone?: ButtonTone;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: ReactNode;
  pendingLabel: ReactNode;
  tone: 'primary' | 'danger';
}) {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  return (
    <ConfirmAction
      action={action}
      triggerLabel={triggerLabel}
      triggerTone={triggerTone}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      pendingLabel={pendingLabel}
      tone={tone}
      fields={fields}
      onSuccess={() => setReason('')}
    >
      <div className="console-field">
        <label htmlFor={reasonId} className="console-label">
          Why? A short note for the history
        </label>
        <textarea
          id={reasonId}
          name="reason"
          className="console-input"
          rows={2}
          maxLength={500}
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </ConfirmAction>
  );
}

/**
 * Retire, after a confirm dialog that asks why. Nothing is deleted: the
 * database keeps the history, and a retired id is never reused.
 */
export function RetireButton({
  type,
  id,
  lessonId,
  what,
  description,
  triggerLabel,
}: {
  type: 'unit' | 'lesson' | 'item' | 'exercise';
  id: string;
  /** The lesson page to refresh, when the target belongs to one. */
  lessonId?: string;
  /** "this phrase", "Unit 2" */
  what: string;
  description?: ReactNode;
  triggerLabel?: ReactNode;
}) {
  const fields: Record<string, string> = { type, id };
  if (lessonId) fields.lesson_id = lessonId;
  return (
    <ReasonDialog
      action={retireContent}
      fields={fields}
      triggerLabel={
        triggerLabel ?? (
          <>
            Retire<span className="editor-visually-hidden"> {what}</span>
          </>
        )
      }
      title={`Retire ${what}?`}
      description={
        description ??
        'It leaves the lesson for good. Nothing is deleted: its history stays, and its id is never used again.'
      }
      confirmLabel="Retire"
      pendingLabel="Retiring…"
      tone="danger"
    />
  );
}

/**
 * Admin only: open something to learners, or hold it back. Opening a
 * variety needs an active reviewer for it; the database refuses otherwise.
 */
export function GateControl({
  type,
  id,
  gate,
  name,
  lessonId,
}: {
  type: 'variety' | 'unit' | 'lesson';
  id: string;
  gate: Gate;
  /** "Unit 2", "Yusufzai" */
  name: string;
  lessonId?: string;
}) {
  const opening = gate === 'blocked';
  const fields: Record<string, string> = {
    type,
    id,
    gate: opening ? 'open' : 'blocked',
  };
  if (lessonId) fields.lesson_id = lessonId;
  return (
    <ReasonDialog
      action={setPublishGate}
      fields={fields}
      triggerLabel={
        <>
          {opening ? 'Open' : 'Hold back'}
          <span className="editor-visually-hidden"> {name}</span>
          {opening ? ' to learners' : ''}
        </>
      }
      title={opening ? `Open ${name} to learners?` : `Hold back ${name}?`}
      description={
        opening
          ? 'Its reviewed lessons go out with the next release. Anything not reviewed yet stays out.'
          : 'It stays out of the next release, and anything of it that is live now leaves learners then.'
      }
      confirmLabel={opening ? 'Open to learners' : 'Hold back'}
      pendingLabel="Saving…"
      tone="primary"
    />
  );
}
