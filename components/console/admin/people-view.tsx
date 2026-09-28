import Link from 'next/link';
import type { ActionResult } from '@/lib/console/action-result';
import {
  formatDay,
  formatPktDateTime,
  formatPktDay,
  grantWindowLabel,
  inviteDeepLink,
  latestEndDate,
  roleLabel,
  scopeLabel,
} from '@/lib/console/invite-link';
import { ConfirmAction } from '../confirm-action';
import { DataTable, type Column } from '../data-table';
import { EmptyState } from '../empty-state';
import { Stat, StatGrid } from '../stat';
import { EndRoleAction } from './end-role-action';
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

const TEAM_HEADING = 'people-team';
const INVITATIONS_HEADING = 'people-invitations';

function roleWithScope(grant: {
  role: Grant['role'];
  language_name: string | null;
  variety_name: string | null;
}): string {
  return `${roleLabel(grant.role)} · ${scopeLabel(grant)}`;
}

const currentGrants = (p: Person) =>
  p.grants.filter((g) => g.state !== 'ended');

/**
 * What the status pill says. A person with no role left is "No role", not
 * a green "Active": their account is active, but they aren't on the team.
 */
function statusOf(p: Person): { label: string; tone: string } {
  if (!p.has_account) return { label: 'Account deleted', tone: 'ended' };
  if (currentGrants(p).length === 0) return { label: 'No role', tone: 'ended' };
  return { label: STATUS_LABELS[p.status], tone: p.status };
}

function StatusPill({
  person,
  className,
}: {
  person: Person;
  className?: string;
}) {
  const status = statusOf(person);
  return (
    <span
      className={`people-status people-status-${status.tone}${className ? ` ${className}` : ''}`}
    >
      {status.label}
    </span>
  );
}

/**
 * The one open-ended admin grant, when there is exactly one: ending it
 * would leave the workspace without an admin, so it offers inviting
 * another admin instead. (revoke_role refuses it anyway.)
 */
