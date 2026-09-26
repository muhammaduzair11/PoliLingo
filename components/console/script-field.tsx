'use client';
import { useId, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  checkNative,
  checkRomanisation,
  normaliseNative,
  type ScriptIssue,
} from '@/lib/script-check';

/**
 * A native-text or romanisation input that checks the text as it is typed,
 * with the same rules the database applies before it stores an item
 * (lib/script-check.ts). Native text is checked as the database will store
 * it, normalised; problems name the character and where it is.
 *
 * Uncontrolled from the form's point of view: it submits under `name` like
 * any input. `onValueChange` hears every change with its problems.
 */
export function ScriptField({
  name,
  label,
  language,
  dir = 'rtl',
  kind,
  defaultValue = '',
  multiline = false,
  required = false,
  maxLength = 300,
  hint,
  disabled,
  onValueChange,
}: {
  name: string;
  label: ReactNode;
  /** ps, ur, hno: picks the character list and the `lang` attribute. */
  language: string;
  /** The language's writing direction, for native text. */
  dir?: 'rtl' | 'ltr';
  kind: 'native' | 'romanisation';
  defaultValue?: string;
  multiline?: boolean;
  required?: boolean;
  maxLength?: number;
  hint?: ReactNode;
  disabled?: boolean;
  onValueChange?: (value: string, issues: ScriptIssue[]) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const issues = issuesFor(kind, language, value);
  const errors = issues.some((i) => i.severity === 'error');
  const describedBy =
    [hint ? `${id}-hint` : '', issues.length ? `${id}-issues` : '']
      .filter(Boolean)
      .join(' ') || undefined;
  const inputProps = {
    id,
    name,
    value,
    required,
    maxLength,
    disabled,
    lang: kind === 'native' ? language : `${language}-Latn`,
    dir: kind === 'native' ? dir : ('ltr' as const),
    spellCheck: kind !== 'native',
    autoComplete: 'off',
    'aria-invalid': errors || undefined,
    'aria-describedby': describedBy,
    className: `console-input script-field-input script-field-${kind}`,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = event.target.value;
      setValue(next);
      onValueChange?.(next, issuesFor(kind, language, next));
    },
  };
  return (
    <div className="console-field script-field">
      <label htmlFor={id} className="console-label">
        {label}
      </label>
      {multiline ? (
        <textarea rows={2} {...inputProps} />
      ) : (
        <input type="text" {...inputProps} />
      )}
      {hint && (
        <p id={`${id}-hint`} className="console-hint">
          {hint}
        </p>
      )}
      <ul id={`${id}-issues`} className="script-issues" aria-live="polite">
        {issues.map((issue) => (
          <li
            key={`${issue.code}-${issue.position ?? ''}`}
            className={`script-issue script-issue-${issue.severity}`}
          >
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function issuesFor(
  kind: 'native' | 'romanisation',
  language: string,
  value: string,
): ScriptIssue[] {
  if (value.trim() === '') return [];
  return kind === 'native'
    ? checkNative(language, normaliseNative(value))
    : checkRomanisation(value);
}
