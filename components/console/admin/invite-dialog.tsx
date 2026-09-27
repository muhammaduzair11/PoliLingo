'use client';
import { UserPlus } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import {
  startTransition,
  useActionState,
  useId,
  useRef,
  useState,
} from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { ActionResult } from '@/lib/console/action-result';
import {
  DEFAULT_EXPIRY_DAYS,
  EXPIRY_CHOICES,
  formatDay,
  type InviteRole,
} from '@/lib/console/invite-link';
import { Notice } from '../notice';
import { SubmitButton } from '../submit-button';
import { InviteDialogHead } from './invite-dialog-head';
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
 *
 * The title and its close button stay at the top and the form's buttons
 * at the bottom; only the fields between them scroll, so "Create
 * invitation link" is always in reach, on a phone too.
 *
 * `initial` (from /admin/people?invite=…) opens it straight away on a role
 * and variety.
 */
export function InviteDialog({
  action,
  languages,
  minEndDate,
  initial = null,
}: {
  action: CreateAction;
  languages: LanguageOption[];
  /** YYYY-MM-DD: the earliest day a role can be set to end. */
  minEndDate: string;
  initial?: { role: InviteRole; variety: string | null } | null;
}) {
  const [open, setOpen] = useState(Boolean(initial));
  const [round, setRound] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) return;
        setRound((r) => r + 1);
        // Drop ?invite=… so a reload doesn't open the dialog again.
        if (initial) router.replace(pathname, { scroll: false });
      }}
    >
      <DialogTrigger className="console-button console-button-primary">
        <UserPlus aria-hidden="true" size={18} />
        Invite someone
      </DialogTrigger>
      <DialogContent className="invite-dialog" showCloseButton={false}>
        <InviteFlow
          key={round}
          action={action}
          languages={languages}
          minEndDate={minEndDate}
          initial={round === 0 ? initial : null}
          onDone={() => {
            setOpen(false);
            setRound((r) => r + 1);
            if (initial) router.replace(pathname, { scroll: false });
          }}
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
  initial,
  onDone,
  onAgain,
}: {
  action: CreateAction;
  languages: LanguageOption[];
  minEndDate: string;
  initial: { role: InviteRole; variety: string | null } | null;
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
      initial={initial}
      error={result && !result.ok ? result : null}
    />
  );
}

function InviteForm({
  formAction,
  pending,
  languages,
  minEndDate,
  initial,
  error,
}: {
  formAction: (formData: FormData) => void;
  pending: boolean;
  languages: LanguageOption[];
  minEndDate: string;
  initial: { role: InviteRole; variety: string | null } | null;
  error: { code: string; message: string } | null;
}) {
  const id = useId();
  const varietySelect = useRef<HTMLSelectElement>(null);
  const [role, setRole] = useState<InviteRole>(
    initial?.role ?? 'language_reviewer',
  );
  // Every field is held here. The form is submitted from onSubmit rather
  // than through <form action>, which React resets once the action returns:
  // a refusal must leave what the admin typed and chose exactly as it was.
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [expiry, setExpiry] = useState(String(DEFAULT_EXPIRY_DAYS));
  const [endsOn, setEndsOn] = useState('');
  const firstWithVarieties =
    languages.find((l) => l.varieties.length > 0)?.code ?? '';
  const initialLanguage = initial?.variety
    ? languages.find((l) => l.varieties.some((v) => v.id === initial.variety))
        ?.code
    : undefined;
  const [language, setLanguage] = useState(
    initialLanguage ?? firstWithVarieties,
  );
  // A reviewer always has a language; an editor may have none (all).
  const effectiveLanguage =
    role === 'language_reviewer' && !language ? firstWithVarieties : language;
  const current = languages.find((l) => l.code === effectiveLanguage);
  const varieties = current?.varieties ?? [];
  // With more than one variety the admin picks it: a reviewer invited to
  // the wrong variety can approve phrases they don't speak. A language
  // with just one starts on it.
  const [variety, setVariety] = useState(initial?.variety ?? '');
  const chosenVariety = varieties.some((v) => v.id === variety)
    ? variety
    : varieties.length === 1
      ? varieties[0].id
      : '';
  const [varietyMissing, setVarietyMissing] = useState(false);
  const needsLanguage = role !== 'admin';
  const needsVariety = role === 'language_reviewer';
  const noVarieties = needsVariety && varieties.length === 0;
  const missingVariety = needsVariety && !noVarieties && !chosenVariety;
  const roleHint = ROLES.find((r) => r.value === role)?.hint;
  const expiryLabel =
    expiry === '1' ? 'Link works 1 day' : `Link works ${expiry} days`;
  const endsLabel = endsOn ? `role ends ${formatDay(endsOn)}` : 'no end date';

  /** Stops a submit without a variety, with the reason beside the field. */
  function blockWithoutVariety(event: { preventDefault: () => void }) {
    if (!missingVariety) return false;
    event.preventDefault();
    setVarietyMissing(true);
    varietySelect.current?.focus();
    return true;
  }

  return (
    <form
      className="console-form invite-form"
      aria-busy={pending || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || blockWithoutVariety(event)) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <InviteDialogHead>
        <DialogTitle className="invite-dialog-title">
          Invite someone to the team
        </DialogTitle>
      </InviteDialogHead>

      <div className="invite-dialog-body">
        <DialogDescription className="invite-dialog-description">
          You’ll get a private link to send them. It works once, for their email
          address only.
        </DialogDescription>

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
                <small className="invite-role-hint">{r.hint}</small>
              </span>
            </label>
          ))}
          {/* Phones show the chosen role's hint once, under the row. */}
          <p className="console-hint invite-role-note" aria-hidden="true">
            {roleHint}
          </p>
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
                  setVariety('');
                  setVarietyMissing(false);
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
                  ref={varietySelect}
                  id={`${id}-variety`}
                  name="variety"
                  className="console-input"
                  value={chosenVariety}
                  onChange={(event) => {
                    setVariety(event.target.value);
                    setVarietyMissing(false);
                  }}
                  disabled={noVarieties}
                  aria-invalid={(varietyMissing && missingVariety) || undefined}
                  aria-describedby={`${id}-variety-hint`}
                >
                  {varieties.length > 1 && (
                    <option value="" disabled>
                      Choose a variety…
                    </option>
                  )}
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
                <p
                  id={`${id}-variety-hint`}
                  className={`console-hint${varietyMissing && missingVariety ? ' invite-field-error' : ''}`}
                  role={varietyMissing && missingVariety ? 'alert' : undefined}
                >
                  {noVarieties
                    ? 'This language has no varieties yet.'
                    : varietyMissing && missingVariety
                      ? 'Choose the variety they review before you create the link.'
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

        {/* The defaults suit nearly every invitation: fold them away. Folded
            fields still go with the form. */}
        <details className="invite-more">
          <summary>
            More options
            <span className="invite-more-now">
              {expiryLabel} · {endsLabel}
            </span>
          </summary>
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
                Leave empty to keep it until you end it. It ends as that day
                begins (UTC).
              </p>
            </div>
          </div>
        </details>

        {error && (
          <Notice tone="error" code={error.code}>
            {error.message}
          </Notice>
        )}
      </div>

      <div className="invite-dialog-foot">
        <DialogClose
          type="button"
          className="console-button console-button-outline"
        >
          Cancel
        </DialogClose>
        <SubmitButton
          disabled={noVarieties || pending}
          onClick={(event) => {
            blockWithoutVariety(event);
          }}
        >
          {pending ? 'Creating the link…' : 'Create invitation link'}
        </SubmitButton>
      </div>
    </form>
  );
}
