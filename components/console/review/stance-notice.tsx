import { Notice } from '@/components/console/notice';
import type { ApprovalStance } from '@/lib/console/review';

/**
 * Says up front what the reviewer can do with this phrase or lesson, and
 * why, before they try: the author rule, the sole-reviewer path, starter
 * content, retired content, and someone else's variety.
 */
export function StanceNotice({
  stance,
  what,
  varietyName,
}: {
  stance: ApprovalStance;
  /** "phrase" or "lesson" */
  what: string;
  varietyName: string;
}) {
  switch (stance.kind) {
    case 'own-text':
      return (
        <Notice tone="info" title="You wrote part of this">
          Another {varietyName} reviewer needs to approve it, so every phrase
          gets a second pair of eyes. You can still ask for changes, reject it,
          comment or suggest a fix.
        </Notice>
      );
    case 'sole-author':
      return (
        <Notice
          tone="info"
          title="You wrote part of this, and you're the only reviewer"
        >
          You&apos;re the only {varietyName} reviewer right now, so you can
          approve your own text. An admin countersigns it before learners see
          it.
        </Notice>
      );
    case 'demo':
      return (
        <Notice tone="info" title="Starter content">
          This {what} is part of the starter content. It is never reviewed: it
          leaves the app once reviewed lessons replace it.
        </Notice>
      );
    case 'retired':
      return (
        <Notice tone="info" title="Retired">
          This {what} has been retired, so there is nothing to review.
        </Notice>
      );
    case 'outside':
      return (
        <Notice tone="info" title="Read only">
          You can read this {what}, but only a {varietyName} reviewer can review
          it.
        </Notice>
      );
    default:
      return null;
  }
}
