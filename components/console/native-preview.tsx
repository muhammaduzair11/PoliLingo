import { NativeText } from '../native';

/**
 * A phrase as a learner sees it on a study card: the native text in the
 * learner's type, its romanisation beneath, and optionally its meaning.
 * Uses the learner styles (.phrase), so a reviewer judges the real thing.
 */
export function NativePreview({
  native,
  romanisation,
  meaning,
  lang,
  dir,
  large = true,
  showRomanisation = true,
}: {
  native: string;
  romanisation?: string | null;
  meaning?: string | null;
  lang: string;
  dir: 'rtl' | 'ltr';
  large?: boolean;
  showRomanisation?: boolean;
}) {
  return (
    <figure className="native-preview">
      <span className={`phrase${large ? ' phrase-large' : ''}`}>
        <NativeText text={native} lang={lang} dir={dir} />
        {showRomanisation && romanisation && (
          <span className="roman" dir="ltr">
            {romanisation}
          </span>
        )}
      </span>
      {meaning && (
        <figcaption className="native-preview-meaning">{meaning}</figcaption>
      )}
    </figure>
  );
}
