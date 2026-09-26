'use client';
import { UserPlus } from 'lucide-react';
import { startTransition, useActionState, useId, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { ActionResult } from '@/lib/console/action-result';
import {
  DEFAULT_EXPIRY_DAYS,
  EXPIRY_CHOICES,
  type InviteRole,
} from '@/lib/console/invite-link';
import { Notice } from '../notice';
import { SubmitButton } from '../submit-button';
import { InviteLinkPanel } from './invite-link-panel';
import type { CreatedInvitation, LanguageOption } from './types';

type CreateAction = (
  previous: ActionResult<CreatedInvitation> | null,
  formData: FormData,
) => Promise<ActionResult<CreatedInvitation>>;

const ROLES: { value: InviteRole; label: string; hint: string }[] = [
  {
    value: 'language_reviewer',
    label: 'Reviewer',
    hint: 'A native speaker who checks one variety',
  },
  {
    value: 'editor',
    label: 'Editor',
    hint: 'Writes lessons in one language, or all',
  },
  {
    value: 'admin',
    label: 'Admin',
    hint: 'Runs the team and publishes',
  },
];

/**
 * "Invite someone": a dialog with the invitation form, then the one-time
 * link to copy or share on WhatsApp. Closing it and opening it again starts
 * a fresh invitation.
 */
export function InviteDialog({
  action,
  languages,
  minEndDate,
}: {
  action: CreateAction;
  languages: LanguageOption[];
  /** YYYY-MM-DD: the earliest day a role can be set to end. */
  minEndDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setRound((r) => r + 1);
      }}
    >
      <DialogTrigger className="console-button console-button-primary">
        <UserPlus aria-hidden="true" size={18} />
        Invite someone
      </DialogTrigger>
      <DialogContent className="invite-dialog">
        <InviteFlow
          key={round}
          action={action}
          languages={languages}
          minEndDate={minEndDate}
          onDone={() => setOpen(false)}
          onAgain={() => setRound((r) => r + 1)}
        />
      </DialogContent>
    </Dialog>
  );
}

function InviteFlow({
  action,
  languages,
  minEndDate,
  onDone,
  onAgain,
}: {
  action: CreateAction;
  languages: LanguageOption[];
  minEndDate: string;
  onDone: () => void;
  onAgain: () => void;
}) {
  const [result, formAction, pending] = useActionState(action, null);
  if (result?.ok)
    return (
      <InviteLinkPanel
        invitation={result.data}
        onDone={onDone}
        onAgain={onAgain}
      />
    );
  return (
    <InviteForm
      formAction={formAction}
      pending={pending}
      languages={languages}
      minEndDate={minEndDate}
      error={result && !result.ok ? result : null}
    />
  );
}

