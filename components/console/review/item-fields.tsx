import type { ItemPage } from '@/lib/console/review';
import { FieldValue } from './phrase';

const SOURCE_TYPES: Record<string, string> = {
  reviewer_attested: 'A reviewer vouches for it',
  community_attested: 'Checked with native speakers',
  published_work: 'From a published work',
  original: 'Written for PoliLingo',
};

/** Every learner-visible field of a phrase, and where it comes from. */
export function ItemFields({
  item,
  lang,
  dir,
}: {
  item: ItemPage['item'];
  lang: string;
  dir: ItemPage['language']['direction'];
}) {
  const rows: { key: string; label: string; value: string | null }[] = [
    { key: 'native', label: 'Native text', value: item.native },
    { key: 'romanisation', label: 'Romanisation', value: item.romanisation },
    { key: 'meaning', label: 'Meaning', value: item.meaning },
    { key: 'context', label: 'Context', value: item.context },
    { key: 'usage_note', label: 'Usage note', value: item.usage_note },
  ];
  return (
    <section className="review-card" aria-labelledby="review-fields-title">
      <h2 id="review-fields-title" className="review-section-title">
        The phrase, field by field
      </h2>
      <dl className="review-fields">
        {rows.map((row) => (
          <div key={row.key} className="review-field">
            <dt>{row.label}</dt>
            <dd className={row.key === 'native' ? 'review-field-native' : ''}>
              <FieldValue
                field={row.key}
                value={row.value}
                lang={lang}
                dir={dir}
              />
            </dd>
          </div>
        ))}
      </dl>
      <h3 className="review-subtitle">Source</h3>
      <dl className="review-fields review-fields-source">
        <div className="review-field">
          <dt>Where it comes from</dt>
          <dd>{SOURCE_TYPES[item.source_type] ?? item.source_type}</dd>
        </div>
        <div className="review-field">
          <dt>Citation</dt>
          <dd>{item.source_citation}</dd>
        </div>
        <div className="review-field">
          <dt>Licence</dt>
          <dd>{item.source_licence}</dd>
        </div>
        {item.source_retrieved && (
          <div className="review-field">
            <dt>Retrieved</dt>
            <dd>{item.source_retrieved}</dd>
          </div>
        )}
        {item.source_caveat && (
          <div className="review-field">
            <dt>Caveat</dt>
            <dd>{item.source_caveat}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
