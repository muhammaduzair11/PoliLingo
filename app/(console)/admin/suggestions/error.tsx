'use client';
import { ReviewError } from '@/components/console/review/review-error';
import { adminOverviewPath } from '@/lib/console/paths';

export default function SuggestionsErrorBoundary({
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
      backHref={adminOverviewPath()}
      backLabel="Back to the overview"
    />
  );
}
