import type { GrantWindow, InviteRole } from '@/lib/console/invite-link';

/** page_admin_people(), as the database returns it. */
export type PeoplePage = {
  now: string;
  me: string | null;
  people: Person[];
  invitations: OpenInvitation[];
  languages: LanguageOption[];
};

export type Person = {
  id: string;
  display_name: string;
  attribution_name: string | null;
  status: 'active' | 'paused' | 'ended';
  created_at: string;
  has_account: boolean;
  email: string | null;
  age_band: '13-17' | '18+' | null;
  last_sign_in_at: string | null;
  private: {
    legal_name: string | null;
    contact_email: string | null;
    phone: string | null;
    whatsapp: string | null;
    region: string | null;
    engagement_ref: string | null;
    age_verified_note: string | null;
    notes: string | null;
  } | null;
  grants: Grant[];
};

export type Grant = GrantWindow & {
  id: string;
  role: InviteRole;
  language: string | null;
  language_name: string | null;
  variety: string | null;
  variety_name: string | null;
  granted_by: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
};

export type OpenInvitation = {
  id: string;
  role: InviteRole;
  language: string | null;
  language_name: string | null;
  variety: string | null;
  variety_name: string | null;
  email: string;
  display_name: string | null;
  note: string | null;
  created_at: string;
  created_by: string;
  created_by_name: string | null;
  expires_at: string;
  grant_ends_at: string | null;
  state: 'open' | 'expired';
};

export type LanguageOption = {
  code: string;
  name: string;
  varieties: { id: string; name: string }[];
};

/** What the invite action hands back: the one-time path, shown once. */
export type CreatedInvitation = {
  invitation_id: string;
  path: string;
  expires_at: string;
  role: InviteRole;
  email: string;
  display_name: string | null;
  language_name: string | null;
  variety_name: string | null;
};
