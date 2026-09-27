'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  ArrowRight,
  Cloud,
  Download,
  LogOut,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { ConfirmAction } from '@/components/console/confirm-action';
import { Notice } from '@/components/console/notice';
import type { ActionResult } from '@/lib/console/action-result';
import { setAccount, useAccount } from '@/lib/account-store';
import { localDate } from '@/lib/progress';
import { SYNC_SENTENCE, SYNC_SHORT, sinceWords } from './sync-words';

export type AccountRole = { key: string; label: string };

type Props = {
  email: string | null;
  ageBand: '13-17' | '18+';
  roles: AccountRole[];
  /** The workspace page for the caller's roles, or null for a learner. */
  workspaceHref: string | null;
  /** Staff (or former staff) have a contributor record, which the delete dialog explains. */
  isContributor: boolean;
  /** Where they were going before the age question, if anywhere. */
  continueTo: string | null;
  exportMyData: () => Promise<ActionResult<unknown>>;
  deleteMyAccount: (
    previous: ActionResult<null> | null,
    formData: FormData,
  ) => Promise<ActionResult<null>>;
  signOutHere: () => Promise<ActionResult<null>>;
};

const BAND_LABELS = { '13-17': '13 to 17', '18+': '18 or over' } as const;

/**
 * /account for a signed-in person with a profile (docs/platform.md 4.8):
 * who they are, how saving is going, a copy of their data, signing out and
 * deleting the account. Local progress is never touched by any of it.
 */
