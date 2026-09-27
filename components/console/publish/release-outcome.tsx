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
    ? `${outcome.name} brings back the lessons of ${outcome.restored}`
    : `${outcome.name} is live`;
  if (outcome.check === 'mismatch')
    return (
      <Notice
        tone="warning"
        title={`${outcome.name} was saved, but its content check failed`}
        code="PL422_HASH_MISMATCH"
      >
        Learners&apos; apps will refuse this copy and keep the lessons they
        have. Please tell the team before publishing again.
      </Notice>
    );
  if (outcome.check === 'overlay_off')
    return (
      <Notice tone="info" title={`${outcome.name} is saved`}>
        {size}. Live content updates are switched off right now, so learners
        keep their current lessons until they&apos;re switched back on.
      </Notice>
    );
  return (
    <Notice tone="success" title={what}>
      {size}. Learners&apos; apps pick it up the next time they open, within a
      minute.
      {outcome.check === 'verified' &&
        ' We read it back and its content check passed.'}
    </Notice>
  );
}
