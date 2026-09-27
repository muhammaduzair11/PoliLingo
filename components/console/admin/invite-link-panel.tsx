'use client';
import { Check, Copy, MessageCircle } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  formatPktDay,
  inviteMessage,
  inviteUrl,
  roleLabel,
  scopeLabel,
  whatsAppShareUrl,
} from '@/lib/console/invite-link';
import { useAnnounce } from '../announcer';
import { Notice } from '../notice';
import { InviteDialogHead } from './invite-dialog-head';
import type { CreatedInvitation } from './types';

const noop = () => () => {};

/** This site's origin in the browser; empty during the server render. */
function useOrigin(): string {
  return useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => '',
  );
}

/**
 * The invitation just made: its one-time link to copy or share on
 * WhatsApp, and a plain word on how the link behaves. The link is shown
 * this once; the database keeps only its hash.
 *
 * Focus lands on Copy, the next thing to do, and the page's live region
 * says the link is ready (it stays there after the dialog closes).
 */
export function InviteLinkPanel({
  invitation,
  onDone,
  onAgain,
}: {
  invitation: CreatedInvitation;
  onDone: () => void;
  onAgain: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle');
  const origin = useOrigin();
  const announce = useAnnounce();
  const url = inviteUrl(invitation.path, origin) ?? '';
  const expires = formatPktDay(invitation.expires_at);
  const first = invitation.display_name?.trim().split(/\s+/)[0] ?? '';
  const message = url
    ? inviteMessage({
        role: invitation.role,
        language_name: invitation.language_name,
        variety_name: invitation.variety_name,
        url,
        name: invitation.display_name,
        email: invitation.email,
        expiresAt: invitation.expires_at,
      })
    : '';

  // Once, when the link is made: focus the next thing to do.
  useEffect(() => {
    copyButton.current?.focus();
  }, []);
  const who = invitation.display_name || invitation.email;
  useEffect(() => {
    announce(
      `Invitation link ready for ${who}. It’s listed under Invitations waiting.`,
    );
  }, [announce, who]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopy('copied');
    } catch {
      input.current?.select();
      setCopy('manual');
    }
  }

  return (
    <div className="invite-ready">
      <InviteDialogHead>
        <div className="invite-ready-heading">
          <span className="invite-ready-mark" aria-hidden="true">
            <Check size={20} strokeWidth={3} />
          </span>
          <DialogTitle className="invite-dialog-title">
            {first ? `Invitation ready for ${first}` : 'Invitation ready'}
          </DialogTitle>
        </div>
      </InviteDialogHead>

      <div className="invite-dialog-body">
        <DialogDescription className="invite-dialog-description invite-ready-who">
          <span className="invite-ready-email" title={invitation.email}>
            {invitation.email}
          </span>
          <span>
            {roleLabel(invitation.role)} ·{' '}
            {scopeLabel({
              role: invitation.role,
              language_name: invitation.language_name,
              variety_name: invitation.variety_name,
            })}
          </span>
        </DialogDescription>

        <div className="invite-share">
          <div className="console-field invite-link-field">
            <label htmlFor={`${id}-link`} className="console-label">
              Their private link
            </label>
            <div className="invite-link-row">
              <input
                ref={input}
                id={`${id}-link`}
                className="console-input invite-link-input"
                value={url}
                readOnly
                dir="ltr"
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
                aria-describedby={`${id}-rules`}
              />
              <button
                ref={copyButton}
                type="button"
                className="console-button console-button-outline"
                onClick={copyLink}
                disabled={!url}
              >
                {copy === 'copied' ? (
                  <Check aria-hidden="true" size={18} />
                ) : (
                  <Copy aria-hidden="true" size={18} />
                )}
                {copy === 'copied' ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <output className="invite-copy-status" aria-live="polite">
              {copy === 'copied'
                ? 'Link copied. Paste it into a message to them.'
                : copy === 'manual'
                  ? 'The link is selected: press Ctrl+C (or ⌘C) to copy it.'
                  : ''}
            </output>
          </div>

          <a
            className="console-button console-button-whatsapp"
            href={message ? whatsAppShareUrl(message) : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!message || undefined}
          >
            <MessageCircle aria-hidden="true" size={18} />
            Share on WhatsApp
          </a>
        </div>

        <Notice tone="info">
          <p id={`${id}-rules`}>
            The link works <strong>once</strong>, only for{' '}
            <strong className="invite-rules-email">{invitation.email}</strong>,
            and expires on <strong>{expires}</strong>. This is the only time
            it’s shown: if it gets lost, cancel the invitation and send a new
            one.
          </p>
        </Notice>
      </div>

      <div className="invite-dialog-foot">
        <button
          type="button"
          className="console-button console-button-quiet"
          onClick={onAgain}
        >
          Invite someone else
        </button>
        <button
          type="button"
          className="console-button console-button-primary"
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </div>
  );
}
