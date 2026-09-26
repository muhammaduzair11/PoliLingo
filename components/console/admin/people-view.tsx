import type { ActionResult } from '@/lib/console/action-result';
import {
  formatDay,
  grantWindowLabel,
  latestEndDate,
  roleLabel,
  scopeLabel,
} from '@/lib/console/invite-link';
import { ConfirmAction } from '../confirm-action';
import { DataTable } from '../data-table';
import { EmptyState } from '../empty-state';
import { Stat, StatGrid } from '../stat';
import { EndWhenFields } from './end-when-fields';
import type { Grant, OpenInvitation, PeoplePage, Person } from './types';

type FormAction<T> = (
  previous: ActionResult<T> | null,
  formData: FormData,
) => Promise<ActionResult<T>>;

const STATUS_LABELS: Record<Person['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  ended: 'Left',
};

function roleWithScope(grant: {
  role: Grant['role'];
  language_name: string | null;
  variety_name: string | null;
}): string {
  return `${roleLabel(grant.role)} · ${scopeLabel(grant)}`;
}

/** The people page: the team with their roles, and invitations still waiting. */
export function PeopleView({
  page,
  minEndDate,
  revokeRole,
  revokeInvitation,
}: {
  page: PeoplePage;
  minEndDate: string;
  revokeRole: FormAction<{ ends_at: string }>;
  revokeInvitation: FormAction<unknown>;
}) {
  const current = (p: Person) => p.grants.filter((g) => g.state !== 'ended');
  const active = page.people.filter(
    (p) => p.status === 'active' && current(p).length > 0,
  );
  const reviewers = active.filter((p) =>
    current(p).some((g) => g.role === 'language_reviewer'),
  );
  const waiting = page.invitations.filter((i) => i.state === 'open');
  const expired = page.invitations.filter((i) => i.state === 'expired').length;
  const invalid = page.invitations.filter((i) => i.state === 'void').length;
  const notWaiting = [
    expired > 0 ? `${expired} expired` : '',
    invalid > 0 ? `${invalid} no longer valid` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="people-page">
      <StatGrid>
        <Stat label="On the team now" value={active.length} />
        <Stat label="Reviewers" value={reviewers.length} />
        <Stat
          label="Invitations waiting"
          value={waiting.length}
          hint={notWaiting || undefined}
        />
      </StatGrid>

      <section className="people-section" aria-labelledby="people-team">
        <h2 id="people-team" className="people-heading">
          Team
        </h2>
        <DataTable
          rows={page.people}
          rowKey={(p) => p.id}
          empty={
            <EmptyState title="No one here yet">
              <p>Invite a reviewer or an editor to get started.</p>
            </EmptyState>
          }
          columns={[
            {
              key: 'person',
              header: 'Person',
              cell: (p) => <PersonCell person={p} me={page.me} />,
            },
            {
              key: 'roles',
              header: 'Roles',
              cell: (p) => (
                <RolesCell
                  person={p}
                  minEndDate={minEndDate}
                  revokeRole={revokeRole}
                />
              ),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (p) => (
                <span className={`people-status people-status-${p.status}`}>
                  {p.has_account ? STATUS_LABELS[p.status] : 'Account deleted'}
                </span>
              ),
            },
            {
              key: 'seen',
              header: 'Last signed in',
              hideOnMobile: true,
              cell: (p) =>
                p.last_sign_in_at ? (
                  formatDay(p.last_sign_in_at)
                ) : (
                  <span className="people-muted">Not yet</span>
                ),
            },
          ]}
        />
      </section>

      <section className="people-section" aria-labelledby="people-invitations">
        <h2 id="people-invitations" className="people-heading">
          Invitations waiting
        </h2>
        <p className="console-hint people-lead">
          Links are shown only once, when you create them. If one was lost,
          cancel it and send a new invitation.
        </p>
        <DataTable
          rows={page.invitations}
          rowKey={(i) => i.id}
          empty={
            <EmptyState title="No invitations waiting">
              <p>Invite someone and their link waits here until they accept.</p>
            </EmptyState>
          }
          columns={[
            {
              key: 'who',
              header: 'Invited',
              cell: (i) => (
                <span className="people-person">
                  <span className="people-name">
                    {i.display_name || i.email}
                  </span>
                  {i.display_name && (
                    <span className="people-email">{i.email}</span>
                  )}
                </span>
              ),
            },
            {
              key: 'role',
              header: 'Role',
              cell: (i) => roleWithScope(i),
            },
            {
              key: 'sent',
              header: 'Sent',
              hideOnMobile: true,
              cell: (i) => (
                <span className="people-person">
                  <span>{formatDay(i.created_at)}</span>
                  {i.created_by_name && (
                    <span className="people-email">by {i.created_by_name}</span>
                  )}
                </span>
              ),
            },
            {
              key: 'expires',
              header: 'Expires',
              cell: (i) =>
                i.state === 'expired' ? (
                  <span className="people-status people-status-ended">
                    Expired {formatDay(i.expires_at)}
                  </span>
                ) : i.state === 'void' ? (
                  <span className="people-person">
                    <span className="people-status people-status-ended">
                      No longer valid
                    </span>
                    <span className="people-email">
                      The sender isn&apos;t an admin now
                    </span>
                  </span>
                ) : (
                  formatDay(i.expires_at)
                ),
            },
            {
              key: 'actions',
              header: 'Actions',
              cell: (i) => (
                <InvitationActions
                  invitation={i}
                  revokeInvitation={revokeInvitation}
                />
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}

function PersonCell({ person, me }: { person: Person; me: string | null }) {
  const contact = person.private;
  return (
    <span className="people-person">
      <span className="people-name">
        {person.display_name}
        {person.id === me && <span className="people-you">You</span>}
      </span>
      {person.email && <span className="people-email">{person.email}</span>}
      <span className="people-meta">
        <code>{person.id}</code>
        {contact?.region && <span>{contact.region}</span>}
        {contact?.whatsapp && <span>WhatsApp {contact.whatsapp}</span>}
      </span>
    </span>
  );
}

function RolesCell({
  person,
  minEndDate,
  revokeRole,
}: {
  person: Person;
  minEndDate: string;
  revokeRole: FormAction<{ ends_at: string }>;
}) {
  const current = person.grants.filter((g) => g.state !== 'ended');
  const past = person.grants.filter((g) => g.state === 'ended');
  return (
    <div className="people-roles">
      {current.length === 0 && (
        <span className="people-muted">No current role</span>
      )}
      {current.length > 0 && (
        <ul className="people-grants">
          {current.map((g) => {
            // Ending brings a role's end forward, never later.
            const maxDate = latestEndDate(g.ends_at);
            return (
              <li key={g.id} className={`people-grant people-grant-${g.state}`}>
                <span className="people-grant-text">
                  <span className="people-grant-role">{roleWithScope(g)}</span>
                  <span className="people-grant-when">
                    {grantWindowLabel(g)}
                  </span>
                </span>
                <ConfirmAction
                  action={revokeRole}
                  triggerLabel={g.ends_at ? 'End sooner' : 'End role'}
                  triggerTone="quiet"
                  title={`End ${person.display_name}’s ${roleLabel(g.role).toLowerCase()} role${g.ends_at ? ' sooner' : ''}?`}
                  description={endDescription(g)}
                  confirmLabel="End role"
                  cancelLabel="Keep it"
                  pendingLabel="Ending…"
                  tone="danger"
                  fields={{ grant_id: g.id }}
                  successMessage="Done. The role's end is saved."
                >
                  <EndWhenFields minDate={minEndDate} maxDate={maxDate} />
                </ConfirmAction>
              </li>
            );
          })}
        </ul>
      )}
      {past.length > 0 && (
        <details className="people-past">
          <summary>
            {past.length === 1 ? '1 past role' : `${past.length} past roles`}
          </summary>
          <ul className="people-grants">
            {past.map((g) => (
              <li key={g.id} className="people-grant people-grant-ended">
                <span className="people-grant-text">
                  <span className="people-grant-role">{roleWithScope(g)}</span>
                  <span className="people-grant-when">
                    {formatDay(g.starts_at)} – {formatDay(g.ends_at)}
                    {g.revoke_reason ? ` · ${g.revoke_reason}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function endDescription(g: Grant): string {
  const what =
    g.role === 'language_reviewer'
      ? `They won't be able to review ${scopeLabel(g)} any more.`
      : g.role === 'editor'
        ? `They won't be able to edit ${g.language_name ?? 'lessons'} any more.`
        : 'They lose admin access to the workspace.';
  const already = g.ends_at
    ? ` It's set to end on ${formatDay(g.ends_at)}; you can bring that forward.`
    : '';
  return `${what}${already} Everything they did stays in the history, under their name.`;
}

function InvitationActions({
  invitation,
  revokeInvitation,
}: {
  invitation: OpenInvitation;
  revokeInvitation: FormAction<unknown>;
}) {
  return (
    <ConfirmAction
      action={revokeInvitation}
      triggerLabel="Cancel"
      triggerTone="quiet"
      title="Cancel this invitation?"
      description={`The link sent to ${invitation.email} stops working straight away. You can always invite them again.`}
      confirmLabel="Cancel invitation"
      cancelLabel="Keep it"
      pendingLabel="Cancelling…"
      tone="danger"
      fields={{ invitation_id: invitation.id }}
    />
  );
}
