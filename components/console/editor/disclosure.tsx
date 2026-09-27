'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * A button that shows a panel (a form, usually) in its place, with
 * aria-expanded and aria-controls. Opening moves focus to the panel’s first
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
  // Starts "closed", so a panel that opens on arrival (a new lesson’s
  // "Add a phrase") takes focus too.
  const wasOpen = useRef(false);
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

/**
 * After a card is retired, once the list no longer has it: say so, and put
 * focus on the Edit button of the card that took its place (or the one
 * before, or the list’s add button), since the button that had focus is gone.
 */
export function useRetiredFocus<T extends { id: string }>(list: readonly T[]) {
  const listRef = useRef<HTMLDivElement>(null);
  const [retired, setRetired] = useState<{
    id: string;
    index: number;
    message: string;
  } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    if (!retired || focused === retired.id) return;
    if (list.some((entry) => entry.id === retired.id)) return;
    const frame = requestAnimationFrame(() => {
      const root = listRef.current;
      const edits = root?.querySelectorAll<HTMLElement>('[data-card-edit]');
      const next =
        edits && edits.length > 0
          ? edits[Math.min(retired.index, edits.length - 1)]
          : root?.querySelector<HTMLElement>('.editor-disclosure > button');
      next?.focus();
      setFocused(retired.id);
    });
    return () => cancelAnimationFrame(frame);
  }, [list, retired, focused]);
  return {
    listRef,
    announcement: retired?.message ?? null,
    markRetired: (id: string, index: number, message: string) => {
      setFocused(null);
      setRetired({ id, index, message });
    },
    clear: () => setRetired(null),
  };
}
