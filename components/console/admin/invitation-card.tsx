import { CheckCircle2, Mail } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  formatDay,
  inviteHeadline,
  roleDuties,
  roleLabel,
  scopeLabel,
  type InviteRefusal,
  type Scope,
} from '@/lib/console/invite-link';

/** peek_invitation(), as the database returns it. */
export type InvitationPeek = Scope & {
  language: string | null;
  variety: string | null;
  display_name: string | null;
  email_masked: string;
  email_matches: boolean;
  expires_at: string;
  grant_ends_at: string | null;
  accepted_by_you: boolean;
  status: 'open' | 'expired' | 'revoked' | 'used';
};

/** The invitation itself: who it is for, what it offers, until when. */
export function InvitationCard({
  invitation,
  children,
}: {
  invitation: InvitationPeek;
  /** The action area: Accept, or what to do instead. */
  children: ReactNode;
}) {
  const first = invitation.display_name?.trim().split(/\s+/)[0];
  return (
    <article className="invite-card" aria-labelledby="invite-title">
      <p className="console-eyebrow">PoliLingo team invitation</p>
      <h1 id="invite-title">{inviteHeadline(invitation)}</h1>
      <p className="invite-lead">
        {first ? `Salaam ${first}! ` : 'Salaam! '}
        PoliLingo teaches languages in small, playful lessons, and native
        speakers check every phrase before learners see it.
      </p>
      <ul className="invite-duties">
        {roleDuties(invitation).map((duty) => (
          <li key={duty}>
            <CheckCircle2 aria-hidden="true" size={18} />
            <span>{duty}</span>
          </li>
        ))}
      </ul>
      <dl className="invite-facts">
        <div>
          <dt>Role</dt>
          <dd>{roleLabel(invitation.role)}</dd>
        </div>
        <div>
          <dt>
            {invitation.role === 'language_reviewer' ? 'Variety' : 'Covers'}
          </dt>
          <dd>{scopeLabel(invitation)}</dd>
        </div>
        <div>
          <dt>For</dt>
          <dd>
            <Mail aria-hidden="true" size={15} /> {invitation.email_masked}
          </dd>
        </div>
        <div>
          <dt>Link expires</dt>
          <dd>{formatDay(invitation.expires_at)}</dd>
        </div>
        {invitation.grant_ends_at && (
          <div>
            <dt>Role until</dt>
            <dd>{formatDay(invitation.grant_ends_at)}</dd>
          </div>
        )}
      </dl>
      {children}
    </article>
  );
}

/** A refusal or a dead end: what happened, why, and the next step. */
export function InvitationProblem({
  refusal,
  code,
  action,
}: {
  refusal: InviteRefusal;
  code?: string;
  action?: ReactNode;
}) {
  return (
    <article
      className="invite-card invite-card-problem"
      aria-labelledby="invite-title"
    >
      <p className="console-eyebrow">PoliLingo team invitation</p>
      <h1 id="invite-title">{refusal.title}</h1>
      <p className="invite-lead">{refusal.message}</p>
      <p className="invite-next">{refusal.next}</p>
      {code && <small className="console-notice-code">Code: {code}</small>}
      <div className="console-actions">
        {action}
        <Link className="console-button console-button-quiet" href="/learn">
          Back to learning
        </Link>
      </div>
    </article>
  );
}
