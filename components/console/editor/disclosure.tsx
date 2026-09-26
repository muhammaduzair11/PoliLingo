'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * A button that shows a panel (a form, usually) in its place, with
 * aria-expanded and aria-controls. Opening moves focus to the panel's first
 * field; closing returns it to the button. Controlled by the parent, so a
 * successful save or Cancel can close it.
 */
export function Disclosure({
  label,
  open,
  onOpenChange,
  children,
  tone = 'outline',
  className,
}: {
  label: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  tone?: 'primary' | 'outline' | 'quiet';
  className?: string;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current)
      panel.current
        ?.querySelector<HTMLElement>(
          'input:not([type=hidden]), select, textarea',
        )
        ?.focus();
    if (!open && wasOpen.current) button.current?.focus();
    wasOpen.current = open;
  }, [open]);
  return (
    <div className={`editor-disclosure${className ? ` ${className}` : ''}`}>
      <button
        ref={button}
        type="button"
        className={`console-button console-button-${tone}`}
        aria-expanded={open}
        aria-controls={id}
        hidden={open}
        onClick={() => onOpenChange(true)}
      >
        {label}
      </button>
      <div
        id={id}
        ref={panel}
        hidden={!open}
        className="editor-disclosure-panel"
      >
        {open && children}
      </div>
    </div>
  );
}

const FIELD = 'input:not([type=hidden]):not(:disabled), select, textarea';

/**
 * Focus for an inline editor in a card: its first field when it opens, and
 * back to the Edit button when it closes (after Save or Cancel).
 */
export function useEditFocus(editing: boolean) {
  const containerRef = useRef<HTMLLIElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const was = useRef(editing);
  useEffect(() => {
    if (editing && !was.current)
      containerRef.current?.querySelector<HTMLElement>(FIELD)?.focus();
    if (!editing && was.current) triggerRef.current?.focus();
    was.current = editing;
  }, [editing]);
  return { containerRef, triggerRef };
}

/** Moves focus to the first field inside `ref` whenever `key` changes after the first render. */
export function useRefocus(key: number) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.querySelector<HTMLElement>(FIELD)?.focus();
  }, [key]);
  return ref;
}
