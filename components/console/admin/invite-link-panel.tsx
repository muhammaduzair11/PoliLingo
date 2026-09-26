'use client';
import { Check, Copy, MessageCircle } from 'lucide-react';
import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  formatDay,
  inviteMessage,
  inviteUrl,
  roleLabel,
  scopeLabel,
  whatsAppShareUrl,
} from '@/lib/console/invite-link';
import { Notice } from '../notice';
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
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle');
  const origin = useOrigin();
  const url = inviteUrl(invitation.path, origin) ?? '';
  const expires = formatDay(invitation.expires_at);
  const who = invitation.display_name || invitation.email;
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
      <div className="invite-ready-mark" aria-hidden="true">
        <Check size={22} strokeWidth={3} />
      </div>
      <DialogTitle className="invite-dialog-title">
        Invitation ready for {who}
      </DialogTitle>
      <DialogDescription className="invite-dialog-description">
        {roleLabel(invitation.role)} ·{' '}
        {scopeLabel({
          role: invitation.role,
          language_name: invitation.language_name,
          variety_name: invitation.variety_name,
        })}
      </DialogDescription>

      <div className="console-field">
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
            {copy === 'copied' ? 'Copied' : 'Copy'}
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

      <Notice tone="info">
        <p id={`${id}-rules`}>
          The link works <strong>once</strong>, only for{' '}
          <strong>{invitation.email}</strong>, and expires on{' '}
          <strong>{expires}</strong>. This is the only time it&apos;s shown: if
          it gets lost, cancel the invitation and send a new one.
        </p>
      </Notice>

      <div className="console-actions invite-form-actions">
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
