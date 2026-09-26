import { NativePreview } from '@/components/console/native-preview';
import type { Direction } from '@/lib/console/review';

/**
 * The phrase the way a learner meets it on the lesson's study card: the
 * native text in the learner's type, the romanisation, the meaning, and
 * the usage note in small print. Context shows where the lesson's context
 * exercise would use it.
 */
export function LearnerPreview({
  native,
  romanisation,
  meaning,
  context,
  usageNote,
  lang,
  dir,
  learnerLabel,
}: {
  native: string;
  romanisation: string;
  meaning: string;
  context: string | null;
  usageNote: string | null;
  lang: string;
  dir: Direction;
  learnerLabel: string;
}) {
  return (
    <section className="review-preview" aria-labelledby="review-preview-title">
      <div className="review-preview-head">
        <h2 id="review-preview-title" className="review-section-title">
          What a learner sees
        </h2>
        <p className="review-preview-variety">{learnerLabel}</p>
      </div>
      <div className="review-preview-card">
        <NativePreview
          native={native}
          romanisation={romanisation}
          meaning={meaning}
          lang={lang}
          dir={dir}
        />
        {usageNote && <p className="review-preview-note">{usageNote}</p>}
      </div>
      {context && (
        <p className="review-preview-context">
          <span className="review-preview-context-label">In a situation:</span>{' '}
          {context}
        </p>
      )}
    </section>
  );
}
