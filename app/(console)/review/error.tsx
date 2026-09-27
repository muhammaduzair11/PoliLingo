'use client';
import { ReviewError } from '@/components/console/review/review-error';
import { reviewQueuePath } from '@/lib/console/paths';

export default function ReviewErrorBoundary({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <ReviewError
      error={error}
      retry={retry}
      backHref={reviewQueuePath()}
      backLabel="Back to the queue"
    />
  );
}
