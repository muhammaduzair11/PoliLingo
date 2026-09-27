import { NativeText } from '@/components/native';
import type { Direction } from '@/lib/console/review';

/**
 * A phrase in a list: the native text in its own script, its romanisation
 * and meaning beneath. Compact, for queues and tables.
 */
export function PhraseSummary({
  native,
  romanisation,
  meaning,
  lang,
  dir,
}: {
  native: string;
  romanisation: string;
  meaning: string;
  lang: string;
  dir: Direction;
}) {
  return (
    <span className="review-phrase">
      <NativeText text={native} lang={lang} dir={dir} />
      <span className="review-phrase-roman" dir="ltr">
        {romanisation}
      </span>
      <span className="review-phrase-meaning">{meaning}</span>
    </span>
  );
}

/** A field value, in its script when it is native text; "(empty)" when blank. */
export function FieldValue({
  field,
  value,
  lang,
  dir,
}: {
  field: string;
  value: string | null;
  lang: string;
  dir: Direction;
}) {
  if (value === null || value === '')
    return <em className="review-empty">(empty)</em>;
  if (field === 'native')
    return <NativeText text={value} lang={lang} dir={dir} />;
  if (field === 'romanisation')
    return (
      <span lang={`${lang}-Latn`} dir="ltr">
        {value}
      </span>
    );
  return <span>{value}</span>;
}
