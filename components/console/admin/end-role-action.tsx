'use client';
import type { ActionResult } from '@/lib/console/action-result';
import { formatDay, roleLabel } from '@/lib/console/invite-link';
import { ConfirmAction } from '../confirm-action';
import { EndWhenFields } from './end-when-fields';
import type { Grant } from './types';

/** "a reviewer", "an editor", "an admin" */
function aRole(role: Grant['role']): string {
  const word = roleLabel(role).toLowerCase();
  return /^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`;
}

/**
 * What the live region says once a role's end is saved: "Sana is no
 * longer a reviewer." for now, "Sana’s reviewer role ends on 5 Oct 2026."
 * for a date.
 */
function endedSentence(
  who: string,
  role: Grant['role'],
  endsAt: string | null | undefined,
  self: boolean,
): string {
  const at = endsAt ? Date.parse(endsAt) : Number.NaN;
  // "Now" is the database's clock: allow for a browser a little behind it.
  // A chosen date is at least the start of tomorrow, hours away.
  if (!Number.isFinite(at) || at <= Date.now() + 5 * 60_000)
    return `${who} ${self ? 'are' : 'is'} no longer ${aRole(role)}.`;
  const whose = self ? 'Your' : `${who}’s`;
  return `${whose} ${roleLabel(role).toLowerCase()} role ends on ${formatDay(endsAt)}.`;
}

/**
 * The End role button and its dialog for one grant on the people page. A
 * client component so the outcome sentence can use what the action
 * returns (when the role ends); focus goes to the Team heading if the
 * button leaves the page.
 */
export function EndRoleAction({
  grantId,
  role,
  who,
  self,
  hasEnd,
  title,
  description,
  minDate,
  maxDate,
  focusAfter,
  action,
}: {
  grantId: string;
  role: Grant['role'];
  /** The person's name, or "You" on the viewer's own row. */
  who: string;
  self: boolean;
  /** The role already has an end date: this brings it forward. */
  hasEnd: boolean;
  title: string;
  description: string;
  minDate: string;
  maxDate: string | null;
  focusAfter: string;
  action: (
    previous: ActionResult<{ ends_at: string }> | null,
    formData: FormData,
  ) => Promise<ActionResult<{ ends_at: string }>>;
}) {
  return (
    <ConfirmAction
      action={action}
      triggerLabel={hasEnd ? 'End sooner' : 'End role'}
      triggerTone="quiet"
      title={title}
      description={description}
      confirmLabel="End role"
      cancelLabel="Keep it"
      pendingLabel="Ending…"
      tone="danger"
      fields={{ grant_id: grantId }}
      announce={(data) => endedSentence(who, role, data.ends_at, self)}
      focusAfter={focusAfter}
    >
      <EndWhenFields minDate={minDate} maxDate={maxDate} />
    </ConfirmAction>
  );
}
