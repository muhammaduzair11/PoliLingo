'use client';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { DialogClose } from '@/components/ui/dialog';

/**
 * The invite dialog's fixed top: its title and a close button, 44px on
 * every screen. It stays put while the fields under it scroll.
 */
export function InviteDialogHead({ children }: { children: ReactNode }) {
  return (
    <div className="invite-dialog-head">
      {children}
      <DialogClose className="invite-dialog-close" aria-label="Close">
        <X aria-hidden="true" size={20} />
      </DialogClose>
    </div>
  );
}
