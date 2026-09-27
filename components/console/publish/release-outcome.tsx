import { Notice } from '@/components/console/notice';
import { count } from './format';
import type { PublishOutcome } from './types';

/**
 * What came of a publish or a rollback, including the read-back check: the
 * new release was fetched again and its contentHash recomputed here.
 */
export function ReleaseOutcome({ outcome }: { outcome: PublishOutcome }) {
  const size = `${count(outcome.lessons, 'lesson', 'lessons')} and ${count(outcome.items, 'phrase', 'phrases')}`;
  const what = outcome.restored
    ? 'Learners have the earlier lessons again'
    : 'Published to learners';
  // The id is for the history and support: small print, after the news.
  const saved = outcome.restored
    ? ` Saved as ${outcome.name}, with the lessons of ${outcome.restored}.`
    : ` Saved as ${outcome.name}.`;
  if (outcome.check === 'mismatch')
    return (
      <Notice
        tone="warning"
        title="Saved, but the content check failed"
        code="PL422_HASH_MISMATCH"
      >
        Learners’ apps will refuse this copy ({outcome.name}) and keep the
        lessons they have. Please tell the team before publishing again.
      </Notice>
    );
  if (outcome.check === 'overlay_off')
    return (
      <Notice tone="info" title="Saved, not sent yet">
        {size}.{saved} Live content updates are switched off right now, so
        learners keep their current lessons until they’re switched back on.
      </Notice>
    );
  return (
    <Notice tone="success" title={what}>
      {size}. Learners’ apps pick it up the next time they open, within a
      minute.{saved}
      {outcome.check === 'verified' &&
        ' We read it back and its content check passed.'}
    </Notice>
  );
}