function soleAdminGrant(people: Person[]): string | null {
  const open = people.flatMap((p) =>
    p.grants.filter(
      (g) => g.role === 'admin' && g.state !== 'ended' && !g.ends_at,
    ),
  );
  return open.length === 1 ? open[0].id : null;
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
  // Current members first; people whose roles have all ended fold away.
  const members = page.people.filter((p) => currentGrants(p).length > 0);
  const former = page.people.filter((p) => currentGrants(p).length === 0);
  const active = members.filter((p) => p.status === 'active');
  const reviewers = active.filter((p) =>
    currentGrants(p).some((g) => g.role === 'language_reviewer'),
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
  const soleAdmin = soleAdminGrant(page.people);

  const columns: Column<Person>[] = [
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
          self={p.id === page.me}
          soleAdmin={soleAdmin}
          minEndDate={minEndDate}
          revokeRole={revokeRole}
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      // On phones the pill sits beside the name instead.
      hideOnMobile: true,
      cell: (p) => <StatusPill person={p} />,
    },
    {
      key: 'seen',
      header: 'Last signed in',
      hideOnMobile: true,
      cell: (p) =>
        p.last_sign_in_at ? (
          <time
            dateTime={p.last_sign_in_at}
            title={formatPktDateTime(p.last_sign_in_at)}
          >
            {formatPktDay(p.last_sign_in_at)}
          </time>
        ) : (
          <span className="people-muted">Not yet</span>
        ),
    },
  ];

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

      <section className="people-section" aria-labelledby={TEAM_HEADING}>
        <h2 id={TEAM_HEADING} className="people-heading" tabIndex={-1}>
          Team
        </h2>
        <DataTable
          className="people-table"
          rows={members}
          rowKey={(p) => p.id}
          empty={
            <EmptyState title="No one here yet">
              <p>Invite a reviewer or an editor to get started.</p>
            </EmptyState>
          }
          columns={columns}
        />
        {former.length > 0 && (
          <details className="people-former">
            <summary>Former team members ({former.length})</summary>
            <DataTable
              className="people-table"
              rows={former}
              rowKey={(p) => p.id}
              columns={columns}
            />
          </details>
        )}
      </section>

      <section className="people-section" aria-labelledby={INVITATIONS_HEADING}>
        <h2 id={INVITATIONS_HEADING} className="people-heading" tabIndex={-1}>
          Invitations waiting
        </h2>
        <p className="console-hint people-lead">
          Links are shown only once, when you create them. If one was lost,
          cancel it and send a new invitation.
        </p>
        <DataTable
          className="people-invitations"
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
                    {i.display_name || (
                      <span className="people-email-text" title={i.email}>
                        {i.email}
                      </span>
                    )}
                  </span>
                  {i.display_name && (
                    <span className="people-email" title={i.email}>
                      {i.email}
                    </span>
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
                  <time
                    dateTime={i.created_at}
                    title={formatPktDateTime(i.created_at)}
                  >
                    {formatPktDay(i.created_at)}
                  </time>
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
                    Expired {formatPktDay(i.expires_at)}
                  </span>
                ) : i.state === 'void' ? (
                  <span className="people-person">
                    <span className="people-status people-status-ended">
                      No longer valid
                    </span>
                    <span className="people-email">
                      The sender isn’t an admin now
                    </span>
                  </span>
                ) : (
                  <time
                    dateTime={i.expires_at}
                    title={formatPktDateTime(i.expires_at)}
                  >
                    {formatPktDay(i.expires_at)}
                  </time>
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
      {/* The contributor id is for support, not for reading: on hover only. */}
      <span className="people-name" title={person.id}>
        {person.display_name}
        {person.id === me && <span className="people-you">You</span>}
        <StatusPill person={person} className="people-status-inline" />
      </span>
      {person.email && (
        <span className="people-email" title={person.email}>
          {person.email}
        </span>
      )}
      {(contact?.region || contact?.whatsapp) && (
        <span className="people-meta">
          {contact.region && <span>{contact.region}</span>}
          {contact.whatsapp && <span>WhatsApp {contact.whatsapp}</span>}
        </span>
      )}
    </span>
  );
}

function RolesCell({
  person,
  self,
  soleAdmin,
  minEndDate,
  revokeRole,
}: {
  person: Person;
  /** The row is the viewer's own: the dialog speaks to them. */
  self: boolean;
  /** The id of the only open-ended admin grant, if there is just one. */
  soleAdmin: string | null;
  minEndDate: string;
  revokeRole: FormAction<{ ends_at: string }>;
}) {
  const current = currentGrants(person);
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
                {g.id === soleAdmin ? (
                  <Link
                    className="people-only-admin"
                    href={inviteDeepLink('admin')}
                  >
                    Only admin: invite another admin first
                  </Link>
                ) : (
                  <EndRoleAction
                    grantId={g.id}
                    role={g.role}
                    who={self ? 'You' : person.display_name}
                    self={self}
                    hasEnd={Boolean(g.ends_at)}
                    title={`End ${self ? 'your' : `${person.display_name}’s`} ${roleLabel(g.role).toLowerCase()} role${g.ends_at ? ' sooner' : ''}?`}
                    description={endDescription(g, self)}
                    minDate={minEndDate}
                    maxDate={maxDate}
                    focusAfter={TEAM_HEADING}
                    action={revokeRole}
                  />
                )}
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

function endDescription(g: Grant, self: boolean): string {
  const they = self ? 'You' : 'They';
  const what =
    g.role === 'language_reviewer'
      ? `${they} won’t be able to review ${scopeLabel(g)} any more.`
      : g.role === 'editor'
        ? `${they} won’t be able to edit ${g.language_name ?? 'lessons'} any more.`
        : `${they} lose admin access to the workspace.`;
  const already = g.ends_at
    ? ` It’s set to end on ${formatDay(g.ends_at)}; you can bring that forward.`
    : '';
  const history = self
    ? 'Everything you did stays in the history, under your name.'
    : 'Everything they did stays in the history, under their name.';
  return `${what}${already} ${history}`;
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
      triggerLabel={
        <>
          Cancel
          <span className="sr-only"> the invitation to {invitation.email}</span>
        </>
      }
      triggerTone="quiet"
      title="Cancel this invitation?"
      description={`The link sent to ${invitation.email} stops working straight away. You can always invite them again.`}
      confirmLabel="Cancel invitation"
      cancelLabel="Keep it"
      pendingLabel="Cancelling…"
      tone="danger"
      fields={{ invitation_id: invitation.id }}
      announce={`Invitation to ${invitation.email} cancelled.`}
      focusAfter={INVITATIONS_HEADING}
    />
  );
}
