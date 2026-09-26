'use client';
import { ReviewError } from '@/components/console/review/review-error';
import { reviewQueuePath } from '@/lib/console/paths';

export default function ReviewErrorBoundary({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  return (
    <ReviewError
      error={error}
      retry={reset}
      backHref={reviewQueuePath()}
      backLabel="Back to the queue"
    />
  );
}
