import { ReviewSkeleton } from '@/components/console/review/review-skeleton';

export default function Loading() {
  return <ReviewSkeleton variant="queue" label="Loading your review queue…" />;
}
