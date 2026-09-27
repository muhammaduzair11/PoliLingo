import type { Direction, FieldChange } from '@/lib/console/review';
import { FieldValue } from './phrase';

/**
 * Before and after, side by side, one row per changed field. Under 580px
 * each row stacks, with "Now" and "Suggested" (or the given labels) on
 * each value.
 */
export function FieldDiff({
  changes,
  lang,
  dir,
  beforeLabel = 'Now',
  afterLabel = 'Suggested',
  caption,
}: {
  changes: FieldChange[];
  lang: string;
  dir: Direction;
  beforeLabel?: string;
  afterLabel?: string;
  caption?: string;
}) {
  if (changes.length === 0) return null;
  return (
    <table className="review-diff">
      {caption && (
        <caption className="review-visually-hidden">{caption}</caption>
      )}
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">{beforeLabel}</th>
          <th scope="col">{afterLabel}</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((change) => (
          <tr key={change.field}>
            <th scope="row">{change.label}</th>
            <td className="review-diff-before" data-label={beforeLabel}>
              <FieldValue
                field={change.field}
                value={change.before}
                lang={lang}
                dir={dir}
              />
            </td>
            <td className="review-diff-after" data-label={afterLabel}>
              <FieldValue
                field={change.field}
                value={change.after}
                lang={lang}
                dir={dir}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