export function AccountView(props: Props) {
  const [deleted, setDeleted] = useState(false);
  if (deleted) return <Farewell />;
  return (
    <div className="account-page section-wrap">
      <p className="eyebrow purple">YOUR ACCOUNT</p>
      <h1>Your progress, kept safe.</h1>
      <p className="lead">
        Signed in as <strong>{props.email ?? 'you'}</strong>. Everything you
        learn here is saved to your account and stays on this device too.
      </p>

      {props.continueTo && (
        <Notice tone="success" title="You’re all set">
          <p>
            <Link className="text-link" href={props.continueTo}>
              Carry on where you were <ArrowRight size={16} />
            </Link>
          </p>
        </Notice>
      )}

      <section className="account-card" aria-labelledby="account-about">
        <h2 id="account-about" className="account-card-title">
          <UserRound aria-hidden="true" /> About you
        </h2>
        <dl className="account-facts">
          <div>
            <dt>Email</dt>
            <dd className="account-email">{props.email ?? 'Not shared'}</dd>
          </div>
          <div>
            <dt>Age band</dt>
            <dd>{BAND_LABELS[props.ageBand]}</dd>
          </div>
          <div>
            <dt>Roles</dt>
            <dd>
              {props.roles.length === 0 ? (
                'Learner'
              ) : (
                <ul className="account-roles">
                  {props.roles.map((role) => (
                    <li key={role.key}>{role.label}</li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
        {props.workspaceHref && (
          <Link
            className="button button-small button-outline account-workspace"
            href={props.workspaceHref}
          >
            Open the workspace <ArrowRight size={16} />
          </Link>
        )}
      </section>

      <SyncCard />

      <section className="account-card" aria-labelledby="account-data">
        <h2 id="account-data" className="account-card-title">
          <ShieldCheck aria-hidden="true" /> Your data
        </h2>
        <div className="account-row">
          <p>
            Download a copy of your account as a JSON file: your email and how
            you sign in, your age band, your saved progress and any team roles.
          </p>
          <DownloadButton action={props.exportMyData} />
        </div>
        <div className="account-row">
          <p>
            Signing out keeps your progress on this device. Sign in again any
            time to carry on saving.
          </p>
          <SignOutButton action={props.signOutHere} />
        </div>
      </section>

      <section
        className="account-card account-danger"
        aria-labelledby="account-delete"
      >
        <h2 id="account-delete" className="account-card-title">
          <Trash2 aria-hidden="true" /> Delete your account
        </h2>
        <div className="account-row">
          <p>
            This removes your account and everything saved to it, for good. The
            progress on this device stays.
          </p>
          <ConfirmAction
            action={props.deleteMyAccount}
            triggerLabel="Delete my account"
            triggerTone="danger"
            tone="danger"
            title="Delete your account?"
            description="This can’t be undone. Here’s exactly what happens."
            confirmLabel="Delete my account"
            cancelLabel="Keep my account"
            pendingLabel="Deleting…"
            onSuccess={() => {
              setAccount({ status: 'anonymous' });
              setDeleted(true);
            }}
          >
            <div className="account-delete-list">
              <p className="account-delete-heading">Deleted for good</p>
              <ul>
                <li>Your sign-in and your email address</li>
                <li>Your age band</li>
                <li>
                  The progress saved to your account: lessons, streak days, XP
                  and your daily goal
                </li>
                {props.isContributor && (
                  <li>
                    Your team roles, any invitation you sent that nobody has
                    used yet, and your private contact details. Reviews and
                    edits you made stay in the lesson history under your
                    contributor number, without your email.
                  </li>
                )}
              </ul>
              <p className="account-delete-heading">Stays on this device</p>
              <ul>
                <li>
                  Your progress here, so you can keep learning without an
                  account
                </li>
              </ul>
            </div>
          </ConfirmAction>
        </div>
      </section>
    </div>
  );
}

/** How saving to the account is going, live from the account store. */
function SyncCard() {
  const account = useAccount();
  const known = account.status === 'signed-in';
  const since =
    known && account.sync === 'synced'
      ? sinceWords(account.lastSyncedAt)
      : null;
  return (
    <section className="account-card" aria-labelledby="account-sync">
      <h2 id="account-sync" className="account-card-title">
        <Cloud aria-hidden="true" /> Saving
      </h2>
      <output className="account-sync">
        <span
          className={`account-chip-dot account-chip-dot-${known ? account.sync : 'idle'}`}
          aria-hidden="true"
        />
        <span>
          <strong>{known ? SYNC_SHORT[account.sync] : 'Checking…'}</strong>
          {since ? ` · ${since}` : ''}
          <br />
          {known
            ? SYNC_SENTENCE[account.sync]
            : 'Your progress is safe on this device.'}
        </span>
      </output>
    </section>
  );
}

function DownloadButton({
  action,
}: {
  action: () => Promise<ActionResult<unknown>>;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    tone: 'success' | 'error';
    text: string;
    code?: string;
  } | null>(null);
  return (
    <div className="account-action">
      <button
        type="button"
        className="button button-small button-outline"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const data = await action();
            if (!data.ok) {
              setResult({ tone: 'error', text: data.message, code: data.code });
              return;
            }
            download(
              `polilingo-account-${localDate()}.json`,
              `${JSON.stringify(data.data, null, 2)}\n`,
            );
            // The page cannot tell whether the file was saved, so it does not say so.
            setResult({
              tone: 'success',
              text: 'Your file is downloading.',
            });
          })
        }
      >
        <Download size={16} /> {pending ? 'Preparing…' : 'Download my data'}
      </button>
      <div aria-live="polite">
        {result && (
          <Notice tone={result.tone} code={result.code}>
            {result.text}
          </Notice>
        )}
      </div>
    </div>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function SignOutButton({
  action,
}: {
  action: () => Promise<ActionResult<null>>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ text: string; code: string } | null>(
    null,
  );
  return (
    <div className="account-action">
      <button
        type="button"
        className="button button-small button-outline"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await action();
            // A full page load, so the app starts again without the session.
            if (result.ok) window.location.assign('/');
            else setError({ text: result.message, code: result.code });
          })
        }
      >
        <LogOut size={16} /> {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error && (
        <Notice tone="error" code={error.code}>
          {error.text}
        </Notice>
      )}
    </div>
  );
}

function Farewell() {
  return (
    <div className="account-page section-wrap">
      <section className="account-card account-farewell" aria-live="polite">
        <p className="eyebrow purple">ACCOUNT DELETED</p>
        <h1 tabIndex={-1} ref={(node) => node?.focus()}>
          Your account is gone.
        </h1>
        <p>
          Everything saved to it has been deleted. Your progress on this device
          is still here, and you can keep learning without an account.
        </p>
        {/* A full page load, so nothing of the old session stays in memory. */}
        <button
          type="button"
          className="button button-purple"
          onClick={() => window.location.assign('/learn')}
        >
          Keep learning <ArrowRight size={19} />
        </button>
      </section>
    </div>
  );
}