function InviteForm({
  formAction,
  pending,
  languages,
  minEndDate,
  error,
}: {
  formAction: (formData: FormData) => void;
  pending: boolean;
  languages: LanguageOption[];
  minEndDate: string;
  error: { code: string; message: string } | null;
}) {
  const id = useId();
  const [role, setRole] = useState<InviteRole>('language_reviewer');
  // Every field is held here. The form is submitted from onSubmit rather
  // than through <form action>, which React resets once the action returns:
  // a refusal must leave what the admin typed and chose exactly as it was.
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [expiry, setExpiry] = useState(String(DEFAULT_EXPIRY_DAYS));
  const [endsOn, setEndsOn] = useState('');
  const firstWithVarieties =
    languages.find((l) => l.varieties.length > 0)?.code ?? '';
  const [language, setLanguage] = useState(firstWithVarieties);
  // A reviewer always has a language; an editor may have none (all).
  const effectiveLanguage =
    role === 'language_reviewer' && !language ? firstWithVarieties : language;
  const current = languages.find((l) => l.code === effectiveLanguage);
  const varieties = current?.varieties ?? [];
  const [variety, setVariety] = useState(varieties[0]?.id ?? '');
  const chosenVariety =
    varieties.find((v) => v.id === variety)?.id ?? varieties[0]?.id ?? '';
  const needsLanguage = role !== 'admin';
  const needsVariety = role === 'language_reviewer';
  const noVarieties = needsVariety && varieties.length === 0;

  return (
    <form
      className="console-form invite-form"
      aria-busy={pending || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <DialogHeader>
        <DialogTitle className="invite-dialog-title">
          Invite someone to the team
        </DialogTitle>
        <DialogDescription className="invite-dialog-description">
          You&apos;ll get a private link to send them. It works once, for their
          email address only.
        </DialogDescription>
      </DialogHeader>

      <fieldset className="console-choices invite-roles">
        <legend className="console-label">Role</legend>
        {ROLES.map((r) => (
          <label key={r.value} className="console-choice invite-role">
            <input
              type="radio"
              name="role"
              value={r.value}
              checked={role === r.value}
              onChange={() => setRole(r.value)}
            />
            <span className="invite-role-text">
              {r.label}
              <small>{r.hint}</small>
            </span>
          </label>
        ))}
      </fieldset>

      {needsLanguage && (
        <div className="invite-scope">
          <div className="console-field">
            <label htmlFor={`${id}-language`} className="console-label">
              Language
            </label>
            <select
              id={`${id}-language`}
              name="language"
              className="console-input"
              value={effectiveLanguage}
              onChange={(event) => {
                setLanguage(event.target.value);
                const next = languages.find(
                  (l) => l.code === event.target.value,
                );
                setVariety(next?.varieties[0]?.id ?? '');
              }}
              required={needsVariety}
            >
              {role === 'editor' && <option value="">All languages</option>}
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
            <input
              type="hidden"
              name="language_name"
              value={current?.name ?? ''}
            />
          </div>
          {needsVariety && (
            <div className="console-field">
              <label htmlFor={`${id}-variety`} className="console-label">
                Variety they review
              </label>
              <select
                id={`${id}-variety`}
                name="variety"
                className="console-input"
                value={chosenVariety}
                onChange={(event) => setVariety(event.target.value)}
                required
                disabled={noVarieties}
                aria-describedby={`${id}-variety-hint`}
              >
                {varieties.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <input
                type="hidden"
                name="variety_name"
                value={
                  varieties.find((v) => v.id === chosenVariety)?.name ?? ''
                }
              />
              <p id={`${id}-variety-hint`} className="console-hint">
                {noVarieties
                  ? 'This language has no varieties yet.'
                  : 'Reviewers approve phrases in this variety only.'}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="console-field">
        <label htmlFor={`${id}-email`} className="console-label">
          Their email address
        </label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="console-input"
          aria-describedby={`${id}-email-hint`}
          placeholder="name@example.com"
        />
        <p id={`${id}-email-hint`} className="console-hint">
          They sign in with this address to accept.
        </p>
      </div>

      <div className="console-field">
        <label htmlFor={`${id}-name`} className="console-label">
          Their name <span className="invite-optional">(optional)</span>
        </label>
        <input
          id={`${id}-name`}
          name="display_name"
          type="text"
          autoComplete="off"
          maxLength={60}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="console-input"
          aria-describedby={`${id}-name-hint`}
        />
        <p id={`${id}-name-hint`} className="console-hint">
          We greet them by it and show it to the team.
        </p>
      </div>

      <div className="invite-scope">
        <div className="console-field">
          <label htmlFor={`${id}-expiry`} className="console-label">
            Link works for
          </label>
          <select
            id={`${id}-expiry`}
            name="expires_in_days"
            className="console-input"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          >
            {EXPIRY_CHOICES.map((days) => (
              <option key={days} value={days}>
                {days === 1 ? '1 day' : `${days} days`}
              </option>
            ))}
          </select>
        </div>
        <div className="console-field">
          <label htmlFor={`${id}-ends`} className="console-label">
            Role ends <span className="invite-optional">(optional)</span>
          </label>
          <input
            id={`${id}-ends`}
            name="grant_ends_on"
            type="date"
            min={minEndDate}
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
            className="console-input"
            aria-describedby={`${id}-ends-hint`}
          />
          <p id={`${id}-ends-hint`} className="console-hint">
            Leave empty to keep it until you end it.
          </p>
        </div>
      </div>

      {error && (
        <Notice tone="error" code={error.code}>
          {error.message}
        </Notice>
      )}

      <div className="console-actions invite-form-actions">
        <SubmitButton disabled={noVarieties || pending}>
          {pending ? 'Creating the link…' : 'Create invitation link'}
        </SubmitButton>
      </div>
    </form>
  );
}
