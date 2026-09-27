/**
 * What a review page shows while it loads: the page's shape in soft grey
 * blocks, announced once to screen readers. The shimmer stops under both
 * reduced-motion switches (console-review.css).
 */
export function ReviewSkeleton({
  label,
  variant,
}: {
  label: string;
  variant: 'queue' | 'detail' | 'list';
}) {
  const rows = variant === 'queue' ? 5 : 3;
  return (
    <div className="review-skeleton" aria-busy="true">
      <output className="review-visually-hidden" aria-live="polite">
        {label}
      </output>
      <div aria-hidden="true">
        <div className="review-skeleton-line review-skeleton-eyebrow" />
        <div className="review-skeleton-line review-skeleton-title" />
        <div className="review-skeleton-line review-skeleton-text" />
        {variant === 'detail' ? (
          <div className="review-skeleton-detail">
            <div className="review-skeleton-block review-skeleton-tall" />
            <div className="review-skeleton-block" />
          </div>
        ) : (
          Array.from({ length: rows }, (_, i) => (
            <div
              key={i}
              className="review-skeleton-block review-skeleton-row"
            />
          ))
        )}
      </div>
    </div>
  );
}
