'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * While `dirty`, leaving the page asks first. The browser asks on a reload,
 * a closed tab or a full navigation (beforeunload). A link inside the app
 * would navigate on the client and skip that question, so while dirty such
 * a click becomes a full navigation instead, and the browser asks as usual.
 * Links within the page (#…) are left alone.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Safari before 17 and older Chrome only ask when returnValue is set.
      // oxlint-disable-next-line typescript/no-deprecated
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;
      if (
        (link.target && link.target !== '_self') ||
        link.hasAttribute('download')
      )
        return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(url.href);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);
}

/**
 * A form’s filled-in text fields as one string, to compare with how it
 * started. Empty fields are left out, so opening an optional section adds
 * nothing to compare.
 */
function snapshot(form: HTMLFormElement): string {
  return JSON.stringify(
    [...new FormData(form).entries()].filter(
      ([, value]) => typeof value === 'string' && value !== '',
    ),
  );
}

/**
 * Whether a form differs from how it was when it opened ("Unsaved
 * changes"), with the leave guard on while it does. Put `ref` and
 * `onChange` on the <form>; the form’s remount (a new key after a save)
 * starts it clean again.
 */
export function useDirtyForm() {
  const ref = useRef<HTMLFormElement>(null);
  const start = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (ref.current) start.current = snapshot(ref.current);
  }, []);
  const onChange = useCallback(() => {
    if (ref.current && start.current !== null)
      setDirty(snapshot(ref.current) !== start.current);
  }, []);
  useUnsavedGuard(dirty);
  return { ref, dirty, onChange };
}

/** The "Unsaved changes" note beside a form’s Save button. */
export function UnsavedNote({ dirty }: { dirty: boolean }) {
  return dirty ? (
    <output className="editor-unsaved">Unsaved changes</output>
  ) : null;
}
