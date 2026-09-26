'use client';
import { ReviewError } from '@/components/console/review/review-error';
import { adminOverviewPath } from '@/lib/console/paths';

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
      backHref={adminOverviewPath()}
      backLabel="Back to the overview"
    />
  );
}
